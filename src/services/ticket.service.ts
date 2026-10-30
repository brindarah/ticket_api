import { prisma } from "../lib/prisma";
import { TicketStatus } from "../generated/prisma/enums";
import { CreateTicketInput, ListTicketsQuery } from "../schemas/ticket.schema";

export const createTicket = (data: CreateTicketInput) => {
  return prisma.ticket.create({ data });
};

// Liste paginée, filtrable par statut
export const listTickets = async ({ status, page, limit }: ListTicketsQuery) => {
  const where = status ? { status } : {};

  // La page demandée et le nombre total, en une seule transaction
  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
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

// Si le ticket n'existe pas, Prisma lève une erreur P2025 (-> 404 dans errorHandler)
export const getTicketById = (id: string) => {
  return prisma.ticket.findUniqueOrThrow({ where: { id } });
};

// Met à jour uniquement le statut. Ticket absent : erreur P2025 (-> 404)
export const updateTicketStatus = (id: string, status: TicketStatus) => {
  return prisma.ticket.update({
    where: { id },
    data: { status },
  });
};
