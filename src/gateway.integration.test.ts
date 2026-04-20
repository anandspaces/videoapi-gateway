import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import type { Hono } from "hono";
import { tmpdir } from "os";
import { join } from "path";
import { hashApiKey } from "./crypto/hash.ts";
import type { DbAccess } from "./db/access.ts";

describe("gateway integration", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let tmpDir: string;
  let app: Hono;
  let dbAccess: DbAccess;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "gw-test-"));
    const dbPath = join(tmpDir, "db.sqlite");
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.API_KEY_PEPPER = "12345678901234567890123456789012";
    process.env.ADMIN_BOOTSTRAP_TOKEN = "admin-bootstrap-token-32chars-min";
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
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates consumer and proxies with swapped bearer", async () => {
    const adminRes = await app.fetch(
      new Request("http://127.0.0.1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": "admin-bootstrap-token-32chars-min",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Test Org" }),
      }),
    );
    expect(adminRes.status).toBe(201);
    const created = (await adminRes.json()) as { apiKey: string };
    expect(created.apiKey).toMatch(/^gw_live_/);

    const pepper = process.env.API_KEY_PEPPER;
    if (!pepper) {
      throw new Error("API_KEY_PEPPER must be set for this test");
    }
    const expectHash = await hashApiKey(created.apiKey, pepper);
    const direct = await dbAccess.findApiKeyByHash(expectHash);
    expect(direct).not.toBeNull();

    const proxied = await app.fetch(
      new Request("http://127.0.0.1/api/v1/enterprise/balance/", {
        headers: { Authorization: `Bearer ${created.apiKey}` },
      }),
    );
    expect(proxied.status).toBe(200);
    const body = (await proxied.json()) as {
      proxied: boolean;
      url: string;
      auth: string | null;
    };
    expect(body.proxied).toBe(true);
    expect(body.url).toContain("/enterprise/balance/");
    expect(body.auth).toBe("Bearer upstream-secret");
  });
});
