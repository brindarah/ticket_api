import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CreateEmailOptions, CreateEmailRequestOptions, CreateEmailResponse } from "resend";
import { EmailSender, sendEmail } from "../src/services/email.service";
import { resetResendClientForTests } from "../src/lib/resend";

// Faux client Resend : enregistre les appels et renvoie la réponse choisie. Aucun email réel.
function fakeClient(response: CreateEmailResponse | (() => Promise<CreateEmailResponse>)) {
  const calls: { payload: CreateEmailOptions; options?: CreateEmailRequestOptions }[] = [];
  const client: EmailSender = {
    emails: {
      send: async (payload, options) => {
        calls.push({ payload, options });
        return typeof response === "function" ? response() : response;
      },
    },
  };
  return { client, calls };
}

const success: CreateEmailResponse = { data: { id: "email_123" }, error: null, headers: null };
const config = { apiKey: "re_fake_key", from: "Ticket API <onboarding@resend.dev>" };
const input = { to: "alice@example.com", subject: "Bonjour", text: "Contenu texte" };

describe("sendEmail : paramètres transmis à Resend", () => {
  test("transmet l'expéditeur configuré, le destinataire, le sujet et le texte", async () => {
    const { client, calls } = fakeClient(success);
    await sendEmail(input, {}, { client, config });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload, {
      from: config.from,
      to: "alice@example.com",
      subject: "Bonjour",
      text: "Contenu texte",
    });
    assert.equal(calls[0].options, undefined);
  });

  test("transmet le HTML, l'adresse de réponse et la clé d'idempotence", async () => {
    const { client, calls } = fakeClient(success);
    await sendEmail(
      { ...input, html: "<p>Contenu</p>", replyTo: "support@example.com" },
      { idempotencyKey: "invitation-42" },
      { client, config },
    );
    assert.equal((calls[0].payload as { html?: string }).html, "<p>Contenu</p>");
    assert.equal(calls[0].payload.replyTo, "support@example.com");
    assert.deepEqual(calls[0].options, { idempotencyKey: "invitation-42" });
  });
});

describe("sendEmail : résultats", () => {
  test("retourne accepted avec l'identifiant Resend en cas de succès", async () => {
    const { client } = fakeClient(success);
    assert.deepEqual(await sendEmail(input, {}, { client, config }), {
      ok: true,
      status: "accepted",
      messageId: "email_123",
    });
  });

  test("retourne l'erreur du fournisseur sans prétendre que l'email est parti", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "Domaine non vérifié" },
      headers: null,
    });
    assert.deepEqual(await sendEmail(input, {}, { client, config }), {
      ok: false,
      reason: "provider",
      message: "Domaine non vérifié",
      providerError: { name: "validation_error", statusCode: 403 },
    });
  });

  test("retourne une erreur réseau renvoyée par le SDK", async () => {
    const { client } = fakeClient({
      data: null,
      error: { name: "application_error", statusCode: null, message: "Unable to fetch data." },
      headers: null,
    });
    const result = await sendEmail(input, {}, { client, config });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "provider");
  });

  test("transforme une exception en échec unexpected, sans en recopier le message", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("détail interne re_secret_key");
    });
    const result = await sendEmail(input, {}, { client, config });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "unexpected");
    assert.equal(!result.ok && result.message.includes("re_secret_key"), false);
  });
});

describe("sendEmail : validation des paramètres", () => {
  test("refuse les paramètres invalides sans appeler Resend ni recopier les valeurs", async () => {
    const { client, calls } = fakeClient(success);
    const result = await sendEmail({ to: "pas-un-email", subject: " ", text: "" }, {}, { client, config });
    assert.equal(calls.length, 0);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "invalid_input");
    assert.equal(!result.ok && result.message, "Champs invalides : to, subject, text");
    assert.equal(!result.ok && result.message.includes("pas-un-email"), false);
  });

  test("refuse un sujet sur plusieurs lignes", async () => {
    const { client, calls } = fakeClient(success);
    const result = await sendEmail({ ...input, subject: "Bonjour\r\nBcc: x@example.com" }, {}, { client, config });
    assert.equal(calls.length, 0);
    assert.equal(!result.ok && result.reason, "invalid_input");
  });
});

describe("sendEmail : configuration", () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

  afterEach(() => {
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.key;
    if (saved.from === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = saved.from;
    resetResendClientForTests();
  });

  test("retourne un échec config quand les variables sont absentes", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const result = await sendEmail(input);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, "config");
    assert.match(!result.ok ? result.message : "", /RESEND_API_KEY est manquante/);
  });

  test("retourne un échec config sans divulguer une clé invalide", async () => {
    process.env.RESEND_API_KEY = "sk_not_a_resend_key";
    process.env.EMAIL_FROM = "Ticket API <onboarding@resend.dev>";
    const result = await sendEmail(input);
    assert.equal(!result.ok && result.reason, "config");
    assert.equal(!result.ok && result.message.includes("sk_not_a_resend_key"), false);
  });
});
