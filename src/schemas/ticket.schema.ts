import { z } from "zod";

export const ticketStatus = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const ticketPriority = z.enum(["LOW", "MEDIUM", "HIGH"]);

// Données attendues pour créer un ticket
export const createTicketSchema = z.object({
  title: z.string().trim().min(3, "Le titre doit faire au moins 3 caractères").max(200),
  description: z.string().trim().min(1, "La description est obligatoire"),
  email: z.string().email("Email invalide"),
  priority: ticketPriority.optional(),
});

// Filtres et pagination pour la liste des tickets
export const listTicketsQuerySchema = z.object({
  status: ticketStatus.optional(),
  priority: ticketPriority.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
