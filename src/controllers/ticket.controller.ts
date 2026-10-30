import { Request, Response } from "express";
import {
  CreateTicketInput,
  ListTicketsQuery,
  TicketIdParams,
  UpdateTicketStatusInput,
} from "../schemas/ticket.schema";
import * as ticketService from "../services/ticket.service";

// Les données validées sont placées dans res.locals par le middleware validate

// POST /tickets : créer un ticket
export const createTicket = async (_req: Request, res: Response) => {
  const data: CreateTicketInput = res.locals.body;

  const ticket = await ticketService.createTicket(data);

  res.status(201).json(ticket);
};

// GET /tickets : lister les tickets (filtre + pagination)
export const listTickets = async (_req: Request, res: Response) => {
  const query: ListTicketsQuery = res.locals.query;

  const result = await ticketService.listTickets(query);

  res.json(result);
};

// GET /tickets/:id : récupérer un ticket
export const getTicket = async (_req: Request, res: Response) => {
  const { id }: TicketIdParams = res.locals.params;

  const ticket = await ticketService.getTicketById(id);

  res.json(ticket);
};

// PATCH /tickets/:id/status : modifier le statut d'un ticket
export const updateTicketStatus = async (_req: Request, res: Response) => {
  const { id }: TicketIdParams = res.locals.params;
  const { status }: UpdateTicketStatusInput = res.locals.body;

  const ticket = await ticketService.updateTicketStatus(id, status);

  res.json(ticket);
};
