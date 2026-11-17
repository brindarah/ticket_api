import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpError";
import type { Prisma } from "../generated/prisma/client";
import { Role, TicketStatus } from "../generated/prisma/enums";
import { CreateTicketInput, ListTicketsQuery } from "../schemas/ticket.schema";
import { recordAudit } from "./audit.service";
import { generateTicketResponse } from "./ai.service";

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
  aiResponse: true,
  aiResponseStatus: true,
  aiResponseAt: true,
} as const satisfies Prisma.TicketSelect;

const ticketNotFound = () => new HttpError(404, "Ticket not found");

// L'auteur est toujours l'utilisateur authentifié.
// Une seule génération IA, automatique, à la création : aucune régénération possible.
export const createTicket = async (data: CreateTicketInput, authorId: string) => {
  // 1. Le ticket est enregistré d'abord (statut IA : PENDING)
  const ticket = await prisma.ticket.create({
    data: { ...data, createdById: authorId },
    select: ticketSelect,
  });

  // 2. Génération de la réponse IA
  try {
    const aiResponse = await generateTicketResponse(ticket.title, ticket.description);
    return await prisma.ticket.update({
      where: { id: ticket.id },
      data: { aiResponse, aiResponseStatus: "COMPLETED", aiResponseAt: new Date() },
      select: ticketSelect,
    });
  } catch (err) {
    // 3. Échec d'OpenAI : le ticket est conservé, marqué FAILED.
    // Le journal ne contient ni le contenu du ticket ni la clé API.
    console.error("AI response not generated", {
      ticketId: ticket.id,
      reason: err instanceof Error ? err.message : "unknown",
    });
    return prisma.ticket.update({
      where: { id: ticket.id },
      data: { aiResponseStatus: "FAILED" },
      select: ticketSelect,
    });
  }
};

// Liste paginée, filtrable par statut, triée selon un champ de la liste blanche.
// L'id sert de second critère pour que la pagination reste stable entre deux pages.
export const listTickets = async (actor: TicketActor, { status, page, limit, sort, order }: ListTicketsQuery) => {
  // Un USER ne voit que ses propres tickets, le SUPER_ADMIN les voit tous
  const where: Prisma.TicketWhereInput = {
    ...(status && { status }),
    ...(actor.role !== "SUPER_ADMIN" && { createdById: actor.id }),
  };
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
export const getTicketById = async (actor: TicketActor, id: string) => {
  // Le ticket d'un autre utilisateur renvoie 404 : on ne révèle pas qu'il existe
  const ticket = await prisma.ticket.findFirst({
    where: { id, ...(actor.role !== "SUPER_ADMIN" && { createdById: actor.id }) },
    select: ticketSelect,
  });
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
    return getTicketById(actor, id);
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

    await recordAudit(tx, {
      actorId: actor.id,
      action: "TICKET_STATUS_CHANGED",
      entityType: "TICKET",
      entityId: id,
      oldValue: { status: ticket.status },
      newValue: { status },
    });
  });

  return getTicketById(actor, id);
};
