import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
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
    process.env.JWT_SECRET = "12345678901234567890123456789012";
    process.env.JWT_EXPIRES_IN_HOURS = "2";
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
      new Request("http://127.0.0.1/api/v1/auth/register", {
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
    const regJson = (await reg.json()) as {
      status: number;
      data: { access_token: string };
    };
    expect(regJson.status).toBe(1);
    expect(regJson.data.access_token.split(".")).toHaveLength(3);

    const db = new Database(join(tmpDir, "db.sqlite"));
    const consumerRow = db
      .query("select metadata from consumers where email = ? limit 1")
      .get("alice@example.com") as { metadata: string | null } | null;
    db.close();
    expect(consumerRow?.metadata).toBe(JSON.stringify({ credits: 10 }));

    const login = await app.fetch(
      new Request("http://127.0.0.1/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.com",
          password: "password123",
        }),
      }),
    );
    expect(login.status).toBe(201);
    const loginJson = (await login.json()) as {
      status: number;
      data: { access_token: string };
    };
    expect(loginJson.status).toBe(1);
    expect(loginJson.data.access_token.split(".")).toHaveLength(3);
    expect(loginJson.data.access_token).not.toBe(regJson.data.access_token);

    const proxied = await app.fetch(
      new Request("http://127.0.0.1/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${loginJson.data.access_token}` },
      }),
    );
    expect(proxied.status).toBe(200);
    const proxiedJson = (await proxied.json()) as { status: number; data: { upstream: { ok: boolean } } };
    expect(proxiedJson.status).toBe(1);
    expect(proxiedJson.data.upstream.ok).toBe(true);

    const deniedUnknown = await app.fetch(
      new Request("http://127.0.0.1/api/v1/unknown/", {
        headers: { Authorization: `Bearer ${loginJson.data.access_token}` },
      }),
    );
    expect(deniedUnknown.status).toBe(403);
    const deniedJson = (await deniedUnknown.json()) as { status: number; data: { error: string } };
    expect(deniedJson.status).toBe(0);
    expect(deniedJson.data.error).toBe("forbidden");
  });

  it("keeps registration open even when ALLOW_PUBLIC_REGISTRATION is false", async () => {
    process.env.ALLOW_PUBLIC_REGISTRATION = "false";
    const { loadEnv } = await import("../env.ts");
    const { createDbAccess } = await import("../db/access.ts");
    const { buildGatewayApp } = await import("../gatewayApp.ts");

    const env = loadEnv();
    const dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
    const gated = buildGatewayApp({ env, dbAccess });

    const res = await gated.fetch(
      new Request("http://127.0.0.1/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bob",
          email: "bob@example.com",
          password: "password123",
        }),
      }),
    );
    expect(res.status).toBe(201);
    process.env.ALLOW_PUBLIC_REGISTRATION = "true";
  });
});
