import { Database } from "bun:sqlite";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { mkdirSync } from "fs";
import { dirname } from "path";
import postgres from "postgres";
import { isPostgresUrl } from "../env.ts";

export async function applyMigrations(databaseUrl: string): Promise<void> {
  if (isPostgresUrl(databaseUrl)) {
    const sql = postgres(databaseUrl, { max: 1 });
    const db = drizzlePg(sql);
    await migratePg(db, { migrationsFolder: `${import.meta.dir}/../../drizzle-pg` });
    await sql.end();
    return;
  }

  const filePath = databaseUrl.replace(/^file:/, "");
  mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  const db = drizzleSqlite(sqlite);
  migrateSqlite(db, { migrationsFolder: `${import.meta.dir}/../../drizzle` });
  sqlite.close();
}

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./data/gateway.sqlite";
  await applyMigrations(url);
  console.log("Migrations applied.");
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
