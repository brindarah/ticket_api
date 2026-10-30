import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import bcrypt from "bcryptjs";
import type { CreateEmailOptions, CreateEmailRequestOptions, CreateEmailResponse, Resend } from "resend";
import app from "../../src/app";
import { prisma } from "../../src/lib/prisma";
import { resetResendClientForTests, setResendClientForTests } from "../../src/lib/resend";
import { signAccessToken } from "../../src/lib/tokens";

// Outils communs aux tests d'intégration : base réelle (DATABASE_URL), Resend toujours simulé.
// Le .env réel est chargé avec Prisma : la clé et le client sont remplacés avant chaque test.

export type SendCall = { payload: CreateEmailOptions; options?: CreateEmailRequestOptions };

export const acceptedResponse = async (): Promise<CreateEmailResponse> => ({
  data: { id: "email_fake" },
  error: null,
  headers: null,
});

export function createTestContext() {
  const runId = crypto.randomBytes(4).toString("hex");
  const domain = `-${runId}@example.test`;
  const savedEnv = { ...process.env };
  let server: Server;

  const ctx = {
    baseUrl: "",
    sendCalls: [] as SendCall[],
    nextResponse: acceptedResponse,

    testEmail: (name: string) => `${name}${domain}`,

    fakeResend: {
      emails: {
        send: async (payload: CreateEmailOptions, options?: CreateEmailRequestOptions) => {
          ctx.sendCalls.push({ payload, options });
          return ctx.nextResponse();
        },
      },
    } as unknown as Resend,

    async start() {
      process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
      server = app.listen(0);
      ctx.baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    },

    // À appeler avant chaque test : faux client Resend, clé fictive, aucun email réel
    resetEmail() {
      process.env.RESEND_API_KEY = "re_fake_test_key";
      process.env.EMAIL_FROM = "Ticket API <onboarding@resend.dev>";
      delete process.env.API_PUBLIC_URL;
      setResendClientForTests(ctx.fakeResend);
      ctx.sendCalls = [];
      ctx.nextResponse = acceptedResponse;
    },

    async stop() {
      resetResendClientForTests();
      process.env = savedEnv;
      // Supprime uniquement les utilisateurs créés par ce fichier ; le reste part en cascade
      await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
      await prisma.$disconnect();
      server.close();
    },

    request(method: string, path: string, body?: unknown, token?: string) {
      return fetch(`${ctx.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },

    async createUser(data: {
      name: string;
      role?: "SUPER_ADMIN" | "USER";
      status?: "INVITED" | "ACTIVE" | "DISABLED";
      password?: string;
    }) {
      const user = await prisma.user.create({
        data: {
          nom: "Test",
          prenom: data.name,
          email: ctx.testEmail(data.name),
          role: data.role ?? "USER",
          status: data.status ?? "ACTIVE",
          password: data.password ? await bcrypt.hash(data.password, 4) : null,
        },
      });
      return { user, accessToken: signAccessToken(user) };
    },
  };

  return ctx;
}

// Extrait le jeton du body de requête indiqué dans un email
export function tokenFromEmail(call: SendCall): string {
  const match = (call.payload as { text: string }).text.match(/"token": "([a-f0-9]{64})"/);
  assert.ok(match, "le jeton doit figurer dans l'email");
  return match[1];
}

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
