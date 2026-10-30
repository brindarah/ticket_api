import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import { revokeAllUserTokens } from "../lib/tokens";
import { expirePendingInvitations, newInvitationToken, sendInvitationEmail } from "./invitation.service";
import { publicUserSelect } from "./user.select";
import type { CreateUserInput, ListUsersQuery, UpdateUserStatusInput } from "../schemas/user.schema";

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && err.code === "P2002";

// Crée un utilisateur INVITED et son invitation, puis envoie l'email.
// Si l'envoi échoue, l'utilisateur reste créé : le résultat l'indique explicitement.
export async function createUserWithInvitation(input: CreateUserInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw new HttpError(409, "A user with this email already exists");
  }

  const { token, tokenHash, expiresAt } = newInvitationToken();

  let created;
  try {
    // Création imbriquée : l'utilisateur et son invitation sont enregistrés ensemble ou pas du tout
    created = await prisma.user.create({
      data: {
        ...input,
        role: "USER",
        status: "INVITED",
        invitations: { create: { tokenHash, expiresAt } },
      },
      select: { ...publicUserSelect, invitations: { select: { id: true } } },
    });
  } catch (err) {
    // Deux créations simultanées avec le même email
    if (isUniqueViolation(err)) {
      throw new HttpError(409, "A user with this email already exists");
    }
    throw err;
  }

  const { invitations, ...user } = created;

  const emailStatus = await sendInvitationEmail({
    invitationId: invitations[0].id,
    userId: user.id,
    email: user.email,
    prenom: user.prenom,
    token,
    expiresAt,
  });

  return { user, invitation: { expiresAt, emailStatus } };
}

// Liste paginée, filtrable par statut et par rôle
export async function listUsers({ status, role, page, limit }: ListUsersQuery) {
  const where = { ...(status && { status }), ...(role && { role }) };

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: users,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

// Active ou désactive un utilisateur.
// - Un Super Admin ne peut changer ni son propre statut ni celui d'un autre Super Admin.
// - Un utilisateur INVITED ne s'active qu'en acceptant son invitation.
// - Réactiver un compte qui n'a jamais eu de mot de passe le remet en INVITED.
export async function updateUserStatus(actorId: string, userId: string, { status }: UpdateUserStatusInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, password: true },
  });

  if (!user) throw new HttpError(404, "User not found");
  if (user.id === actorId) throw new HttpError(403, "You cannot change your own status");
  if (user.role === "SUPER_ADMIN") throw new HttpError(403, "The status of a Super Admin cannot be changed");

  if (status === "DISABLED") {
    if (user.status !== "DISABLED") {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
        await expirePendingInvitations(tx, userId);
      });
      // Ses sessions ne peuvent plus être renouvelées (authenticate bloque déjà son access token)
      await revokeAllUserTokens(userId);
    }
  } else {
    if (user.status === "INVITED") {
      throw new HttpError(409, "An invited user is activated by accepting the invitation");
    }
    if (user.status === "DISABLED") {
      await prisma.user.update({
        where: { id: userId },
        data: { status: user.password ? "ACTIVE" : "INVITED" },
      });
    }
  }

  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
}
