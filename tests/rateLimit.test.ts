import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createRateLimiter } from "../src/middlewares/rateLimit";
import { errorHandler } from "../src/middlewares/errorHandler";

// Petite app de test avec un limiteur à 2 requêtes
async function startApp(options: { skipSuccessfulRequests?: boolean } = {}) {
  const app = express();
  app.use(createRateLimiter({ windowMs: 60_000, limit: 2, force: true, ...options }));
  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/fail", (_req, res) => {
    res.status(401).json({ error: "nope" });
  });
  app.use(errorHandler);

  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

test("rate limit : 429 au-delà de la limite, au format d'erreur de l'API", async (t) => {
  const { server, url } = await startApp();
  t.after(() => server.close());

  assert.equal((await fetch(`${url}/ok`)).status, 200);
  assert.equal((await fetch(`${url}/ok`)).status, 200);

  const res = await fetch(`${url}/ok`);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), {
    error: "Too many requests, please try again later",
    code: "TOO_MANY_REQUESTS",
  });
});

test("rate limit login : seuls les échecs comptent", async (t) => {
  const { server, url } = await startApp({ skipSuccessfulRequests: true });
  t.after(() => server.close());

  // Les succès ne consomment pas la limite
  for (let i = 0; i < 5; i++) {
    assert.equal((await fetch(`${url}/ok`)).status, 200);
  }

  // Deux échecs autorisés, le troisième est bloqué
  assert.equal((await fetch(`${url}/fail`)).status, 401);
  assert.equal((await fetch(`${url}/fail`)).status, 401);
  assert.equal((await fetch(`${url}/fail`)).status, 429);
});