import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import { generateRandomToken, hashToken } from "../lib/tokens";
import { buildInvitationEmail } from "../emails/invitation.email";
import { sendEmail } from "./email.service";
import { publicUserSelect } from "./user.select";

export const INVITATION_VALIDITY_HOURS = 72;

// "accepted_by_provider" : Resend a accepté l'email, sa livraison n'est pas confirmée
export type InvitationEmailStatus = "accepted_by_provider" | "failed";

// Nouveau jeton : le jeton en clair part dans l'email, seul son hash est stocké
export function newInvitationToken() {
  const token = generateRandomToken();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITATION_VALIDITY_HOURS * 60 * 60 * 1000),
  };
}

type InvitationToSend = {
  invitationId: string;
  userId: string;
  email: string;
  prenom: string;
  token: string;
  expiresAt: Date;
};

// Envoie l'email d'invitation. Un échec est journalisé sans jeton ni adresse email.
export async function sendInvitationEmail(invitation: InvitationToSend): Promise<InvitationEmailStatus> {
  const content = buildInvitationEmail({
    prenom: invitation.prenom,
    token: invitation.token,
    expiresAt: invitation.expiresAt,
    apiBaseUrl: process.env.API_PUBLIC_URL,
  });

  // Même clé pour une même invitation : une nouvelle tentative ne crée pas de doublon chez Resend
  const result = await sendEmail(
    { to: invitation.email, ...content },
    { idempotencyKey: `invitation-${invitation.invitationId}` },
  );

  if (!result.ok) {
    console.error("Invitation email not sent", {
      userId: invitation.userId,
      invitationId: invitation.invitationId,
      reason: result.reason,
      providerError: result.providerError?.name,
    });
    return "failed";
  }

  return "accepted_by_provider";
}

// Même erreur quelle que soit la cause, pour ne rien révéler sur le jeton
const invalidInvitation = () => new HttpError(400, "Invalid or expired invitation");

// Accepte une invitation : définit le mot de passe et active le compte.
export async function acceptInvitation(token: string, password: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { status: true } } },
  });

  if (
    !invitation ||
    invitation.usedAt ||
    invitation.expiresAt <= new Date() ||
    invitation.user.status !== "INVITED"
  ) {
    throw invalidInvitation();
  }

  // Hash calculé avant la transaction : bcrypt est lent, la transaction reste courte
  const passwordHash = await bcrypt.hash(password, 12);

  // Tout réussit ou rien n'est enregistré : une erreur annule la transaction
  return prisma.$transaction(async (tx) => {
    const now = new Date();

    // Les conditions empêchent deux requêtes simultanées d'utiliser le même jeton
    const used = await tx.invitation.updateMany({
      where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (used.count === 0) throw invalidInvitation();

    const activated = await tx.user.updateMany({
      where: { id: invitation.userId, status: "INVITED" },
      data: { password: passwordHash, status: "ACTIVE" },
    });
    if (activated.count === 0) throw invalidInvitation();

    // Les autres invitations encore valides de cet utilisateur deviennent inutilisables
    await expirePendingInvitations(tx, invitation.userId, now);

    return tx.user.findUniqueOrThrow({ where: { id: invitation.userId }, select: publicUserSelect });
  });
}

// Fait expirer les invitations encore valides. usedAt reste réservé aux invitations acceptées.
export function expirePendingInvitations(
  tx: Pick<typeof prisma, "invitation">,
  userId: string,
  now = new Date(),
) {
  return tx.invitation.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
}

// Renvoie une invitation : l'ancien jeton expire, un nouveau est créé et envoyé.
export async function resendInvitation(userId: string) {
  const { token, tokenHash, expiresAt } = newInvitationToken();

  const { user, invitation } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, prenom: true, status: true },
    });
    if (!user) throw new HttpError(404, "User not found");
    if (user.status !== "INVITED") {
      throw new HttpError(409, "Only users with status INVITED can receive a new invitation");
    }

    await expirePendingInvitations(tx, userId);
    const invitation = await tx.invitation.create({
      data: { tokenHash, userId, expiresAt },
      select: { id: true },
    });
    return { user, invitation };
  });

  const emailStatus = await sendInvitationEmail({
    invitationId: invitation.id,
    userId: user.id,
    email: user.email,
    prenom: user.prenom,
    token,
    expiresAt,
  });

  return { expiresAt, emailStatus };
}
