import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { buildPasswordResetEmail, PASSWORD_RESET_SUBJECT } from "../src/emails/password-reset.email";
import { createTestContext, sha256, tokenFromEmail } from "./helpers/testContext";

// Email de réinitialisation (contenu) et parcours forgot-password / reset-password de Personne 1,
// branché sur le service email partagé
const token = "b".repeat(64);
const expiresAt = new Date("2026-11-05T14:30:00Z");

describe("buildPasswordResetEmail", () => {
  const email = buildPasswordResetEmail({ token, expiresAt });

  test("contient les instructions API, la validité et les consignes de sécurité", () => {
    assert.equal(email.subject, PASSWORD_RESET_SUBJECT);
    for (const body of [email.text, email.html ?? ""]) {
      assert.match(body, /POST \/auth\/reset-password/);
      assert.match(body, /valable jusqu'au (<strong>)?5 novembre 2026 à 15:30 \(heure de Paris\)/);
      assert.match(body, /une seule fois/);
      assert.match(body, /Ne le partagez avec personne/);
      assert.match(body, /ignorez cet email/);
    }
    assert.ok(email.text.includes(`{ "token": "${token}", "password": "<nouveau mot de passe>" }`));
  });

  test("ne contient ni lien vers un frontend ni le hash du jeton", () => {
    assert.doesNotMatch(email.html ?? "", /<a\s/i);
    assert.doesNotMatch(email.text, /reset-password\?token=/);
    assert.equal(JSON.stringify(email).includes(sha256(token)), false);
  });

  test("utilise l'URL publique de l'API quand elle est fournie", () => {
    const withUrl = buildPasswordResetEmail({ token, expiresAt, apiBaseUrl: "https://api.example.com/" });
    assert.match(withUrl.text, /POST https:\/\/api\.example\.com\/auth\/reset-password/);
  });

  test("refuse un jeton vide ou une date invalide", () => {
    assert.throws(() => buildPasswordResetEmail({ token: " ", expiresAt }), /token est obligatoire/);
    assert.throws(() => buildPasswordResetEmail({ token, expiresAt: new Date("x") }), /date valide/);
  });
});

describe("POST /auth/forgot-password et /auth/reset-password", () => {
  const ctx = createTestContext();
  const genericResponse = { message: "If this account exists, a reset email has been sent" };

  before(() => ctx.start());
  beforeEach(() => ctx.resetEmail());
  afterEach(() => mock.restoreAll());
  after(() => ctx.stop());

  test("envoie le jeton par le service partagé, puis le jeton permet de changer le mot de passe", async () => {
    const { user } = await ctx.createUser({ name: "forgot", password: "ancien-mot-de-passe" });

    const res = await ctx.request("POST", "/auth/forgot-password", { email: user.email });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), genericResponse);

    assert.equal(ctx.sendCalls.length, 1);
    const call = ctx.sendCalls[0];
    assert.equal(call.payload.to, user.email);
    assert.equal(call.payload.subject, PASSWORD_RESET_SUBJECT);
    assert.equal(call.payload.from, "Ticket API <onboarding@resend.dev>");
    const resetToken = tokenFromEmail(call);
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(stored.tokenHash, sha256(resetToken));
    assert.deepEqual(call.options, { idempotencyKey: `password-reset-${stored.id}` });

    const reset = await ctx.request("POST", "/auth/reset-password", { token: resetToken, password: "nouveau-mot-de-passe" });
    assert.equal(reset.status, 200);
    const login = await ctx.request("POST", "/auth/login", { email: user.email, password: "nouveau-mot-de-passe" });
    assert.equal(login.status, 200);
  });

  test("même réponse et aucun email pour un compte inconnu", async () => {
    const res = await ctx.request("POST", "/auth/forgot-password", { email: ctx.testEmail("unknown") });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), genericResponse);
    assert.equal(ctx.sendCalls.length, 0);
  });

  test("échec de Resend : même réponse, journal sans jeton ni adresse email", async () => {
    const logged: unknown[] = [];
    mock.method(console, "error", (...args: unknown[]) => logged.push(...args));
    ctx.nextResponse = async () => ({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "You can only send testing emails to x@y.z" },
      headers: null,
    });
    const { user } = await ctx.createUser({ name: "failing", password: "mot-de-passe-1" });

    const res = await ctx.request("POST", "/auth/forgot-password", { email: user.email });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), genericResponse);

    const logText = JSON.stringify(logged);
    assert.ok(logText.includes("Password reset email not sent"));
    for (const secret of [tokenFromEmail(ctx.sendCalls[0]), user.email, "testing emails", "re_fake_test_key"]) {
      assert.equal(logText.includes(secret), false);
    }
  });

  test("configuration Resend absente : même réponse, l'API ne plante pas", async () => {
    mock.method(console, "error", () => {});
    delete process.env.RESEND_API_KEY;
    const { user } = await ctx.createUser({ name: "noconfig", password: "mot-de-passe-1" });
    const res = await ctx.request("POST", "/auth/forgot-password", { email: user.email });
    assert.equal(res.status, 200);
    assert.equal(ctx.sendCalls.length, 0);
  });
});
