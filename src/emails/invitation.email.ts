import type { SendEmailInput } from "../services/email.service";

export const INVITATION_SUBJECT = "Ticket API — Invitation à rejoindre la plateforme";

// Route d'acceptation prévue en Feature 4b. Le body attendu doit rester synchronisé avec ce texte.
const ACCEPT_INVITATION_PATH = "/auth/accept-invitation";

export type InvitationEmailParams = {
  prenom: string;
  token: string; // jeton en clair : il n'existe que dans cet email, la base ne stocke que son hash
  expiresAt: Date;
  apiBaseUrl?: string; // ex. "https://api.example.com" ; sinon seul le chemin est indiqué
};

export type InvitationEmailContent = Pick<SendEmailInput, "subject" | "text" | "html">;

// Échappe les caractères spéciaux pour insérer une valeur dans le HTML sans l'interpréter
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExpiration(date: Date): string {
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(date);
  return `${formatted} (heure de Paris)`;
}

// Construit le sujet et le contenu de l'email d'invitation. Ne fait aucun envoi.
export function buildInvitationEmail(params: InvitationEmailParams): InvitationEmailContent {
  const prenom = params.prenom.trim();
  const token = params.token.trim();

  if (!prenom || !token) {
    throw new Error("buildInvitationEmail : prenom et token sont obligatoires");
  }
  if (Number.isNaN(params.expiresAt.getTime())) {
    throw new Error("buildInvitationEmail : expiresAt doit être une date valide");
  }

  const endpoint = `${params.apiBaseUrl?.replace(/\/+$/, "") ?? ""}${ACCEPT_INVITATION_PATH}`;
  const expiration = formatExpiration(params.expiresAt);
  const requestBody = `{ "token": "${token}", "password": "<votre mot de passe>" }`;

  const text = [
    `Bonjour ${prenom},`,
    "",
    "Un administrateur vous invite à rejoindre la plateforme Ticket API.",
    "",
    "Pour accepter l'invitation et activer votre compte, envoyez une requête à l'API :",
    "",
    `  POST ${endpoint}`,
    "  Content-Type: application/json",
    "",
    `  ${requestBody}`,
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

  const html = `<!doctype html>
<html lang="fr">
  <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
    <p>Bonjour ${escapeHtml(prenom)},</p>
    <p>Un administrateur vous invite à rejoindre la plateforme <strong>Ticket API</strong>.</p>
    <p>Pour accepter l'invitation et activer votre compte, envoyez une requête à l'API :</p>
    <pre style="background: #f3f4f6; padding: 12px; border-radius: 4px; white-space: pre-wrap;">POST ${escapeHtml(endpoint)}
Content-Type: application/json

${escapeHtml(requestBody)}</pre>
    <p>Choisissez votre mot de passe vous-même : il ne vous sera jamais envoyé par email.</p>
    <p>Cette invitation est valable jusqu'au <strong>${escapeHtml(expiration)}</strong>. Passé ce délai, demandez une nouvelle invitation à un administrateur.</p>
    <p>Ce jeton est personnel et ne peut servir qu'une seule fois. Ne le partagez avec personne.</p>
    <p>Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message : aucun compte ne sera activé.</p>
    <p>L'équipe Ticket API</p>
  </body>
</html>`;

  return { subject: INVITATION_SUBJECT, text, html };
}
