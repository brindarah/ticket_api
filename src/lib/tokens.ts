import crypto from "crypto";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

// Ce que contient l'access token
export type AccessTokenPayload = {
  sub: string; // id de l'utilisateur
  role: string;
};

// Génère un token aléatoire (refresh, reset, invitation)
export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Hash d'un token pour le stocker en base (jamais le token en clair)
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Crée l'access token JWT (courte durée)
export function signAccessToken(user: { id: string; role: string }): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? "15m") as jwt.SignOptions["expiresIn"],
  });
}

// Vérifie un access token, lève une erreur s'il est invalide ou expiré
export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
}

// Crée un refresh token, stocke son hash en base, renvoie le token en clair
export async function createRefreshToken(userId: string): Promise<string> {
  const token = generateRandomToken();
  const days = Number(process.env.REFRESH_TOKEN_DAYS ?? 7);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  return token;
}

// Crée les deux tokens d'un coup (utilisé au login et au refresh)
export async function issueTokens(user: { id: string; role: string }) {
  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);
  return { accessToken, refreshToken };
}

// Révoque tous les refresh tokens encore actifs d'un utilisateur
// (utilisé au reset de mot de passe, et par ta pote pour la désactivation)
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}