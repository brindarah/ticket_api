import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { HttpError } from "../src/lib/httpError";
import * as ticketService from "../src/services/ticket.service";
import { createTestContext } from "./helpers/testContext";

// Tests du service seul, sans HTTP (base de test)
const ctx = createTestContext();
const unknownId = "00000000-0000-4000-8000-000000000000";
let owner: ticketService.TicketActor;
let other: ticketService.TicketActor;
let admin: ticketService.TicketActor;
let ticketId: string;

const httpError = (statusCode: number) => (err: unknown) =>
  err instanceof HttpError && err.statusCode === statusCode;

before(async () => {
  await ctx.start();
  owner = (await ctx.createUser({ name: "svc-owner" })).user;
  other = (await ctx.createUser({ name: "svc-other" })).user;
  admin = (await ctx.createUser({ name: "svc-admin", role: "SUPER_ADMIN" })).user;
  const ticket = await ticketService.createTicket(
    { title: "Ticket service", description: "Créé par les tests du service" },
    owner.id,
  );
  ticketId = ticket.id;
});
after(() => ctx.stop());

describe("ticketService", () => {
  test("createTicket crée un ticket OPEN rattaché à son auteur", async () => {
    const ticket = await ticketService.getTicketById(ticketId);
    assert.equal(ticket.title, "Ticket service");
    assert.equal(ticket.status, "OPEN");
    assert.equal(ticket.createdById, owner.id);
    assert.deepEqual(Object.keys(ticket.createdBy).sort(), ["id", "nom", "prenom"]);
  });

  test("listTickets calcule la pagination", async () => {
    const { data, meta } = await ticketService.listTickets({ page: 1, limit: 1, sort: "createdAt", order: "desc" });
    assert.ok(data.length <= 1);
    assert.equal(meta.limit, 1);
    assert.equal(meta.totalPages, meta.total);
  });

  test("getTicketById lève une HttpError 404 si le ticket n'existe pas", async () => {
    await assert.rejects(ticketService.getTicketById(unknownId), httpError(404));
  });

  test("updateTicketStatus : le créateur ne modifie que le statut", async () => {
    const ticket = await ticketService.updateTicketStatus(owner, ticketId, "RESOLVED");
    assert.equal(ticket.status, "RESOLVED");
    assert.equal(ticket.title, "Ticket service");
  });

  test("updateTicketStatus : 403 pour un autre utilisateur, 200 pour un SUPER_ADMIN", async () => {
    await assert.rejects(ticketService.updateTicketStatus(other, ticketId, "CLOSED"), httpError(403));
    const ticket = await ticketService.updateTicketStatus(admin, ticketId, "CLOSED");
    assert.equal(ticket.status, "CLOSED");
  });

  test("updateTicketStatus : le rôle vient de l'acteur, pas du ticket", async () => {
    // Un USER qui se prétendrait propriétaire par un autre id reste refusé
    await assert.rejects(
      ticketService.updateTicketStatus({ id: other.id, role: "USER" }, ticketId, "OPEN"),
      httpError(403),
    );
  });

  test("updateTicketStatus lève une HttpError 404 si le ticket n'existe pas", async () => {
    await assert.rejects(ticketService.updateTicketStatus(admin, unknownId, "CLOSED"), httpError(404));
  });

  test("le ticket ne peut pas être supprimé indirectement avec son auteur (onDelete: Restrict)", async () => {
    await assert.rejects(prisma.user.delete({ where: { id: owner.id } }));
    assert.ok(await prisma.ticket.findUnique({ where: { id: ticketId } }));
  });
});
