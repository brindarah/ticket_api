import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Resend } from "resend";
import {
  EmailConfigError,
  getEmailConfig,
  getResendClient,
  resetResendClientForTests,
} from "../src/lib/resend";

// Clé fictive : aucun appel réseau n'est fait dans ces tests
const fakeKey = "re_fake_test_key_123456";
const validEnv = { RESEND_API_KEY: fakeKey, EMAIL_FROM: "Ticket API <onboarding@resend.dev>" };

describe("getEmailConfig", () => {
  test("retourne la configuration quand les variables sont valides", () => {
    assert.deepEqual(getEmailConfig(validEnv), {
      apiKey: fakeKey,
      from: "Ticket API <onboarding@resend.dev>",
    });
  });

  test("accepte une adresse d'expéditeur sans nom", () => {
    assert.equal(getEmailConfig({ ...validEnv, EMAIL_FROM: "support@example.com" }).from, "support@example.com");
  });

  test("signale les deux variables manquantes", () => {
    assert.throws(() => getEmailConfig({}), (err: unknown) => {
      assert.ok(err instanceof EmailConfigError);
      assert.match(err.message, /RESEND_API_KEY est manquante/);
      assert.match(err.message, /EMAIL_FROM est manquante/);
      return true;
    });
  });

  test("considère une variable vide comme manquante", () => {
    assert.throws(() => getEmailConfig({ ...validEnv, RESEND_API_KEY: "  " }), /RESEND_API_KEY est manquante/);
  });

  test("rejette une clé sans le préfixe re_ sans afficher sa valeur", () => {
    const wrongKey = "sk_secret_value_987";
    assert.throws(() => getEmailConfig({ ...validEnv, RESEND_API_KEY: wrongKey }), (err: unknown) => {
      assert.ok(err instanceof EmailConfigError);
      assert.match(err.message, /RESEND_API_KEY doit être une clé API Resend/);
      assert.equal(err.message.includes(wrongKey), false);
      return true;
    });
  });

  test("rejette un expéditeur invalide", () => {
    for (const from of ["pas-une-adresse", "Ticket API <pas-une-adresse>", "Ticket API onboarding@resend.dev"]) {
      assert.throws(() => getEmailConfig({ ...validEnv, EMAIL_FROM: from }), /EMAIL_FROM doit être une adresse email/);
    }
  });

  test("ne divulgue jamais la clé valide quand une autre variable est invalide", () => {
    assert.throws(() => getEmailConfig({ RESEND_API_KEY: fakeKey }), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes(fakeKey), false);
      return true;
    });
  });
});

describe("getResendClient", () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

  const setEnv = (key: string | undefined, from: string | undefined) => {
    if (key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = key;
    if (from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = from;
  };

  afterEach(() => {
    setEnv(saved.key, saved.from);
    resetResendClientForTests();
  });

  test("lève une EmailConfigError sans clé, au lieu de planter à l'import", () => {
    setEnv(undefined, undefined);
    assert.throws(() => getResendClient(), EmailConfigError);
  });

  test("crée un seul client Resend et le réutilise", () => {
    setEnv(fakeKey, validEnv.EMAIL_FROM);
    const first = getResendClient();
    assert.ok(first instanceof Resend);
    assert.equal(getResendClient(), first);
  });
});
