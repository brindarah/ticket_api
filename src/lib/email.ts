import { Resend } from "resend";

// Envoie un email avec Resend. Lève une erreur si l'envoi échoue.
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Email non envoyé : ${error.message}`);
  }
}

// Contenu de l'email "mot de passe oublié"
export function passwordResetEmail(link: string) {
  return {
    subject: "Réinitialisation de votre mot de passe",
    html: `
      <p>Bonjour,</p>
      <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
      <p><a href="${link}">Cliquez ici pour choisir un nouveau mot de passe</a></p>
      <p>Ce lien est valable 1 heure et ne peut servir qu'une seule fois.</p>
      <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
    `,
  };
}