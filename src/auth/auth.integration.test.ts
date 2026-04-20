import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import type { Hono } from "hono";
import { tmpdir } from "os";
import { join } from "path";

describe("auth register and login", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let tmpDir: string;
  let app: Hono;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "gw-auth-test-"));
    process.env.DATABASE_URL = `file:${join(tmpDir, "db.sqlite")}`;
    process.env.API_KEY_PEPPER = "12345678901234567890123456789012";
    process.env.ADMIN_BOOTSTRAP_TOKEN = "admin-bootstrap-token-32chars-min";
    process.env.UPSTREAM_BEARER_TOKEN = "x";
    process.env.ALLOW_PUBLIC_REGISTRATION = "true";
    process.env.AUTH_REVOKE_KEYS_ON_LOGIN = "false";

    upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    });
    process.env.UPSTREAM_BASE_URL = `http://127.0.0.1:${upstream.port}`;

    const { loadEnv } = await import("../env.ts");
    const { applyMigrations } = await import("../db/migrate.ts");
    const { createDbAccess } = await import("../db/access.ts");
    const { buildGatewayApp } = await import("../gatewayApp.ts");

    const env = loadEnv();
    await applyMigrations(env.DATABASE_URL);
    const dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
    app = buildGatewayApp({ env, dbAccess });
  });

  afterAll(() => {
    upstream?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("register then login returns bearer-capable tokens", async () => {
    const reg = await app.fetch(
      new Request("http://127.0.0.1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          password: "password123",
        }),
      }),
    );
    expect(reg.status).toBe(201);
    const regJson = (await reg.json()) as { access_token: string };
    expect(regJson.access_token).toMatch(/^gw_live_/);

    const login = await app.fetch(
      new Request("http://127.0.0.1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "password123",
        }),
      }),
    );
    expect(login.status).toBe(201);
    const loginJson = (await login.json()) as { access_token: string };
    expect(loginJson.access_token).toMatch(/^gw_live_/);
    expect(loginJson.access_token).not.toBe(regJson.access_token);

    const proxied = await app.fetch(
      new Request("http://127.0.0.1/api/v1/enterprise/balance/", {
        headers: { Authorization: `Bearer ${loginJson.access_token}` },
      }),
    );
    expect(proxied.status).toBe(200);
  });

  it("returns 403 when public registration disabled and no admin header", async () => {
    process.env.ALLOW_PUBLIC_REGISTRATION = "false";
    const { loadEnv } = await import("../env.ts");
    const { createDbAccess } = await import("../db/access.ts");
    const { buildGatewayApp } = await import("../gatewayApp.ts");

    const env = loadEnv();
    const dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
    const gated = buildGatewayApp({ env, dbAccess });

    const res = await gated.fetch(
      new Request("http://127.0.0.1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bob",
          email: "bob@example.com",
          password: "password123",
        }),
      }),
    );
    expect(res.status).toBe(403);
    process.env.ALLOW_PUBLIC_REGISTRATION = "true";
  });
});
