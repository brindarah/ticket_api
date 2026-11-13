import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { createTestContext } from "./helpers/testContext";

// GET /tickets : pagination, filtre par statut et tri (base de test).
// D'autres fichiers de test peuvent créer des tickets en parallèle : les assertions portent
// sur l'ordre relatif des tickets créés ici et sur des propriétés vraies pour toute la liste.
const ctx = createTestContext();
let token: string;
const mine: string[] = []; // ids créés par ce fichier, dans l'ordre alphabétique des titres
const statusOrder = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]; // ordre de l'enum PostgreSQL

type TicketRow = { id: string; title: string; status: string; createdAt: string; updatedAt: string };

const list = async (query: string) => {
  const res = await ctx.request("GET", `/tickets${query}`, undefined, token);
  return { status: res.status, body: await res.json() };
};

const ownOrder = (data: TicketRow[]) => data.map((t) => t.id).filter((id) => mine.includes(id));

before(async () => {
  await ctx.start();
  const { user, accessToken } = await ctx.createUser({ name: "lister" });
  token = accessToken;
  // Titres aux préfixes distincts dès la première lettre : l'ordre ne dépend pas de la collation
  const rows = [
    { title: "Alpha liste", status: "CLOSED" as const },
    { title: "Bravo liste", status: "OPEN" as const },
    { title: "Charlie liste", status: "RESOLVED" as const },
  ];
  // Dates de création espacées d'une seconde : l'ordre par createdAt est certain
  const start = Date.now() - 60_000;
  for (const [i, row] of rows.entries()) {
    const t = await prisma.ticket.create({
      data: { ...row, description: "Tri", createdById: user.id, createdAt: new Date(start + i * 1000) },
    });
    mine.push(t.id);
  }
});
after(() => ctx.stop());

describe("GET /tickets : pagination", () => {
  test("valeurs par défaut : page 1, limit 10, structure { data, meta } inchangée", async () => {
    const { status, body } = await list("");
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body).sort(), ["data", "meta"]);
    assert.deepEqual(Object.keys(body.meta).sort(), ["limit", "page", "total", "totalPages"]);
    assert.equal(body.meta.page, 1);
    assert.equal(body.meta.limit, 10);
    assert.ok(body.meta.total >= 3);
    assert.equal(body.meta.totalPages, Math.ceil(body.meta.total / 10));
    assert.ok(body.data.length <= 10);
  });

  test("découpe la liste en pages sans doublon ni oubli", async () => {
    const seen: string[] = [];
    const first = await list("?limit=2&page=1&sort=createdAt&order=asc");
    assert.equal(first.body.meta.limit, 2);
    assert.equal(first.body.meta.totalPages, Math.ceil(first.body.meta.total / 2));
    for (let page = 1; page <= first.body.meta.totalPages; page++) {
      const { body } = await list(`?limit=2&page=${page}&sort=createdAt&order=asc`);
      assert.ok(body.data.length <= 2);
      assert.equal(body.meta.page, page);
      seen.push(...body.data.map((t: TicketRow) => t.id));
    }
    for (const id of mine) {
      assert.equal(seen.filter((s) => s === id).length, 1, "chaque ticket apparaît une seule fois");
    }
  });

  test("une page au-delà de la dernière renvoie une liste vide", async () => {
    const { status, body } = await list("?page=100000");
    assert.equal(status, 200);
    assert.deepEqual(body.data, []);
  });

  test("accepte limit=100 et refuse au-delà", async () => {
    assert.equal((await list("?limit=100")).status, 200);
    const tooMany = await list("?limit=101");
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.details[0].field, "limit");
  });

  test("refuse une page ou une limite invalides", async () => {
    for (const q of ["?page=0", "?page=-1", "?page=abc", "?limit=0", "?limit=1.5"]) {
      assert.equal((await list(q)).status, 400, q);
    }
  });
});

describe("GET /tickets : filtre par statut", () => {
  test("ne renvoie que les tickets du statut demandé", async () => {
    const { body } = await list("?status=RESOLVED&limit=100");
    assert.ok(body.data.every((t: TicketRow) => t.status === "RESOLVED"));
    assert.deepEqual(ownOrder(body.data), [mine[2]]);
  });

  test("le total tient compte du filtre", async () => {
    const all = (await list("?limit=1")).body.meta.total;
    const closed = (await list("?status=CLOSED&limit=1")).body.meta.total;
    assert.ok(closed >= 1 && closed <= all);
  });

  test("refuse un statut inconnu", async () => {
    assert.equal((await list("?status=DONE")).status, 400);
  });
});

describe("GET /tickets : tri", () => {
  test("par défaut : createdAt décroissant", async () => {
    const { body } = await list("?limit=100");
    const dates = body.data.map((t: TicketRow) => t.createdAt);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test("tri par titre croissant puis décroissant", async () => {
    const asc = await list("?sort=title&order=asc&limit=100");
    assert.equal(asc.status, 200);
    assert.deepEqual(ownOrder(asc.body.data), mine);
    const desc = await list("?sort=title&order=desc&limit=100");
    assert.deepEqual(ownOrder(desc.body.data), [...mine].reverse());
  });

  test("tri par statut selon l'ordre de l'enum (OPEN, IN_PROGRESS, RESOLVED, CLOSED)", async () => {
    const asc = (await list("?sort=status&order=asc&limit=100")).body.data as TicketRow[];
    const ranks = asc.map((t) => statusOrder.indexOf(t.status));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.deepEqual(ownOrder(asc), [mine[1], mine[2], mine[0]]);
    const desc = (await list("?sort=status&order=desc&limit=100")).body.data as TicketRow[];
    assert.deepEqual(ownOrder(desc), [mine[0], mine[2], mine[1]]);
  });

  test("tri par createdAt et updatedAt croissants", async () => {
    for (const field of ["createdAt", "updatedAt"] as const) {
      const { status, body } = await list(`?sort=${field}&order=asc&limit=100`);
      assert.equal(status, 200);
      const values = body.data.map((t: TicketRow) => t[field]);
      assert.deepEqual(values, [...values].sort());
    }
    assert.deepEqual(ownOrder((await list("?sort=createdAt&order=asc&limit=100")).body.data), mine);
  });

  test("refuse un champ de tri hors liste blanche", async () => {
    for (const sort of ["description", "createdById", "id", "password", "createdBy.email"]) {
      const { status, body } = await list(`?sort=${sort}`);
      assert.equal(status, 400, sort);
      assert.equal(body.details[0].field, "sort");
    }
  });

  test("refuse un ordre invalide", async () => {
    for (const order of ["ASC", "up", "1"]) {
      const { status, body } = await list(`?sort=title&order=${order}`);
      assert.equal(status, 400, order);
      assert.equal(body.details[0].field, "order");
    }
  });
});
