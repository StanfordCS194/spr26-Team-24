-- CreateIndex
CREATE INDEX "Report_userId_issueType_createdAt_idx" ON "Report"("userId", "issueType", "createdAt");
