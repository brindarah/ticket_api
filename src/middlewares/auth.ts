import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import { verifyAccessToken } from "../lib/tokens";

// Vérifie l'access token envoyé dans le header :
// Authorization: Bearer <token>
// Si tout va bien, l'utilisateur est rangé dans res.locals.user
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required");
  }

  const token = header.slice("Bearer ".length);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }

  // On vérifie en base que le compte existe toujours et est actif,
  // pour qu'un compte désactivé soit bloqué tout de suite.
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Invalid or expired token");
  }

  res.locals.user = user;
  next();
};

// Autorise seulement certains rôles. À placer APRÈS authenticate.
// Exemple : router.post("/", authenticate, authorize("SUPER_ADMIN"), createUser);
export const authorize = (...roles: string[]) => {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;

    if (!user) {
      throw new HttpError(401, "Authentication required");
    }

    if (!roles.includes(user.role)) {
      throw new HttpError(403, "Forbidden");
    }

    next();
  };
};