import type { Hono } from "hono";
import postgres from "postgres";

export const ADMIN_TOKEN = "admin-bootstrap-token-32chars-min";

const BASE_ENV = {
  API_KEY_PEPPER: "12345678901234567890123456789012",
  ADMIN_BOOTSTRAP_TOKEN: ADMIN_TOKEN,
  JWT_SECRET: "12345678901234567890123456789012",
  JWT_EXPIRES_IN_HOURS: "2",
  UPSTREAM_BEARER_TOKEN: "upstream-secret",
  ALLOW_PUBLIC_REGISTRATION: "true",
  AUTH_REVOKE_KEYS_ON_LOGIN: "false",
};

export type SetupResult = {
  app: Hono;
  upstream: ReturnType<typeof Bun.serve>;
  databaseUrl: string;
};

export type MockHandler = (req: Request) => Response | Promise<Response>;

/**
 * Spins up a full Hono app + mock upstream for one integration test suite.
 * Call in beforeAll; pass result.upstream.stop() to afterAll.
 *
 * @param mockHandler - Controls what the fake upstream returns. Defaults to `{ ok: true }`.
 * @param envOverrides - Extra env vars applied on top of BASE_ENV before loadEnv().
 */
export async function setupGateway(
  mockHandler: MockHandler = () => Response.json({ ok: true }),
  envOverrides: Record<string, string> = {},
): Promise<SetupResult> {
  const { requireDatabaseUrlFromEnv } = await import("../../../src/db/databaseUrl.ts");
  const databaseUrl = requireDatabaseUrlFromEnv();

  Object.assign(process.env, BASE_ENV, envOverrides);

  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: mockHandler,
  });
  process.env.UPSTREAM_BASE_URL = `http://127.0.0.1:${upstream.port}`;

  const { loadEnv } = await import("../../../src/env.ts");
  const { applyMigrations } = await import("../../../src/db/migrate.ts");
  const { createDbAccess } = await import("../../../src/db/access.ts");
  const { buildGatewayApp } = await import("../../../src/gatewayApp.ts");

  const env = loadEnv();
  await applyMigrations(env.DATABASE_URL);
  const dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
  const app = buildGatewayApp({ env, dbAccess });

  return { app, upstream, databaseUrl };
}

/** POST /api/v1/auth/register with a unique email; returns the JWT access_token. */
export async function registerUser(
  app: Hono,
  name = "Test User",
): Promise<{ email: string; token: string; keyId: string; consumerId: string }> {
  const slug = crypto.randomUUID();
  const email = `${name.toLowerCase().replace(/\s+/g, "-")}-${slug}@example.com`;
  const res = await app.fetch(
    new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "password123" }),
    }),
  );
  if (res.status !== 201) {
    const text = await res.text();
    throw new Error(`registerUser failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    data: { access_token: string; key_id: string; consumer_id: string };
  };
  return {
    email,
    token: json.data.access_token,
    keyId: json.data.key_id,
    consumerId: json.data.consumer_id,
  };
}

/** Read wallet balance directly from the DB (bypasses app layer). */
export async function getWalletBalance(databaseUrl: string, consumerId: string): Promise<number> {
  const sql = postgres(databaseUrl);
  const rows = await sql<{ balance: number }[]>`
    SELECT balance FROM credit_wallets WHERE consumer_id = ${consumerId} LIMIT 1
  `;
  await sql.end();
  return rows[0]?.balance ?? 0;
}

/** Force a consumer's wallet balance to zero directly in the DB. */
export async function drainWallet(databaseUrl: string, consumerId: string): Promise<void> {
  const sql = postgres(databaseUrl);
  await sql`
    UPDATE credit_wallets SET balance = 0, lifetime_spent = lifetime_earned
    WHERE consumer_id = ${consumerId}
  `;
  await sql.end();
}
