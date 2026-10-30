import type { SendEmailInput } from "../services/email.service";
import { apiEndpoint, apiRequestBlock, assertValidDate, escapeHtml, formatParisDate, htmlLayout } from "./shared";

export const INVITATION_SUBJECT = "Ticket API — Invitation à rejoindre la plateforme";

// Route d'acceptation. Le body indiqué ici doit rester synchronisé avec acceptInvitationSchema.
export const ACCEPT_INVITATION_PATH = "/auth/accept-invitation";

export type InvitationEmailParams = {
  prenom: string;
  token: string; // jeton en clair : il n'existe que dans cet email, la base ne stocke que son hash
  expiresAt: Date;
  apiBaseUrl?: string; // ex. "https://api.example.com" ; sinon seul le chemin est indiqué
};

export type EmailContent = Pick<SendEmailInput, "subject" | "text" | "html">;

// Construit le sujet et le contenu de l'email d'invitation. Ne fait aucun envoi.
export function buildInvitationEmail(params: InvitationEmailParams): EmailContent {
  const prenom = params.prenom.trim();
  const token = params.token.trim();

  if (!prenom || !token) {
    throw new Error("buildInvitationEmail : prenom et token sont obligatoires");
  }
  assertValidDate(params.expiresAt, "expiresAt", "buildInvitationEmail");

  const expiration = formatParisDate(params.expiresAt);
  const request = apiRequestBlock(
    apiEndpoint(ACCEPT_INVITATION_PATH, params.apiBaseUrl),
    `{ "token": "${token}", "password": "<votre mot de passe>" }`,
  );

  const text = [
    `Bonjour ${prenom},`,
    "",
    "Un administrateur vous invite à rejoindre la plateforme Ticket API.",
    "",
    "Pour accepter l'invitation et activer votre compte, envoyez une requête à l'API :",
    "",
    request.text,
    "",
    "Choisissez votre mot de passe vous-même : il ne vous sera jamais envoyé par email.",
    "",
    `Cette invitation est valable jusqu'au ${expiration}. Passé ce délai, demandez une nouvelle invitation à un administrateur.`,
    "",
    "Ce jeton est personnel et ne peut servir qu'une seule fois. Ne le partagez avec personne.",
    "",
    "Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message : aucun compte ne sera activé.",
    "",
    "L'équipe Ticket API",
  ].join("\n");

  const html = htmlLayout(`    <p>Bonjour ${escapeHtml(prenom)},</p>
    <p>Un administrateur vous invite à rejoindre la plateforme <strong>Ticket API</strong>.</p>
    <p>Pour accepter l'invitation et activer votre compte, envoyez une requête à l'API :</p>
    ${request.html}
    <p>Choisissez votre mot de passe vous-même : il ne vous sera jamais envoyé par email.</p>
    <p>Cette invitation est valable jusqu'au <strong>${escapeHtml(expiration)}</strong>. Passé ce délai, demandez une nouvelle invitation à un administrateur.</p>
    <p>Ce jeton est personnel et ne peut servir qu'une seule fois. Ne le partagez avec personne.</p>
    <p>Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message : aucun compte ne sera activé.</p>
    <p>L'équipe Ticket API</p>`);

  return { subject: INVITATION_SUBJECT, text, html };
}
