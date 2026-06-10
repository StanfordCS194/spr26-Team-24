-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssueType" ADD VALUE 'GRAFFITI';
ALTER TYPE "IssueType" ADD VALUE 'SIDEWALK_DAMAGE';
ALTER TYPE "IssueType" ADD VALUE 'TREE_MAINTENANCE';
ALTER TYPE "IssueType" ADD VALUE 'TRAFFIC_SIGNAL';
ALTER TYPE "IssueType" ADD VALUE 'PUBLIC_SIGNAGE';
ALTER TYPE "IssueType" ADD VALUE 'FLOODING_DRAINAGE';
ALTER TYPE "IssueType" ADD VALUE 'WATER_SYSTEM';
ALTER TYPE "IssueType" ADD VALUE 'PARKS_PLAYGROUNDS';
ALTER TYPE "IssueType" ADD VALUE 'WEED_ABATEMENT';
ALTER TYPE "IssueType" ADD VALUE 'ABANDONED_VEHICLE';
ALTER TYPE "IssueType" ADD VALUE 'PARKING';
ALTER TYPE "IssueType" ADD VALUE 'CODE_ENFORCEMENT';
ALTER TYPE "IssueType" ADD VALUE 'STREET_SWEEPING';
