import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import type { Prisma } from "../generated/prisma/client";
import { Role, TicketStatus } from "../generated/prisma/enums";
import { CreateTicketInput, ListTicketsQuery } from "../schemas/ticket.schema";

// Utilisateur connecté qui agit sur un ticket (issu de res.locals.user, jamais du body)
export type TicketActor = { id: string; role: Role };

// Champs d'un ticket renvoyés au client : l'auteur est identifié, sans son email
const ticketSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  createdBy: { select: { id: true, nom: true, prenom: true } },
} as const satisfies Prisma.TicketSelect;

const ticketNotFound = () => new HttpError(404, "Ticket not found");

// L'auteur est toujours l'utilisateur authentifié
export const createTicket = (data: CreateTicketInput, authorId: string) => {
  return prisma.ticket.create({
    data: { ...data, createdById: authorId },
    select: ticketSelect,
  });
};

// Liste paginée, filtrable par statut, triée selon un champ de la liste blanche.
// L'id sert de second critère pour que la pagination reste stable entre deux pages.
export const listTickets = async ({ status, page, limit, sort, order }: ListTicketsQuery) => {
  const where = status ? { status } : {};
  const orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ [sort]: order }, { id: order }];

  // La page demandée et le nombre total, en une seule transaction
  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      select: ticketSelect,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    data: tickets,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

// Tout utilisateur connecté peut consulter n'importe quel ticket
export const getTicketById = async (id: string) => {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: ticketSelect });
  if (!ticket) throw ticketNotFound();
  return ticket;
};

// Modifie le statut. Autorisé au créateur du ticket et au SUPER_ADMIN.
// 404 si le ticket n'existe pas, 403 si l'utilisateur n'a pas le droit,
// 409 si le statut a changé entre la lecture et la mise à jour (requêtes simultanées).
export const updateTicketStatus = async (actor: TicketActor, id: string, status: TicketStatus) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true, status: true, createdById: true },
  });

  if (!ticket) throw ticketNotFound();
  if (actor.role !== "SUPER_ADMIN" && ticket.createdById !== actor.id) {
    throw new HttpError(403, "You can only change the status of your own tickets");
  }

  // Même statut : rien à modifier
  if (ticket.status === status) {
    return getTicketById(id);
  }

  await prisma.$transaction(async (tx) => {
    // La condition sur l'ancien statut empêche d'écraser une modification simultanée
    const { count } = await tx.ticket.updateMany({
      where: { id, status: ticket.status },
      data: { status },
    });
    if (count === 0) {
      throw new HttpError(409, "The ticket status was changed by another request, please retry");
    }
  });

  return getTicketById(id);
};
