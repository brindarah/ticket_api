import { z } from "zod";

// Body de POST /users. Le rôle et le statut ne sont pas choisis par le client :
// un utilisateur invité est toujours USER et INVITED.
export const createUserSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est obligatoire").max(100),
  prenom: z.string().trim().min(1, "Le prénom est obligatoire").max(100),
  // En minuscules, comme au login, pour que l'unicité ne dépende pas de la casse
  email: z.string().trim().toLowerCase().email("Email invalide"),
});

// Paramètre :id des routes /users/:id
export const userIdParamsSchema = z.object({
  id: z.uuid("Identifiant d'utilisateur invalide"),
});

// Filtres et pagination de GET /users
export const listUsersQuerySchema = z.object({
  status: z.enum(["INVITED", "ACTIVE", "DISABLED"]).optional(),
  role: z.enum(["SUPER_ADMIN", "USER"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// Body de PATCH /users/:id/status. INVITED n'est pas accepté : il dépend de l'invitation.
export const updateUserStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
