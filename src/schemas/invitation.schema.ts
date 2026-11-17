import { z } from "zod";
import { strongPassword } from "./password.schema";

// Body de POST /auth/accept-invitation, tel qu'indiqué dans l'email d'invitation
export const acceptInvitationSchema = z.strictObject({
  token: z.string().trim().min(1, "Token requis"),
  // Même règle que pour la réinitialisation du mot de passe
  password: strongPassword,
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
