import { z } from "zod";

export const ticketStatus = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

// Données attendues pour créer un ticket.
// Strict : l'auteur vient du JWT, un email ou un createdById envoyé par le client est refusé.
export const createTicketSchema = z.strictObject({
  title: z.string().trim().min(3, "Le titre doit faire au moins 3 caractères").max(200),
  description: z.string().trim().min(1, "La description est obligatoire"),
});

// Champs autorisés pour le tri : liste blanche, jamais transmis tels quels à Prisma
export const ticketSortFields = ["createdAt", "updatedAt", "title", "status"] as const;

// Filtres, tri et pagination pour la liste des tickets
export const listTicketsQuerySchema = z.object({
  status: ticketStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.enum(ticketSortFields).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
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
