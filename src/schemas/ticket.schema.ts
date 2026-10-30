import { z } from "zod";

export const ticketStatus = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

// Données attendues pour créer un ticket
export const createTicketSchema = z.object({
  title: z.string().trim().min(3, "Le titre doit faire au moins 3 caractères").max(200),
  description: z.string().trim().min(1, "La description est obligatoire"),
  email: z.string().email("Email invalide"),
});

// Filtres et pagination pour la liste des tickets
export const listTicketsQuerySchema = z.object({
  status: ticketStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// Paramètre :id des routes /tickets/:id (les ids sont des UUID générés par Prisma)
export const ticketIdParamsSchema = z.object({
  id: z.uuid("Identifiant de ticket invalide"),
});

// Body de PATCH /tickets/:id/status : seul le statut est accepté
export const updateTicketStatusSchema = z.strictObject({
  status: ticketStatus,
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
export type TicketIdParams = z.infer<typeof ticketIdParamsSchema>;
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusSchema>;
