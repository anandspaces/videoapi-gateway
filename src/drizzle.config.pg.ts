import { defineConfig } from "drizzle-kit";
import { requireDatabaseUrlFromEnv } from "./db/databaseUrl.ts";

export default defineConfig({
  schema: "./src/db/schema.pg.ts",
  out: "./drizzle-pg",
  dialect: "postgresql",
  dbCredentials: {
    url: requireDatabaseUrlFromEnv(),
  },
});
