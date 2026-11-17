import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

// Ce que contient l'access token
export type AccessTokenPayload = {
  sub: string; // id de l'utilisateur
  role: string;
  sid: string; // id de la session (le refresh token associé)
};

// Génère un token aléatoire (refresh, reset, invitation)
export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Hash d'un token pour le stocker en base (jamais le token en clair)
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Crée l'access token JWT (courte durée), lié à une session
export function signAccessToken(user: { id: string; role: string }, sessionId: string): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role, sid: sessionId };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? "15m") as jwt.SignOptions["expiresIn"],
  });
}

// Vérifie un access token, lève une erreur s'il est invalide ou expiré
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
}

// Crée un refresh token (= une session), stocke son hash en base.
// Renvoie le token en clair et l'id de la session.
export async function createRefreshToken(userId: string): Promise<{ token: string; id: string }> {
  const token = generateRandomToken();
  const days = Number(process.env.REFRESH_TOKEN_DAYS ?? 7);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const session = await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
    select: { id: true },
  });

  return { token, id: session.id };
}

// Crée les deux tokens d'un coup (login et refresh) : l'access token est lié à la session
export async function issueTokens(user: { id: string; role: string }) {
  const session = await createRefreshToken(user.id);
  const accessToken = signAccessToken(user, session.id);
  return { accessToken, refreshToken: session.token };
}

// La session est-elle toujours ouverte ? (pas révoquée par un logout, pas expirée)
export async function isSessionActive(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.refreshToken.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  return !!session && session.userId === userId && !session.revokedAt && session.expiresAt > new Date();
}

// Révoque tous les refresh tokens encore actifs d'un utilisateur
// (reset de mot de passe, désactivation du compte)
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
