import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  AI_RESPONSE_MAX_CHARS_DEFAULT,
  AIResponseError,
  classifyAndRespond,
  generateTicketResponse,
  getAIConfig,
  OUT_OF_SCOPE_REPLY,
  resetOpenAIClientForTests,
  truncateReply,
} from "../src/services/ai.service";
import { TICKET_DESCRIPTION_MAX_LENGTH, TICKET_TITLE_MAX_LENGTH } from "../src/schemas/ticket.schema";
import { fakeModelReply, installFakeOpenAI, modelReply } from "./helpers/fakeOpenAI";
import { createTestContext } from "./helpers/testContext";

// Limites et gestion des erreurs de l'IA (OpenAI mocké : aucun appel réel)
const savedMax = process.env.AI_RESPONSE_MAX_CHARS;
beforeEach(() => {
  delete process.env.AI_RESPONSE_MAX_CHARS;
});
afterEach(() => {
  resetOpenAIClientForTests();
  if (savedMax === undefined) delete process.env.AI_RESPONSE_MAX_CHARS;
  else process.env.AI_RESPONSE_MAX_CHARS = savedMax;
});

// L'erreur attendue, avec sa raison
const aiError = (reason: string) => (err: unknown) => err instanceof AIResponseError && err.reason === reason;

describe("Limites : configuration de la longueur des réponses", () => {
  test("valeur par défaut : 1200 caractères", () => {
    assert.equal(AI_RESPONSE_MAX_CHARS_DEFAULT, 1200);
    assert.equal(getAIConfig({}).maxResponseChars, 1200);
    assert.equal(getAIConfig({ AI_RESPONSE_MAX_CHARS: "  " }).maxResponseChars, 1200);
  });

  test("valeur configurée et nombre de tokens demandé en conséquence", () => {
    const config = getAIConfig({ AI_RESPONSE_MAX_CHARS: "600" });
    assert.equal(config.maxResponseChars, 600);
    assert.equal(config.maxCompletionTokens, 350);
  });

  test("refuse une valeur invalide sans recopier la valeur", () => {
    for (const value of ["abc", "399", "4001", "12.5", "-1"]) {
      assert.throws(() => getAIConfig({ AI_RESPONSE_MAX_CHARS: value }), (err: unknown) => {
        assert.ok(aiError("config")(err), value);
        assert.equal((err as Error).message.includes(value), false);
        return true;
      });
    }
  });

  test("configuration invalide : aucune requête n'est envoyée à OpenAI", async () => {
    process.env.AI_RESPONSE_MAX_CHARS = "10";
    const calls = fakeModelReply("IT_SUPPORT", "ok");
    await assert.rejects(classifyAndRespond("Bug", "Ça plante"), aiError("config"));
    assert.equal(calls.length, 0);
  });

  test("la limite de tokens envoyée suit la configuration", async () => {
    process.env.AI_RESPONSE_MAX_CHARS = "800";
    const calls = fakeModelReply("IT_SUPPORT", "ok");
    await classifyAndRespond("Bug", "Ça plante");
    assert.equal(calls[0].max_completion_tokens, getAIConfig({ AI_RESPONSE_MAX_CHARS: "800" }).maxCompletionTokens);
  });

  test("le refus hors périmètre tient dans la plus petite limite autorisée", () => {
    assert.ok(OUT_OF_SCOPE_REPLY.length <= 400);
  });
});

describe("Limites : longueur des réponses enregistrées", () => {
  test("une réponse courte n'est pas modifiée", () => {
    assert.equal(truncateReply("Redémarrez le poste.", 400), "Redémarrez le poste.");
  });

  test("une réponse trop longue est coupée à la fin d'une phrase", () => {
    const text = `${"Première phrase complète. ".repeat(20)}Dernière phrase qui dépasse la limite.`;
    const result = truncateReply(text, 400);
    assert.ok(result.length <= 400);
    assert.ok(result.endsWith("."));
  });

  test("sans fin de phrase, la coupe se fait entre deux mots, avec des points de suspension", () => {
    const result = truncateReply("mot ".repeat(200), 400);
    assert.ok(result.length <= 400);
    assert.ok(result.endsWith("mot…"));
  });

  test("la réponse du modèle est limitée à AI_RESPONSE_MAX_CHARS", async () => {
    process.env.AI_RESPONSE_MAX_CHARS = "400";
    fakeModelReply("IT_SUPPORT", "Vérifiez la connexion réseau. ".repeat(60));
    const reply = await generateTicketResponse("Réseau", "Plus d'accès à Internet");
    assert.ok(reply.length <= 400, `longueur ${reply.length}`);
    assert.ok(reply.length > 200);
  });
});

