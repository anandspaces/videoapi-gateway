import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import type { DbAccess } from "./db/access.ts";
import { requireDatabaseUrlFromEnv } from "./db/databaseUrl.ts";

describe("gateway integration", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let app: Hono;
  let dbAccess: DbAccess;

  beforeAll(async () => {
    requireDatabaseUrlFromEnv();
    process.env.API_KEY_PEPPER = "12345678901234567890123456789012";
    process.env.ADMIN_BOOTSTRAP_TOKEN = "admin-bootstrap-token-32chars-min";
    process.env.JWT_SECRET = "12345678901234567890123456789012";
    process.env.JWT_EXPIRES_IN_HOURS = "2";
    process.env.UPSTREAM_BEARER_TOKEN = "upstream-secret";

    upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        return Response.json({
          proxied: true,
          method: req.method,
          url: req.url,
          auth: req.headers.get("authorization"),
        });
      },
    });

    process.env.UPSTREAM_BASE_URL = `http://127.0.0.1:${upstream.port}`;

    const { loadEnv } = await import("./env.ts");
    const { applyMigrations } = await import("./db/migrate.ts");
    const { createDbAccess } = await import("./db/access.ts");
    const { buildGatewayApp } = await import("./gatewayApp.ts");

    const env = loadEnv();
    await applyMigrations(env.DATABASE_URL);
    dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
    app = buildGatewayApp({ env, dbAccess });
  });

  afterAll(() => {
    upstream?.stop();
  });

  it("creates consumer and proxies with swapped bearer", async () => {
    const adminRes = await app.fetch(
      new Request("http://127.0.0.1/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": "admin-bootstrap-token-32chars-min",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Test Org" }),
      }),
    );
    expect(adminRes.status).toBe(201);
    const created = (await adminRes.json()) as {
      status: number;
      data: { apiKey: string };
    };
    expect(created.status).toBe(1);
    expect(created.data.apiKey).toMatch(/^gw_live_/);

    const proxied = await app.fetch(
      new Request("http://127.0.0.1/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${created.data.apiKey}` },
      }),
    );
    expect(proxied.status).toBe(401);
    const body = (await proxied.json()) as {
      status: number;
      message: string;
      data: { error: string };
    };
    expect(body.status).toBe(0);
    expect(body.message).toBe("Invalid or expired token");
    expect(body.data.error).toBe("unauthorized");
  });
});
