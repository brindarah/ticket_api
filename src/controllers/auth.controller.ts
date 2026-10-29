import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import { hashToken, issueTokens, revokeAllUserTokens } from "../lib/tokens";
import type { LoginInput, RefreshInput } from "../schemas/auth.schema";

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