import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAndRespond,
  generateTicketResponse,
  parseTicketReply,
  resetOpenAIClientForTests,
  SYSTEM_PROMPT,
} from "../src/services/ai.service";
import { fakeModelReply, installFakeOpenAI, modelReply } from "./helpers/fakeOpenAI";

// Classification IT_SUPPORT / OUT_OF_SCOPE (OpenAI mocké : aucun appel réel)
afterEach(() => resetOpenAIClientForTests());

describe("Classification : sortie structurée demandée au modèle", () => {
  test("un seul appel, avec un format JSON strict limité aux deux catégories", async () => {
    const calls = fakeModelReply("IT_SUPPORT", "Redémarrez le poste.");
    await classifyAndRespond("Mon ordinateur ne démarre plus", "Écran noir au démarrage.");

    assert.equal(calls.length, 1);
    const format = calls[0].response_format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    const schema = format.json_schema.schema;
    assert.deepEqual(schema.required.sort(), ["category", "reply"]);
    assert.deepEqual(schema.properties.category.enum, ["IT_SUPPORT", "OUT_OF_SCOPE"]);
    assert.equal(schema.additionalProperties, false);
  });

  test("les instructions définissent les deux catégories et demandent de juger l'intention", () => {
    assert.match(SYSTEM_PROMPT, /IT_SUPPORT/);
    assert.match(SYSTEM_PROMPT, /OUT_OF_SCOPE/);
    assert.match(SYSTEM_PROMPT, /intention réelle/);
    assert.match(SYSTEM_PROMPT, /pas la présence de certains mots/);
  });

  test("les exemples du cahier des charges sont fournis au modèle", () => {
    for (const example of [
      "Mon ordinateur ne démarre plus",
      "Comment installer Docker sur Windows ?",
      "Mon API retourne une erreur 500",
      "Recommande-moi un restaurant",
      "Génère-moi une image",
      "Donne-moi des conseils de voyage",
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(example), example);
    }
  });
});

describe("Classification : lecture de la réponse du modèle", () => {
  test("renvoie la catégorie IT_SUPPORT et la réponse", async () => {
    fakeModelReply("IT_SUPPORT", "Vérifiez le câble d'alimentation.");
    assert.deepEqual(await classifyAndRespond("PC éteint", "Il ne s'allume plus."), {
      category: "IT_SUPPORT",
      reply: "Vérifiez le câble d'alimentation.",
    });
  });

  test("renvoie la catégorie OUT_OF_SCOPE", async () => {
    fakeModelReply("OUT_OF_SCOPE", "Je traite uniquement le support informatique.");
    const result = await classifyAndRespond("Restaurant", "Recommande-moi un restaurant");
    assert.equal(result.category, "OUT_OF_SCOPE");
  });

  test("generateTicketResponse renvoie le texte de la réponse", async () => {
    fakeModelReply("IT_SUPPORT", "  Réessayez après redémarrage.  ");
    assert.equal(await generateTicketResponse("Bug", "Ça plante"), "Réessayez après redémarrage.");
  });

  test("refuse une catégorie inconnue", () => {
    assert.throws(() => parseTicketReply(modelReply("OTHER", "x")));
    assert.throws(() => parseTicketReply(modelReply("it_support", "x")));
  });

  test("refuse un champ manquant ou supplémentaire", () => {
    assert.throws(() => parseTicketReply(JSON.stringify({ category: "IT_SUPPORT" })));
    assert.throws(() => parseTicketReply(JSON.stringify({ reply: "x" })));
    assert.throws(() =>
      parseTicketReply(JSON.stringify({ category: "IT_SUPPORT", reply: "x", image_url: "http://x" })),
    );
  });

  test("refuse une réponse vide ou qui n'est pas du JSON", () => {
    for (const content of [null, undefined, "", "   ", "Bonjour, voici ma réponse", "[1, 2]"]) {
      assert.throws(() => parseTicketReply(content), String(content));
    }
  });

  test("une réponse non conforme fait échouer la génération", async () => {
    installFakeOpenAI(() => ({ content: modelReply("MAYBE", "x") }));
    await assert.rejects(generateTicketResponse("Bug", "Ça plante"));
  });
});
