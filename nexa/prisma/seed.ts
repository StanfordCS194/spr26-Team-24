import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { AGENCIES } from "./agencies";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  console.log(`Seeding ${AGENCIES.length} agencies…`);
  for (const agency of AGENCIES) {
    await prisma.agency.upsert({
      where: {
        jurisdiction_name: {
          jurisdiction: agency.jurisdiction,
          name: agency.name,
        },
      },
      update: {
        issueTypes: agency.issueTypes,
        intakeMethod: agency.intakeMethod,
        intakeUrl: agency.intakeUrl,
        intakeEmail: agency.intakeEmail,
        requiredFields: agency.requiredFields,
      },
      create: agency,
    });
    console.log(`  ✓ ${agency.jurisdiction} / ${agency.name}`);
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
