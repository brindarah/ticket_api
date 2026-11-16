import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { prisma } from "../src/lib/prisma";
import { setOpenAIClientForTests, resetOpenAIClientForTests } from "../src/services/ai.service";
import { createTestContext } from "./helpers/testContext";

// Faux client OpenAI : enregistre chaque appel et renvoie ce que le test a prévu
function fakeOpenAI(behavior: () => Promise<string | null>) {
  const calls: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: any) => {
          calls.push(params);
          const content = await behavior();
          return { choices: [{ message: { content } }] };
        },
      },
    },
  };
  setOpenAIClientForTests(client as unknown as OpenAI);
  return calls;
}

describe("Réponse IA à la création d'un ticket (OpenAI mocké)", () => {
  const ctx = createTestContext();

  before(() => ctx.start());
  beforeEach(() => ctx.resetEmail());
  afterEach(() => resetOpenAIClientForTests());
  after(() => ctx.stop());

  const newTicket = {
    title: "Impossible de me connecter",
    description: "Depuis ce matin, le site me dit que mon mot de passe est incorrect.",
  };

  async function createTicket() {
    const { accessToken } = await ctx.createUser({ name: `ai-${Date.now()}-${Math.random()}` });
    return ctx.request("POST", "/tickets", newTicket, accessToken);
  }

  test("succès : la réponse est enregistrée, statut COMPLETED", async () => {
    const calls = fakeOpenAI(async () => "Bonjour, nous avons bien reçu votre demande.");

    const res = await createTicket();
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.aiResponseStatus, "COMPLETED");
    assert.equal(body.aiResponse, "Bonjour, nous avons bien reçu votre demande.");
    assert.ok(body.aiResponseAt);

    // La réponse est bien en base
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(stored.aiResponse, "Bonjour, nous avons bien reçu votre demande.");
    assert.equal(stored.aiResponseStatus, "COMPLETED");

    // Une seule génération
    assert.equal(calls.length, 1);
  });

  test("seuls le titre et la description sont envoyés à OpenAI", async () => {
    const calls = fakeOpenAI(async () => "Réponse");

    await createTicket();
    const sent = JSON.stringify(calls[0].messages);
    assert.ok(sent.includes(newTicket.title));
    assert.ok(sent.includes(newTicket.description));
    assert.equal(sent.includes("@"), false, "aucun email ne doit être envoyé");
  });

  test("erreur OpenAI : le ticket est conservé, statut FAILED", async () => {
    fakeOpenAI(async () => {
      throw new Error("OpenAI indisponible");
    });

    const res = await createTicket();
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.aiResponseStatus, "FAILED");
    assert.equal(body.aiResponse, null);
    assert.equal(body.aiResponseAt, null);

    const stored = await prisma.ticket.findUnique({ where: { id: body.id } });
    assert.ok(stored, "le ticket doit exister malgré l'échec");
  });

  test("réponse vide d'OpenAI : statut FAILED", async () => {
    fakeOpenAI(async () => "   ");

    const body = await (await createTicket()).json();
    assert.equal(body.aiResponseStatus, "FAILED");
    assert.equal(body.aiResponse, null);
  });

  test("clé OpenAI absente : statut FAILED, le ticket est créé", async () => {
    const res = await createTicket();
    assert.equal(res.status, 201);
    assert.equal((await res.json()).aiResponseStatus, "FAILED");
  });

  test("aucune régénération : consulter le ticket n'appelle pas OpenAI, et il n'existe pas de route de régénération", async () => {
    const calls = fakeOpenAI(async () => "Réponse unique");
    const { accessToken } = await ctx.createUser({ name: `ai-regen-${Date.now()}` });

    const created = await (await ctx.request("POST", "/tickets", newTicket, accessToken)).json();
    await ctx.request("GET", `/tickets/${created.id}`, undefined, accessToken);
    assert.equal(calls.length, 1);

    const regen = await ctx.request("POST", `/tickets/${created.id}/ai-response`, undefined, accessToken);
    assert.equal(regen.status, 404);
    assert.equal(calls.length, 1);
  });
});
