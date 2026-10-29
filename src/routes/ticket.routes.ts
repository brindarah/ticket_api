import { Router } from "express";
import { validate } from "../middlewares/validate";
import {
  createTicketSchema,
  listTicketsQuerySchema,
  ticketIdParamsSchema,
  updateTicketStatusSchema,
} from "../schemas/ticket.schema";
import {
  createTicket,
  getTicket,
  listTickets,
  updateTicketStatus,
} from "../controllers/ticket.controller";

const router = Router();

router.post("/", validate(createTicketSchema, "body"), createTicket);
router.get("/", validate(listTicketsQuerySchema, "query"), listTickets);
router.get("/:id", validate(ticketIdParamsSchema, "params"), getTicket);
router.patch(
  "/:id/status",
  validate(ticketIdParamsSchema, "params"),
  validate(updateTicketStatusSchema, "body"),
  updateTicketStatus,
);

export default router;
