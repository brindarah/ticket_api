import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";

// Tests d'intégration : ils utilisent la base définie par DATABASE_URL
let server: Server;
let baseUrl: string;
let ticketId: string;
const createdIds: string[] = [];
const unknownId = "00000000-0000-4000-8000-000000000000";

const request = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  server = app.listen(0);
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  const ticket = await prisma.ticket.create({
    data: { title: "Test ticket", description: "Créé par les tests", email: "test@example.com" },
  });
  ticketId = ticket.id;
});

after(async () => {
  await prisma.ticket.deleteMany({ where: { id: { in: [ticketId, ...createdIds] } } });
  await prisma.$disconnect();
  server.close();
});

describe("POST /tickets", () => {
  const valid = { title: "Connexion impossible", description: "Erreur 500", email: "user@example.com" };

  test("retourne 201 et le ticket créé avec le statut OPEN par défaut", async () => {
    const res = await request("POST", "/tickets", valid);
    assert.equal(res.status, 201);
    const body = await res.json();
    createdIds.push(body.id);
    assert.equal(body.title, valid.title);
    assert.equal(body.status, "OPEN");
  });

  test("ignore un champ priority, absent du modèle", async () => {
    const res = await request("POST", "/tickets", { ...valid, priority: "HIGH" });
    assert.equal(res.status, 201);
    const body = await res.json();
    createdIds.push(body.id);
    assert.equal("priority" in body, false);
  });

  test("retourne 400 pour un titre trop court", async () => {
    const res = await request("POST", "/tickets", { ...valid, title: "ab" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, "title");
  });

  test("retourne 400 pour un email invalide", async () => {
    const res = await request("POST", "/tickets", { ...valid, email: "pas-un-email" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, "email");
  });
});

describe("GET /tickets", () => {
  test("retourne 200 avec les données et la pagination par défaut", async () => {
    const res = await request("GET", "/tickets");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.equal(body.meta.page, 1);
    assert.equal(body.meta.limit, 10);
    assert.ok(body.meta.total >= 1);
    assert.equal(body.meta.totalPages, Math.ceil(body.meta.total / 10));
  });

  test("filtre par statut", async () => {
    const res = await request("GET", "/tickets?status=OPEN&limit=100");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.every((t: { status: string }) => t.status === "OPEN"));
  });

  test("ignore un filtre priority au lieu de provoquer une erreur 500", async () => {
    const res = await request("GET", "/tickets?priority=HIGH");
    assert.equal(res.status, 200);
  });

  test("retourne 400 pour un statut ou une pagination invalides", async () => {
    assert.equal((await request("GET", "/tickets?status=DONE")).status, 400);
    assert.equal((await request("GET", "/tickets?limit=0")).status, 400);
  });
});

describe("GET /tickets/:id", () => {
  test("retourne 200 et le ticket existant", async () => {
    const res = await request("GET", `/tickets/${ticketId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ticketId);
    assert.equal(body.title, "Test ticket");
  });

  test("retourne 404 si le ticket n'existe pas", async () => {
    const res = await request("GET", `/tickets/${unknownId}`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Ticket not found" });
  });

  test("retourne 400 si l'identifiant n'est pas un UUID", async () => {
    const res = await request("GET", "/tickets/abc");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Validation failed");
    assert.equal(body.details[0].field, "id");
  });
});

describe("PATCH /tickets/:id/status", () => {
  test("retourne 200 et le ticket avec le nouveau statut", async () => {
    const res = await request("PATCH", `/tickets/${ticketId}/status`, { status: "IN_PROGRESS" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ticketId);
    assert.equal(body.status, "IN_PROGRESS");
    assert.equal(body.title, "Test ticket");
  });

  test("retourne 404 si le ticket n'existe pas", async () => {
    const res = await request("PATCH", `/tickets/${unknownId}/status`, { status: "CLOSED" });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Ticket not found" });
  });

  test("retourne 400 pour un statut invalide", async () => {
    const res = await request("PATCH", `/tickets/${ticketId}/status`, { status: "DONE" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.details[0].field, "status");
  });

  test("retourne 400 si le statut est absent", async () => {
    const res = await request("PATCH", `/tickets/${ticketId}/status`, {});
    assert.equal(res.status, 400);
  });

  test("retourne 400 si d'autres champs sont envoyés et ne modifie rien", async () => {
    const res = await request("PATCH", `/tickets/${ticketId}/status`, {
      status: "CLOSED",
      title: "Titre piraté",
    });
    assert.equal(res.status, 400);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assert.equal(ticket.title, "Test ticket");
    assert.equal(ticket.status, "IN_PROGRESS");
  });

  test("retourne 400 si l'identifiant n'est pas un UUID", async () => {
    const res = await request("PATCH", "/tickets/abc/status", { status: "CLOSED" });
    assert.equal(res.status, 400);
  });
});