describe("Limites : sorties vides ou malformées du modèle", () => {
  const cases: [string, Parameters<typeof installFakeOpenAI>[0], string][] = [
    ["contenu null", () => ({ content: null }), "empty"],
    ["contenu vide", () => ({ content: "" }), "empty"],
    ["espaces", () => ({ content: "   " }), "empty"],
    ["texte libre", () => ({ content: "Bonjour, redémarrez votre ordinateur." }), "malformed"],
    ["JSON tronqué", () => ({ content: '{"category":"IT_SUPPORT","reply":"Redém' }), "malformed"],
    ["catégorie inconnue", () => ({ content: modelReply("SUPPORT", "x") }), "invalid_format"],
    ["réponse vide dans le JSON", () => ({ content: modelReply("IT_SUPPORT", "   ") }), "empty"],
    ["coupé par la limite de tokens", () => ({ content: '{"category":"IT_', finish_reason: "length" }), "truncated"],
    ["filtre de contenu", () => ({ content: null, finish_reason: "content_filter" }), "content_filter"],
  ];
  for (const [name, behavior, reason] of cases) {
    test(`${name} : erreur ${reason}`, async () => {
      installFakeOpenAI(behavior);
      await assert.rejects(generateTicketResponse("Bug", "Ça plante"), aiError(reason));
    });
  }

  test("refus de sécurité du modèle : traité comme hors périmètre", async () => {
    installFakeOpenAI(() => ({ content: null, refusal: "I can't help with that." }));
    assert.deepEqual(await classifyAndRespond("Demande", "Contenu refusé par le modèle"), {
      category: "OUT_OF_SCOPE",
      reply: OUT_OF_SCOPE_REPLY,
    });
  });
});

describe("Limites : erreurs OpenAI", () => {
  test("clé absente : erreur de configuration", async () => {
    // Aucun faux client et OPENAI_API_KEY vide (testEnv.ts)
    await assert.rejects(generateTicketResponse("Bug", "Ça plante"), aiError("config"));
  });

  test("erreur HTTP d'OpenAI : le message du fournisseur n'est pas recopié", async () => {
    installFakeOpenAI(() => {
      throw new OpenAI.APIError(401, undefined, "Incorrect API key provided: sk-proj-SECRET123", undefined);
    });
    await assert.rejects(generateTicketResponse("Bug", "Ça plante"), (err: unknown) => {
      assert.ok(aiError("provider")(err));
      assert.equal((err as Error).message, "Erreur OpenAI (401)");
      assert.equal((err as Error).message.includes("SECRET123"), false);
      return true;
    });
  });

  test("erreur réseau ou exception inattendue : erreur provider générique", async () => {
    installFakeOpenAI(() => {
      throw new Error("socket hang up");
    });
    await assert.rejects(generateTicketResponse("Bug", "Ça plante"), (err: unknown) => {
      assert.ok(aiError("provider")(err));
      assert.equal((err as Error).message, "Erreur OpenAI (réseau)");
      return true;
    });
  });

  test("les messages d'erreur ne contiennent jamais le contenu du ticket", async () => {
    installFakeOpenAI(() => ({ content: "pas du JSON" }));
    await assert.rejects(generateTicketResponse("Titre-SECRET", "Description-SECRET"), (err: unknown) => {
      assert.equal((err as Error).message.includes("SECRET"), false);
      return true;
    });
  });
});

describe("Limites : titre et description envoyés à l'IA", () => {
  test("refuse un titre ou une description hors limites, sans appeler OpenAI", async () => {
    const calls = fakeModelReply("IT_SUPPORT", "ok");
    for (const [title, description] of [
      ["x".repeat(TICKET_TITLE_MAX_LENGTH + 1), "Description"],
      ["Titre", "x".repeat(TICKET_DESCRIPTION_MAX_LENGTH + 1)],
      ["   ", "Description"],
      ["Titre", ""],
    ]) {
      await assert.rejects(classifyAndRespond(title, description), aiError("invalid_input"));
    }
    assert.equal(calls.length, 0);
  });

  test("accepte un titre et une description à la limite", async () => {
    const calls = fakeModelReply("IT_SUPPORT", "ok");
    await classifyAndRespond("x".repeat(TICKET_TITLE_MAX_LENGTH), "x".repeat(TICKET_DESCRIPTION_MAX_LENGTH));
    assert.equal(calls.length, 1);
  });
});

describe("Limites : validation Zod de POST /tickets", () => {
  const ctx = createTestContext();
  let token: string;
  before(async () => {
    await ctx.start();
    token = (await ctx.createUser({ name: "ai-limits" })).accessToken;
  });
  after(() => ctx.stop());

  test("description de 5000 caractères acceptée, 5001 refusée (400)", async () => {
    fakeModelReply("IT_SUPPORT", "ok");
    const ok = await ctx.request("POST", "/tickets", { title: "Long", description: "a".repeat(5000) }, token);
    assert.equal(ok.status, 201);

    const tooLong = await ctx.request("POST", "/tickets", { title: "Long", description: "a".repeat(5001) }, token);
    assert.equal(tooLong.status, 400);
    const body = await tooLong.json();
    assert.equal(body.details[0].field, "description");
  });

  test("titre de plus de 200 caractères refusé (400)", async () => {
    const res = await ctx.request("POST", "/tickets", { title: "t".repeat(201), description: "Bug" }, token);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, "title");
  });

  test("les espaces autour du texte ne comptent pas dans la limite", async () => {
    fakeModelReply("IT_SUPPORT", "ok");
    const res = await ctx.request("POST", "/tickets", { title: "Bug", description: `  ${"a".repeat(5000)}  ` }, token);
    assert.equal(res.status, 201);
  });
});
