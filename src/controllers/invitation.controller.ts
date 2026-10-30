import { Request, Response } from "express";
import * as invitationService from "../services/invitation.service";
import type { AcceptInvitationInput } from "../schemas/invitation.schema";

// POST /auth/accept-invitation : définit le mot de passe et active le compte
export const acceptInvitation = async (_req: Request, res: Response) => {
  const { token, password }: AcceptInvitationInput = res.locals.body;

  const user = await invitationService.acceptInvitation(token, password);

  // Pas de tokens de session ici : l'utilisateur se connecte ensuite avec POST /auth/login
  res.json({ message: "Invitation accepted", user });
};
