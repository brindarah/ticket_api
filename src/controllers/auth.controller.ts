import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import { issueTokens } from "../lib/tokens";
import type { LoginInput } from "../schemas/auth.schema";

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