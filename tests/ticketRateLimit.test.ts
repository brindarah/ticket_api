import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createTicketCreationLimiter } from "../src/middlewares/rateLimit";
import { errorHandler } from "../src/middlewares/errorHandler";

// VULN-002 : la création de tickets est limitée PAR UTILISATEUR
test("création de tickets limitée par utilisateur (VULN-002)", async (t) => {
  const app = express();
  // Simule authenticate : l'utilisateur vient de l'en-tête x-user
  app.use((req, res, next) => {
    res.locals.user = { id: req.header("x-user") };
    next();
  });
  app.post("/tickets", createTicketCreationLimiter({ limit: 2, force: true }), (_req, res) => {
    res.status(201).json({ ok: true });
  });
  app.use(errorHandler);

  const server = app.listen(0);
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const post = (user: string) =>
    fetch(`http://127.0.0.1:${port}/tickets`, { method: "POST", headers: { "x-user": user } });

  // Moaze : 2 tickets autorisés, le 3e est bloqué
  assert.equal((await post("moaze")).status, 201);
  assert.equal((await post("moaze")).status, 201);
  const blocked = await post("moaze");
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, "TOO_MANY_REQUESTS");

  // Alice n'est pas pénalisée par le spam de Moaze
  assert.equal((await post("alice")).status, 201);
});
