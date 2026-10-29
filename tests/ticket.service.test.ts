import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import * as ticketService from "../src/services/ticket.service";

// Tests du service seul, sans HTTP. Ils utilisent la base définie par DATABASE_URL
const unknownId = "00000000-0000-4000-8000-000000000000";
let ticketId: string;

before(async () => {
  const ticket = await ticketService.createTicket({
    title: "Ticket service",
    description: "Créé par les tests du service",
    email: "service@example.com",
  });
  ticketId = ticket.id;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { id: ticketId } });
  await prisma.$disconnect();
});

describe("ticketService", () => {
  test("createTicket crée un ticket OPEN", async () => {
    const ticket = await ticketService.getTicketById(ticketId);
    assert.equal(ticket.title, "Ticket service");
    assert.equal(ticket.status, "OPEN");
  });

  test("listTickets calcule la pagination", async () => {
    const { data, meta } = await ticketService.listTickets({ page: 1, limit: 1 });
    assert.ok(data.length <= 1);
    assert.equal(meta.limit, 1);
    assert.equal(meta.totalPages, meta.total);
  });

  test("getTicketById lève une erreur P2025 si le ticket n'existe pas", async () => {
    await assert.rejects(ticketService.getTicketById(unknownId), { code: "P2025" });
  });

  test("updateTicketStatus ne modifie que le statut", async () => {
    const ticket = await ticketService.updateTicketStatus(ticketId, "RESOLVED");
    assert.equal(ticket.status, "RESOLVED");
    assert.equal(ticket.title, "Ticket service");
  });

  test("updateTicketStatus lève une erreur P2025 si le ticket n'existe pas", async () => {
    await assert.rejects(ticketService.updateTicketStatus(unknownId, "CLOSED"), { code: "P2025" });
  });
});
