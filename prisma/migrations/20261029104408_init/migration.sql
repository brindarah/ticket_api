/*
  Warnings:

  - You are about to drop the column `priority` on the `Ticket` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Ticket" DROP COLUMN "priority";

-- DropEnum
DROP TYPE "TicketPriority";
