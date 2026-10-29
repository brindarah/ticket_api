import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { createTicketSchema, listTicketsQuerySchema } from "../schemas/ticket.schema";

// POST /tickets : créer un ticket
export const createTicket = async (_req: Request, res: Response) => {
  const data: z.infer<typeof createTicketSchema> = res.locals.body;

  const ticket = await prisma.ticket.create({ data });

  res.status(201).json(ticket);
};

// GET /tickets : lister les tickets (filtres + pagination)
export const listTickets = async (_req: Request, res: Response) => {
  const { status, priority, page, limit }: z.infer<typeof listTicketsQuerySchema> =
    res.locals.query;

  // On n'ajoute un filtre que s'il a été fourni
  const where = {
    ...(status && { status }),
    ...(priority && { priority }),
  };

  // On récupère la page demandée ET le nombre total, en une seule fois
  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ]);

  res.json({
    data: tickets,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};
