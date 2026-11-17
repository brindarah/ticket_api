import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createTestContext } from "./helpers/testContext";

// VULN-001 : un USER ne voit que ses tickets, le SUPER_ADMIN les voit tous
describe("Accès aux tickets des autres (VULN-001)", () => {
  const ctx = createTestContext();

  before(() => ctx.start());
  after(() => ctx.stop());

  test("Alice voit son ticket, Moaze non, le Super Admin oui", async () => {
    const alice = await ctx.createUser({ name: "access-alice" });
    const moaze = await ctx.createUser({ name: "access-moaze" });
    const admin = await ctx.createUser({ name: "access-admin", role: "SUPER_ADMIN" });

    const created = await ctx.request(
      "POST", "/tickets",
      { title: "Ticket privé", description: "Mon adresse est 12 rue des Lilas" },
      alice.accessToken,
    );
    const { id } = await created.json();

    // Détail : Alice 200, Moaze 404, Super Admin 200
    assert.equal((await ctx.request("GET", `/tickets/${id}`, undefined, alice.accessToken)).status, 200);
    assert.equal((await ctx.request("GET", `/tickets/${id}`, undefined, moaze.accessToken)).status, 404);
    assert.equal((await ctx.request("GET", `/tickets/${id}`, undefined, admin.accessToken)).status, 200);

    // Liste : le ticket d'Alice n'apparaît pas chez Moaze, mais apparaît chez le Super Admin
    const inList = async (token: string) => {
      const body = await (await ctx.request("GET", "/tickets?limit=100", undefined, token)).json();
      return body.data.some((t: { id: string }) => t.id === id);
    };
    assert.equal(await inList(moaze.accessToken), false);
    assert.equal(await inList(admin.accessToken), true);
  });
});
