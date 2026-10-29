import { Router } from "express";
import { validate } from "../middlewares/validate";
import { createTicketSchema, listTicketsQuerySchema } from "../schemas/ticket.schema";
import { createTicket, listTickets } from "../controllers/ticket.controller";

const router = Router();

router.post("/", validate(createTicketSchema, "body"), createTicket);
router.get("/", validate(listTicketsQuerySchema, "query"), listTickets);

export default router;
