import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Router } from "express";
import { openApiDocument } from "../src/docs/openapi";
import ticketRoutes from "../src/routes/ticket.routes";
import authRoutes from "../src/routes/auth.routes";
import invitationRoutes from "../src/routes/invitation.routes";
import userRoutes from "../src/routes/user.routes";
import { createTestContext } from "./helpers/testContext";

// La documentation doit correspondre exactement aux routes réellement déclarées.
// Préfixes de montage : à garder synchronisés avec src/app.ts.
const mounted: [string, Router][] = [
  ["/tickets", ticketRoutes],
  ["/auth", authRoutes],
  ["/auth", invitationRoutes],
  ["/users", userRoutes],
];
// Routes déclarées directement dans app.ts et documentées (la route /docs elle-même ne l'est pas)
const appRoutes = ["get /health"];

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };

// "get /tickets/{id}" pour chaque route Express (":id" devient "{id}" comme dans OpenAPI)
function expressRoutes(): string[] {
  const routes = [...appRoutes];
  for (const [prefix, router] of mounted) {
    for (const layer of router.stack as RouteLayer[]) {
      if (!layer.route) continue;
      const path = `${prefix}${layer.route.path === "/" ? "" : layer.route.path}`.replace(/:(\w+)/g, "{$1}");
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method} ${path}`);
      }
    }
  }
  return routes.sort();
}

type Operation = { security?: unknown[]; responses: Record<string, unknown> };
const paths = openApiDocument.paths as Record<string, Record<string, Operation>>;

function documentedRoutes(): string[] {
  return Object.entries(paths)
    .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method} ${path}`))
    .sort();
}

describe("OpenAPI : correspondance avec les routes", () => {
  test("chaque route Express est documentée, et aucune route fictive ne l'est", () => {
    assert.deepEqual(documentedRoutes(), expressRoutes());
  });

  test("toutes les références $ref existent", () => {
    const refs = JSON.stringify(openApiDocument).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const raw of new Set(refs)) {
      const [, , section, name] = raw.slice(8, -1).split("/");
      const components = openApiDocument.components as unknown as Record<string, Record<string, unknown>>;
      assert.ok(components[section]?.[name], `référence introuvable : ${raw}`);
    }
  });

  test("chaque route protégée documente la réponse 401", () => {
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (operation.security?.length) {
          assert.ok(operation.responses["401"], `${method} ${path} : 401 manquant`);
        }
      }
    }
  });

  test("les routes /users exigent un token, les routes publiques n'en demandent pas", () => {
    for (const [path, operations] of Object.entries(paths)) {
      for (const operation of Object.values(operations)) {
        const isPublic = path === "/health" || (path.startsWith("/auth/") && path !== "/auth/me");
        assert.equal(operation.security?.length ?? 0, isPublic ? 0 : 1, path);
      }
    }
  });
});

describe("GET /docs", () => {
  const ctx = createTestContext();
  before(() => ctx.start());
  after(() => ctx.stop());

  test("sert l'interface Swagger UI sans authentification", async () => {
    const res = await fetch(`${ctx.baseUrl}/docs/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await res.text(), /swagger-ui/i);
  });

  test("/docs sans slash final mène aussi à la documentation", async () => {
    const res = await fetch(`${ctx.baseUrl}/docs`);
    assert.equal(res.status, 200);
  });

  test("sert le document OpenAPI en JSON", async () => {
    const res = await fetch(`${ctx.baseUrl}/docs/openapi.json`);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.equal(doc.openapi, "3.0.3");
    assert.ok(doc.paths["/tickets"]);
  });
});
