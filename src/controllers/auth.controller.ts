import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import {
  generateRandomToken,
  hashToken,
  issueTokens,
  revokeAllUserTokens,
} from "../lib/tokens";
import { sendEmail, passwordResetEmail } from "../lib/email";
import type {
  LoginInput,
  RefreshInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "../schemas/auth.schema";

// POST /auth/login
export const login = async (_req: Request, res: Response) => {
  const { email, password } = res.locals.body as LoginInput;

  const user = await prisma.user.findUnique({ where: { email } });

  // Même message si l'email n'existe pas ou si le mot de passe est faux,
  // pour ne pas révéler quels emails sont inscrits.
  // Un compte INVITED n'a pas de mot de passe, il tombe aussi ici.
  if (!user || !user.password) {
    throw new HttpError(401, "Invalid email or password");
  }

  const passwordOk = await bcrypt.compare(password, user.password);
  if (!passwordOk) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (user.status !== "ACTIVE") {
    throw new HttpError(403, "Account disabled");
  }

  const tokens = await issueTokens(user);

  res.json({
    ...tokens,
    user: {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      role: user.role,
    },
  });
};

// POST /auth/refresh
// Donne un nouvel access token et remplace le refresh token (rotation)
export const refresh = async (_req: Request, res: Response) => {
  const { refreshToken } = res.locals.body as RefreshInput;

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
  });

  if (!stored) {
    throw new HttpError(401, "Invalid refresh token");
  }

  // Token déjà révoqué réutilisé : probablement volé.
  // Par sécurité, on déconnecte l'utilisateur partout.
  if (stored.revokedAt) {
    await revokeAllUserTokens(stored.userId);
    throw new HttpError(401, "Invalid refresh token");
  }

  if (stored.expiresAt < new Date()) {
    throw new HttpError(401, "Refresh token expired");
  }

  if (stored.user.status !== "ACTIVE") {
    throw new HttpError(403, "Account disabled");
  }

  // On révoque l'ancien token. Le "revokedAt: null" empêche
  // deux requêtes simultanées d'utiliser le même token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    throw new HttpError(401, "Invalid refresh token");
  }

  const tokens = await issueTokens(stored.user);
  res.json(tokens);
};

// POST /auth/logout
// Révoque le refresh token : l'utilisateur ne peut plus renouveler sa session
export const logout = async (_req: Request, res: Response) => {
  const { refreshToken } = res.locals.body as RefreshInput;

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // 204 = succès, sans contenu à renvoyer
  res.status(204).send();
};

// GET /auth/me
// Renvoie l'utilisateur connecté (route protégée par authenticate)
export const me = async (_req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: res.locals.user.id },
    select: { id: true, nom: true, prenom: true, email: true, role: true, status: true },
  });

  res.json({ user });
};

// POST /auth/forgot-password
// Envoie un lien de réinitialisation par email
export const forgotPassword = async (_req: Request, res: Response) => {
  const { email } = res.locals.body as ForgotPasswordInput;

  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.status === "ACTIVE") {
    // On invalide les anciennes demandes encore valides
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Nouveau token, valable 1 heure, stocké hashé
    const token = generateRandomToken();
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const { subject, html } = passwordResetEmail(link);

    // Si l'envoi échoue, on le note dans les logs mais on répond pareil,
    // pour ne pas révéler que le compte existe.
    try {
      await sendEmail(user.email, subject, html);
    } catch (err) {
      console.error(err);
    }
  }

  // Toujours la même réponse, que le compte existe ou non
  res.json({ message: "If this account exists, a reset email has been sent" });
};

// POST /auth/reset-password
// Change le mot de passe grâce au token reçu par email (usage unique)
export const resetPassword = async (_req: Request, res: Response) => {
  const { token, password } = res.locals.body as ResetPasswordInput;

  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (
    !stored ||
    stored.usedAt ||
    stored.expiresAt < new Date() ||
    stored.user.status !== "ACTIVE"
  ) {
    throw new HttpError(400, "Invalid or expired token");
  }

  // On marque le token comme utilisé (une seule fois possible)
  const { count } = await prisma.passwordResetToken.updateMany({
    where: { id: stored.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 0) {
    throw new HttpError(400, "Invalid or expired token");
  }

  const hashed = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: stored.userId },
    data: { password: hashed },
  });

  // Déconnecte l'utilisateur sur tous ses appareils
  await revokeAllUserTokens(stored.userId);

  res.json({ message: "Password updated" });
};