import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

// Explicitly resolve the .env path relative to this file so it works regardless
// of which directory the Prisma CLI is invoked from (e.g. root vs a subdirectory).
// import "dotenv/config" uses process.cwd() which can vary — this is more reliable.
config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    // In Prisma 7 the connection URL lives here, not in schema.prisma
    url: process.env.DATABASE_URL,
  },
});
