import { Resend } from "resend";
import { z } from "zod";

// Erreur de configuration : c'est un problème serveur (500), pas une erreur du client.
// Le message cite uniquement les noms des variables, jamais leurs valeurs.
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

// Accepte "adresse@domaine.com" ou "Nom affiché <adresse@domaine.com>"
const emailFromSchema = z
  .string()
  .trim()
  .refine((value) => {
    const match = value.match(/^(?:[^<>]+<([^<>\s]+)>|([^<>\s]+))$/);
    const address = match?.[1] ?? match?.[2];
    return address !== undefined && z.email().safeParse(address).success;
  }, "doit être une adresse email, éventuellement précédée d'un nom : Nom <adresse@domaine.com>");

const emailEnvSchema = z.object({
  RESEND_API_KEY: z.string().trim().startsWith("re_", "doit être une clé API Resend (préfixe re_)"),
  EMAIL_FROM: emailFromSchema,
});

export type EmailConfig = {
  apiKey: string;
  from: string;
};

// Lit et valide la configuration au moment de l'envoi, pas au démarrage :
// sans clé Resend, l'API et les tests qui n'envoient pas d'email fonctionnent.
export function getEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const result = emailEnvSchema.safeParse(env);

  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join(".");
      return env[name] === undefined || env[name]?.trim() === ""
        ? `${name} est manquante`
        : `${name} ${issue.message}`;
    });
    throw new EmailConfigError(`Configuration email invalide : ${problems.join(" ; ")}`);
  }

  return { apiKey: result.data.RESEND_API_KEY, from: result.data.EMAIL_FROM };
}

// Client Resend unique, créé au premier besoin
let client: Resend | undefined;

export function getResendClient(): Resend {
  if (!client) {
    client = new Resend(getEmailConfig().apiKey);
  }
  return client;
}

// Réservé aux tests : oublie le client mis en cache
export function resetResendClientForTests(): void {
  client = undefined;
}
