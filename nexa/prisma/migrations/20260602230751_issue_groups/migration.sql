-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "issueGroupId" TEXT;

-- CreateTable
CREATE TABLE "IssueGroup" (
    "id" TEXT NOT NULL,
    "issueType" "IssueType" NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'CONFIRMED',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "reportCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueGroup_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_issueGroupId_fkey" FOREIGN KEY ("issueGroupId") REFERENCES "IssueGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
