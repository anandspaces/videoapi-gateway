import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { requireDatabaseUrlFromEnv } from "./databaseUrl.ts";

export async function applyMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzlePg(sql);
  await migratePg(db, { migrationsFolder: `${import.meta.dir}/../../drizzle-pg` });
  await sql.end();
}

async function main() {
  const url = requireDatabaseUrlFromEnv();
  await applyMigrations(url);
  console.log("Migrations applied.");
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
