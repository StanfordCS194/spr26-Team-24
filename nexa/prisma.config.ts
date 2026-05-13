import { config } from "dotenv";
import path from "node:path";
import { defineConfig } from "prisma/config";

config({ path: path.resolve(__dirname, ".env.local") });
config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    // In Prisma 7 the connection URL lives here, not in schema.prisma
    url: process.env.DATABASE_URL,
  },
});
