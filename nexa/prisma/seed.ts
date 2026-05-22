import { PrismaClient } from "../src/generated/prisma/client";
import type { Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type AgencySeed = {
  name: string;
  jurisdiction: string;
  issueTypes: Array<
    | "ROAD_DAMAGE"
    | "STREETLIGHT_OUTAGE"
    | "ILLEGAL_DUMPING"
    | "VEHICLE_EMISSIONS"
    | "OTHER"
  >;
  intakeMethod: "API" | "WEB_FORM" | "EMAIL" | "PHONE";
  intakeUrl: string | null;
  intakeEmail: string | null;
  requiredFields: Prisma.InputJsonValue;
};

const AGENCIES: AgencySeed[] = [
  {
    name: "Palo Alto 311",
    jurisdiction: "city-palo-alto",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "WEB_FORM",
    intakeUrl:
      "https://www.paloalto.gov/Residents/Services/Report-an-Issue/Palo-Alto-311",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      latitude: { type: "number", required: false },
      longitude: { type: "number", required: false },
      photo: { type: "file", required: false },
      contact_email: { type: "string", required: false },
    },
  },
  {
    name: "California BAR Smoking Vehicle Hotline",
    jurisdiction: "city-palo-alto",
    issueTypes: ["VEHICLE_EMISSIONS"],
    intakeMethod: "WEB_FORM",
    intakeUrl:
      "https://www.bar.ca.gov/Consumer/Smoking_Vehicles/Report_Smoking_Vehicle",
    intakeEmail: null,
    requiredFields: {
      license_plate: { type: "string", required: true },
      vehicle_make: { type: "string", required: true },
      vehicle_model: { type: "string", required: false },
      vehicle_color: { type: "string", required: false },
      observation_location: { type: "string", required: true },
      observation_datetime: { type: "datetime", required: true },
    },
  },
  {
    name: "Menlo Park ACT",
    jurisdiction: "city-menlo-park",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "WEB_FORM",
    intakeUrl: "https://www.menlopark.gov/Services/ACT-Menlo-Park",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      photo: { type: "file", required: false },
      contact_email: { type: "string", required: false },
    },
  },
  {
    name: "Mountain View Public Works",
    jurisdiction: "city-mountain-view",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING"],
    intakeMethod: "WEB_FORM",
    intakeUrl:
      "https://www.mountainview.gov/our-city/departments/public-works",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      contact_name: { type: "string", required: false },
      contact_email: { type: "string", required: false },
    },
  },
  {
    name: "Santa Clara County Public Works",
    jurisdiction: "county-santa-clara-unincorporated",
    issueTypes: ["ROAD_DAMAGE", "STREETLIGHT_OUTAGE"],
    intakeMethod: "WEB_FORM",
    intakeUrl:
      "https://publicworks.sccgov.org/services/road-maintenance/report-problem",
    intakeEmail: null,
    requiredFields: {
      description: { type: "string", required: true },
      location_address: { type: "string", required: true },
      latitude: { type: "number", required: false },
      longitude: { type: "number", required: false },
    },
  },
];

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
