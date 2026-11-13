import { apiEndpoint, apiRequestBlock, assertValidDate, escapeHtml, formatParisDate, htmlLayout } from "./shared";
import type { EmailContent } from "./invitation.email";

export const PASSWORD_RESET_SUBJECT = "Ticket API — Réinitialisation de votre mot de passe";

// Route existante de Personne 1 : body { token, password } (resetPasswordSchema)
export const RESET_PASSWORD_PATH = "/auth/reset-password";

export type PasswordResetEmailParams = {
  token: string; // jeton en clair, la base ne stocke que son hash
  expiresAt: Date;
  apiBaseUrl?: string;
};

// Construit le sujet et le contenu de l'email de réinitialisation. Ne fait aucun envoi.
export function buildPasswordResetEmail(params: PasswordResetEmailParams): EmailContent {
  const token = params.token.trim();
  if (!token) {
    throw new Error("buildPasswordResetEmail : token est obligatoire");
  }
  assertValidDate(params.expiresAt, "expiresAt", "buildPasswordResetEmail");

  const expiration = formatParisDate(params.expiresAt);
  const request = apiRequestBlock(
    apiEndpoint(RESET_PASSWORD_PATH, params.apiBaseUrl),
    `{ "token": "${token}", "password": "<nouveau mot de passe>" }`,
  );

  const text = [
    "Bonjour,",
    "",
    "Vous avez demandé à réinitialiser votre mot de passe Ticket API.",
    "",
    "Pour choisir un nouveau mot de passe, envoyez une requête à l'API :",
    "",
    request.text,
    "",
    `Ce jeton est valable jusqu'au ${expiration} et ne peut servir qu'une seule fois. Ne le partagez avec personne.`,
    "",
    "Après la réinitialisation, vous serez déconnecté de tous vos appareils.",
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.",
    "",
    "L'équipe Ticket API",
  ].join("\n");

  const html = htmlLayout(`    <p>Bonjour,</p>
    <p>Vous avez demandé à réinitialiser votre mot de passe <strong>Ticket API</strong>.</p>
    <p>Pour choisir un nouveau mot de passe, envoyez une requête à l'API :</p>
    ${request.html}
    <p>Ce jeton est valable jusqu'au <strong>${escapeHtml(expiration)}</strong> et ne peut servir qu'une seule fois. Ne le partagez avec personne.</p>
    <p>Après la réinitialisation, vous serez déconnecté de tous vos appareils.</p>
    <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.</p>
    <p>L'équipe Ticket API</p>`);

  return { subject: PASSWORD_RESET_SUBJECT, text, html };
}
