import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { strongPassword } from "../src/schemas/password.schema";

// VULN-005 : les mots de passe faibles doivent être refusés
describe("Mots de passe faibles refusés (VULN-005)", () => {
  for (const weak of ["1234567", "12345678", "aaaaaaaa", "password", "11111111", "azerty123", "a".repeat(73)]) {
    test(`refuse "${weak.length > 20 ? "73 caractères" : weak}"`, () => {
      assert.equal(strongPassword.safeParse(weak).success, false);
    });
  }

  for (const ok of ["Ticket2026!", "monchat42", "TestAudit2026!"]) {
    test(`accepte "${ok}"`, () => {
      assert.equal(strongPassword.safeParse(ok).success, true);
    });
  }
});
