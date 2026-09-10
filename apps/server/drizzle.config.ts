/** Drizzle Kit configuration derived from the canonical database settings. */

import { defineConfig } from "drizzle-kit";
import { loadDatabaseConfig } from "./src/config";

const config = loadDatabaseConfig(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/server/src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: config.databaseUrl },
  verbose: true,
});
