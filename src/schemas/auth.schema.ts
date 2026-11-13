import { z } from "zod";

// Règles communes
const email = z.string().trim().toLowerCase().max(254, "Email trop long").email("Email invalide");

// bcrypt n'utilise que les 72 premiers octets d'un mot de passe : on refuse au-delà
const newPassword = z
  .string()
  .min(8, "Le mot de passe doit faire au moins 8 caractères")
  .max(72, "Le mot de passe doit faire au plus 72 caractères");

const token = z.string().trim().min(1, "Token requis").max(256, "Token invalide");

// strictObject : un champ inconnu dans le body est refusé (400)
export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, "Mot de passe requis").max(128, "Mot de passe trop long"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.strictObject({
  refreshToken: token,
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.strictObject({
  email,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.strictObject({
  token,
  password: newPassword,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;