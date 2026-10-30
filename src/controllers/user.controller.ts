import { Request, Response } from "express";
import * as userService from "../services/user.service";
import * as invitationService from "../services/invitation.service";
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserStatusInput,
  UserIdParams,
} from "../schemas/user.schema";

// Message ajouté quand l'email n'a pas pu être envoyé
const emailFailedMessage = "The invitation email could not be sent. Use POST /users/:id/invitation to retry";

const invitationResponse = (invitation: { expiresAt: Date; emailStatus: invitationService.InvitationEmailStatus }) => ({
  expiresAt: invitation.expiresAt,
  emailStatus: invitation.emailStatus,
  ...(invitation.emailStatus === "failed" && { message: emailFailedMessage }),
});

// POST /users : un Super Admin crée un utilisateur et lui envoie une invitation
export const createUser = async (_req: Request, res: Response) => {
  const data: CreateUserInput = res.locals.body;

  const { user, invitation } = await userService.createUserWithInvitation(data);

  // 201 même si l'email a échoué : l'utilisateur existe bien. emailStatus le signale.
  res.status(201).json({ user, invitation: invitationResponse(invitation) });
};

// GET /users : liste des utilisateurs (filtres + pagination)
export const listUsers = async (_req: Request, res: Response) => {
  const query: ListUsersQuery = res.locals.query;

  res.json(await userService.listUsers(query));
};

// POST /users/:id/invitation : renvoie une invitation, l'ancienne expire
export const resendInvitation = async (_req: Request, res: Response) => {
  const { id }: UserIdParams = res.locals.params;

  const invitation = await invitationService.resendInvitation(id);

  res.status(201).json({ invitation: invitationResponse(invitation) });
};

// PATCH /users/:id/status : active ou désactive un utilisateur
export const updateUserStatus = async (_req: Request, res: Response) => {
  const { id }: UserIdParams = res.locals.params;
  const data: UpdateUserStatusInput = res.locals.body;

  const user = await userService.updateUserStatus(res.locals.user.id, id, data);

  res.json({ user });
};
