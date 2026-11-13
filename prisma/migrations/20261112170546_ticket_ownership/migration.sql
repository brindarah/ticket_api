-- Rattache chaque ticket à son auteur (User) et supprime Ticket.email.
--
-- Les tickets existants sont associés uniquement de façon certaine :
-- Ticket.email doit correspondre exactement à User.email (sans tenir compte de la casse).
-- Si un ticket ne peut pas être associé, la migration s'arrête AVANT toute
-- suppression : aucune donnée n'est perdue et rien n'est attribué arbitrairement.
-- Prisma exécute la migration dans une transaction : en cas d'erreur, rien n'est appliqué.

-- 1. Nouvelle colonne, provisoirement facultative
ALTER TABLE "Ticket" ADD COLUMN "createdById" TEXT;

-- 2. Association certaine par l'email
UPDATE "Ticket" AS t
SET "createdById" = u."id"
FROM "User" AS u
WHERE u."email" = lower(trim(t."email"));

-- 3. Garde-fou : arrêt si un ticket reste sans propriétaire
DO $$
DECLARE
  orphans INTEGER;
BEGIN
  SELECT count(*) INTO orphans FROM "Ticket" WHERE "createdById" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'Migration ticket_ownership interrompue : % ticket(s) sans utilisateur correspondant à leur email. Décidez de leur sort avant de relancer la migration.', orphans;
  END IF;
END $$;

-- 4. La colonne devient obligatoire, l'email n'est plus utile
ALTER TABLE "Ticket" ALTER COLUMN "createdById" SET NOT NULL;
ALTER TABLE "Ticket" DROP COLUMN "email";

-- CreateIndex
CREATE INDEX "Ticket_createdById_idx" ON "Ticket"("createdById");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
