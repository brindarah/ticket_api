import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildInvitationEmail, INVITATION_SUBJECT } from "../src/emails/invitation.email";

const token = "a".repeat(64); // jeton fictif au format de generateRandomToken (64 caractères hex)
const params = { prenom: "Awa", token, expiresAt: new Date("2026-11-05T14:30:00Z") };

describe("buildInvitationEmail : contenu", () => {
  const email = buildInvitationEmail(params);

  test("utilise le sujet prévu", () => {
    assert.equal(email.subject, "Ticket API — Invitation à rejoindre la plateforme");
    assert.equal(email.subject, INVITATION_SUBJECT);
  });

  test("contient toutes les informations obligatoires, en texte et en HTML", () => {
    for (const body of [email.text, email.html ?? ""]) {
      assert.match(body, /Bonjour Awa,/);
      assert.match(body, /Un administrateur vous invite à rejoindre la plateforme/);
      assert.match(body, /POST \/auth\/accept-invitation/);
      assert.match(body, /valable jusqu'au (<strong>)?5 novembre 2026 à 15:30 \(heure de Paris\)/);
      assert.match(body, /personnel/);
      assert.match(body, /Ne le partagez avec personne/);
      assert.match(body, /vous pouvez ignorer ce message/);
    }
  });

  test("indique le jeton et le body attendu par l'API", () => {
    assert.ok(email.text.includes(`{ "token": "${token}", "password": "<votre mot de passe>" }`));
  });

  test("précède le chemin de l'URL de l'API quand elle est fournie", () => {
    const withUrl = buildInvitationEmail({ ...params, apiBaseUrl: "https://api.example.com/" });
    assert.match(withUrl.text, /POST https:\/\/api\.example\.com\/auth\/accept-invitation/);
  });

  test("ne contient pas de lien vers une page web inexistante", () => {
    assert.doesNotMatch(email.html ?? "", /<a\s/i);
  });
});

describe("buildInvitationEmail : sécurité", () => {
  test("échappe le prénom dans le HTML", () => {
    const email = buildInvitationEmail({ ...params, prenom: '<script>alert("x")</script>' });
    assert.doesNotMatch(email.html ?? "", /<script>/);
    assert.match(email.html ?? "", /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  });

  test("contient le jeton une seule fois par format, et jamais son hash", () => {
    const email = buildInvitationEmail(params);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    assert.equal(email.text.split(token).length - 1, 1);
    assert.equal((email.html ?? "").split(token).length - 1, 1);
    assert.equal(email.text.includes(hash), false);
    assert.equal((email.html ?? "").includes(hash), false);
  });

  test("n'incorpore pas la clé Resend ni d'autre variable d'environnement", () => {
    const saved = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_should_never_appear";
    try {
      const email = buildInvitationEmail(params);
      assert.equal(JSON.stringify(email).includes("re_should_never_appear"), false);
    } finally {
      if (saved === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = saved;
    }
  });

  test("n'écrit rien dans les logs", () => {
    const log = mock.method(console, "log");
    const error = mock.method(console, "error");
    const warn = mock.method(console, "warn");
    try {
      buildInvitationEmail(params);
      assert.equal(log.mock.callCount() + error.mock.callCount() + warn.mock.callCount(), 0);
    } finally {
      mock.restoreAll();
    }
  });

  test("refuse un jeton ou un prénom vide, sans recopier les valeurs", () => {
    assert.throws(() => buildInvitationEmail({ ...params, token: " " }), /prenom et token sont obligatoires/);
    assert.throws(() => buildInvitationEmail({ ...params, prenom: "" }), /prenom et token sont obligatoires/);
  });

  test("refuse une date d'expiration invalide", () => {
    assert.throws(
      () => buildInvitationEmail({ ...params, expiresAt: new Date("invalide") }),
      /expiresAt doit être une date valide/,
    );
  });
});
