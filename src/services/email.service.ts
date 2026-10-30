import type { CreateEmailOptions, CreateEmailRequestOptions, CreateEmailResponse } from "resend";
import { z } from "zod";
import { EmailConfig, EmailConfigError, getEmailConfig, getResendClient } from "../lib/resend";

// Ce dont le service a besoin du client Resend. Permet de passer un faux client dans les tests.
export type EmailSender = {
  emails: {
    send(payload: CreateEmailOptions, options?: CreateEmailRequestOptions): Promise<CreateEmailResponse>;
  };
};

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string; // version texte, toujours envoyée
  html?: string; // version HTML facultative
  replyTo?: string;
};

export type SendEmailOptions = {
  // Avec la même clé, Resend n'envoie pas deux fois le même email lors d'une nouvelle tentative
  idempotencyKey?: string;
};

export type SendEmailFailureReason =
  | "invalid_input" // paramètres invalides : erreur du code appelant
  | "config" // RESEND_API_KEY ou EMAIL_FROM absente ou invalide
  | "provider" // Resend a refusé la demande ou n'a pas pu être joint
  | "unexpected"; // exception imprévue : l'issue de l'envoi est inconnue

// "accepted" signifie que Resend a accepté la demande, pas que l'email a été livré.
export type SendEmailResult =
  | { ok: true; status: "accepted"; messageId: string }
  | {
      ok: false;
      reason: SendEmailFailureReason;
      message: string;
      providerError?: { name: string; statusCode: number | null };
    };

const sendEmailInputSchema = z.object({
  to: z.email(),
  subject: z
    .string()
    .trim()
    .min(1)
    .refine((s) => !/[\r\n]/.test(s), "ne doit pas contenir de retour à la ligne"),
  text: z.string().trim().min(1),
  html: z.string().trim().min(1).optional(),
  replyTo: z.email().optional(),
});

type Dependencies = {
  client?: EmailSender;
  config?: EmailConfig;
};

// Envoie un email transactionnel. Ne lève jamais d'exception : chaque échec est
// retourné avec sa raison, pour que l'appelant ne puisse pas l'ignorer par erreur.
export async function sendEmail(
  input: SendEmailInput,
  options: SendEmailOptions = {},
  deps: Dependencies = {},
): Promise<SendEmailResult> {
  const parsed = sendEmailInputSchema.safeParse(input);
  if (!parsed.success) {
    // Uniquement les noms des champs : les valeurs peuvent contenir des données personnelles
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    return { ok: false, reason: "invalid_input", message: `Champs invalides : ${fields.join(", ")}` };
  }

  try {
    const config = deps.config ?? getEmailConfig();
    const client = deps.client ?? getResendClient();
    const { to, subject, text, html, replyTo } = parsed.data;

    const { data, error } = await client.emails.send(
      { from: config.from, to, subject, text, ...(html && { html }), ...(replyTo && { replyTo }) },
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
    );

    if (error) {
      return {
        ok: false,
        reason: "provider",
        message: error.message,
        providerError: { name: error.name, statusCode: error.statusCode },
      };
    }

    return { ok: true, status: "accepted", messageId: data.id };
  } catch (err) {
    if (err instanceof EmailConfigError) {
      return { ok: false, reason: "config", message: err.message };
    }
    // Message générique : le détail de l'exception pourrait contenir des données sensibles
    return { ok: false, reason: "unexpected", message: "Erreur inattendue pendant l'envoi de l'email" };
  }
}
