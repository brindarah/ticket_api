import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers/testContext";

// VULN-004 : les en-têtes de sécurité doivent être présents sur toutes les réponses
describe("En-têtes de sécurité (VULN-004)", () => {
  const ctx = createTestContext();

  before(() => ctx.start());
  after(() => ctx.stop());

  test("les en-têtes de sécurité sont présents", async () => {
    const res = await ctx.request("GET", "/health");

    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("content-security-policy"));
    assert.ok(res.headers.get("strict-transport-security"));
    assert.ok(res.headers.get("x-frame-options"));
  });

  test("le serveur ne révèle toujours pas sa technologie", async () => {
    const res = await ctx.request("GET", "/health");
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});
