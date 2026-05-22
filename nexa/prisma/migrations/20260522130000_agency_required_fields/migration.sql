-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "requiredFields" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Agency_jurisdiction_name_key" ON "Agency"("jurisdiction", "name");
