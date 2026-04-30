import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export async function applyMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzlePg(sql);
  await migratePg(db, { migrationsFolder: `${import.meta.dir}/../../drizzle-pg` });
  await sql.end();
}

async function main() {
  const url =
    process.env.DATABASE_URL ?? "postgresql://postgres:root@localhost:5432/dt_videoapi_db";
  await applyMigrations(url);
  console.log("Migrations applied.");
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
