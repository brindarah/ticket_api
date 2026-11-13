import { rateLimit } from "express-rate-limit";
import { HttpError } from "../lib/httpError";

type RateLimiterOptions = {
  windowMs: number; // durée de la fenêtre, en millisecondes
  limit: number; // nombre de requêtes autorisées par IP dans la fenêtre
  skipSuccessfulRequests?: boolean; // true : seuls les échecs comptent
  message?: string;
  force?: boolean; // true : actif même si RATE_LIMIT_DISABLED (pour les tests du limiteur)
};

// Crée un limiteur de requêtes par adresse IP.
// Au-delà de la limite, renvoie une 429 au format d'erreur de l'API.
// Désactivé quand RATE_LIMIT_DISABLED=true (tests automatisés).
export function createRateLimiter({
  windowMs,
  limit,
  skipSuccessfulRequests = false,
  message = "Too many requests, please try again later",
  force = false,
}: RateLimiterOptions) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: "draft-7", // en-têtes RateLimit-* et Retry-After
    legacyHeaders: false,
    skip: () => !force && process.env.RATE_LIMIT_DISABLED === "true",
    handler: (_req, _res, next) => next(new HttpError(429, message)),
  });
}

const MINUTE = 60 * 1000;

// Toute l'API : 300 requêtes par IP toutes les 15 minutes
export const globalLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  limit: 300,
});

// Login : 10 tentatives ratées par IP toutes les 15 minutes (anti brute-force)
export const loginLimiter = createRateLimiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  message: "Too many failed login attempts, please try again later",
});

// Mot de passe oublié : 5 demandes par IP par heure (évite d'inonder une boîte mail)
export const forgotPasswordLimiter = createRateLimiter({
  windowMs: 60 * MINUTE,
  limit: 5,
});

// Reset : 10 tentatives par IP par heure
export const resetPasswordLimiter = createRateLimiter({
  windowMs: 60 * MINUTE,
  limit: 10,
});