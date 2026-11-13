import { z } from "zod";

// Body de POST /auth/accept-invitation, tel qu'indiqué dans l'email d'invitation
export const acceptInvitationSchema = z.strictObject({
  token: z.string().trim().min(1, "Token requis"),
  password: z
    .string()
    .min(8, "Le mot de passe doit faire au moins 8 caractères")
    // bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que de tronquer en silence
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Le mot de passe ne doit pas dépasser 72 octets"),
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
