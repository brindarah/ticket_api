import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import {
  generateRandomToken,
  hashToken,
  issueTokens,
  revokeAllUserTokens,
} from "../lib/tokens";
import { buildPasswordResetEmail } from "../emails/password-reset.email";
import { sendEmail } from "./email.service";
import { publicUserSelect } from "./user.select";

export const PASSWORD_RESET_VALIDITY_MINUTES = 60;

// Connexion : vérifie email + mot de passe, renvoie les deux tokens.
// Même message si l'email n'existe pas ou si le mot de passe est faux,
// pour ne pas révéler quels emails sont inscrits.
// Un compte INVITED n'a pas de mot de passe, il tombe aussi ici.
export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });

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

  return {
    ...tokens,
    user: {
      id: user.id,
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      role: user.role,
    },
  };
}

// Rotation : l'ancien refresh token est révoqué, un nouveau est créé.
export async function refreshSession(refreshToken: string) {
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

  // Le "revokedAt: null" empêche deux requêtes simultanées
  // d'utiliser le même token.
  const { count } = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    throw new HttpError(401, "Invalid refresh token");
  }

  return issueTokens(stored.user);
}

// Déconnexion : révoque le refresh token (rien ne se passe s'il est inconnu)
export async function logoutSession(refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Utilisateur connecté, sans données sensibles
export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  return user;
}

// Mot de passe oublié : crée un jeton et envoie l'email.
// Ne renvoie rien et ne lève pas d'erreur si le compte n'existe pas,
// pour ne pas révéler quels emails sont inscrits.
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") {
    return;
  }

  const token = generateRandomToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_VALIDITY_MINUTES * 60 * 1000);

  const resetToken = await prisma.$transaction(async (tx) => {
    // On invalide les anciennes demandes encore valides
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    return tx.passwordResetToken.create({
      data: { tokenHash: hashToken(token), userId: user.id, expiresAt },
      select: { id: true },
    });
  });

  const content = buildPasswordResetEmail({
    token,
    expiresAt,
    apiBaseUrl: process.env.API_PUBLIC_URL,
  });

  const result = await sendEmail(
    { to: user.email, ...content },
    { idempotencyKey: `password-reset-${resetToken.id}` },
  );

  // Échec journalisé sans jeton ni adresse email
  if (!result.ok) {
    console.error("Password reset email not sent", {
      userId: user.id,
      reason: result.reason,
    });
  }
}

// Réinitialisation : change le mot de passe avec le jeton reçu (usage unique)
export async function resetPassword(token: string, password: string) {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { status: true } } },
  });

  if (
    !stored ||
    stored.usedAt ||
    stored.expiresAt <= new Date() ||
    stored.user.status !== "ACTIVE"
  ) {
    throw new HttpError(400, "Invalid or expired token");
  }

  const hashed = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    // On marque le jeton comme utilisé : une seule fois possible
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: stored.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) {
      throw new HttpError(400, "Invalid or expired token");
    }

    await tx.user.update({
      where: { id: stored.userId },
      data: { password: hashed },
    });
  });

  // Déconnecte l'utilisateur sur tous ses appareils
  await revokeAllUserTokens(stored.userId);
}