-- CreateEnum
CREATE TYPE "AIResponseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "aiResponse" TEXT,
ADD COLUMN     "aiResponseAt" TIMESTAMP(3),
ADD COLUMN     "aiResponseStatus" "AIResponseStatus" NOT NULL DEFAULT 'PENDING';
