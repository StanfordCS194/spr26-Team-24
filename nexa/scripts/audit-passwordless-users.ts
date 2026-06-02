// Audit + optional cleanup for User rows that have no passwordHash.
//
// Background: an earlier version of /api/auth/login used
// `prisma.user.upsert({ where: { email } })`, which silently created a User
// row for any email anyone typed into the login form, never verifying a
// password. Many of those rows are not real accounts.
//
// Usage:
//   npx tsx scripts/audit-passwordless-users.ts           # read-only audit
//   npx tsx scripts/audit-passwordless-users.ts --delete  # delete the safe set
//
// The script only ever deletes rows that have:
//   - passwordHash IS NULL                  (never set a password), AND
//   - zero Reports tied to the userId       (no submitted data to preserve)
//
// Rows with passwordHash IS NULL *but* with reports are reported only — those
// represent users who filed real reports before the password gate existed,
// and they should be migrated through /claim rather than deleted.

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const dryRun = !process.argv.includes("--delete");

  const passwordless = await prisma.user.findMany({
    where: { passwordHash: null },
    select: {
      id: true,
      email: true,
      createdAt: true,
      _count: { select: { reports: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const safeToDelete = passwordless.filter((u) => u._count.reports === 0);
  const hasReports = passwordless.filter((u) => u._count.reports > 0);

  console.log(`Total passwordless users: ${passwordless.length}`);
  console.log(`  - no reports (safe to delete): ${safeToDelete.length}`);
  console.log(`  - with reports (needs /claim): ${hasReports.length}`);

  if (hasReports.length > 0) {
    console.log("\nUsers with reports but no password:");
    for (const u of hasReports) {
      console.log(
        `  ${u.email}\t${u._count.reports} report(s)\tcreated ${u.createdAt.toISOString()}`,
      );
    }
  }

  if (safeToDelete.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  if (dryRun) {
    console.log("\n(dry run — pass --delete to actually remove)");
    return;
  }

  const result = await prisma.user.deleteMany({
    where: { id: { in: safeToDelete.map((u) => u.id) } },
  });
  console.log(`\nDeleted ${result.count} passwordless users with no reports.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
