import { z } from "zod";

// Mots de passe parmi les plus utilisés : refusés même s'ils respectent les autres règles
const COMMON_PASSWORDS = new Set([
  "password1", "password123", "motdepasse1", "motdepasse123",
  "azerty123", "azertyuiop1", "qwerty123", "qwertyuiop1",
  "admin123", "welcome1", "iloveyou1", "abc12345", "abcd1234",
  "soleil123", "bonjour123", "test1234", "user1234",
]);

// Règle unique pour tout nouveau mot de passe (reset et acceptation d'invitation)
export const strongPassword = z
  .string()
  .min(8, "Le mot de passe doit faire au moins 8 caractères")
  .max(72, "Le mot de passe doit faire au plus 72 caractères")
  // bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que de tronquer
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Le mot de passe ne doit pas dépasser 72 octets")
  .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre")
  .refine((value) => !/^(.)\1+$/.test(value), "Le mot de passe ne doit pas être un seul caractère répété")
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), "Ce mot de passe est trop courant");
