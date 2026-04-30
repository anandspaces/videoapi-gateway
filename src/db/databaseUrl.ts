/**
 * PostgreSQL connection URL from the environment only (no baked-in defaults).
 */
export function requireDatabaseUrlFromEnv(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL must be set in the environment (see gateway/.env.example).");
  }
  return url;
}
