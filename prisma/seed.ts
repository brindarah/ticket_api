import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { recordAudit } from "../src/services/audit.service";

// Crée le Super Admin s'il n'existe pas encore. Ne modifie jamais un compte existant.
// La création est auditée (acteur null : action système) ; aucun audit si le compte existe déjà.
export async function seedSuperAdmin(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { email: true } });
  if (existing) {
    return { email: existing.email, created: false };
  }

  const hashed = await bcrypt.hash(password, 12);

  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        nom: "Admin",
        prenom: "Super",
        email,
        password: hashed,
        role: "SUPER_ADMIN",
        status: "ACTIVE",
      },
      select: { id: true, email: true },
    });

    await recordAudit(tx, {
      actorId: null,
      action: "SUPER_ADMIN_CREATED",
      entityType: "USER",
      entityId: created.id,
      newValue: { role: "SUPER_ADMIN", status: "ACTIVE" },
    });

    return created;
  });

  return { email: admin.email, created: true };
}

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("SUPER_ADMIN_EMAIL et SUPER_ADMIN_PASSWORD doivent être dans le .env");
  }

  const { email: adminEmail, created } = await seedSuperAdmin(email, password);

  console.log(created ? `Super Admin créé : ${adminEmail}` : `Super Admin déjà présent : ${adminEmail}`);
}

// Exécuté seulement en ligne de commande (npx tsx prisma/seed.ts), pas lors d'un import par les tests
if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
