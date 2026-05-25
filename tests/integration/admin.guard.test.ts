import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { ADMIN_TOKEN, setupGateway } from "./helpers/setup.ts";

describe("admin route guards", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    ({ app, upstream } = await setupGateway());
  });

  afterAll(() => upstream?.stop());

  // ── /internal/admin/consumers ────────────────────────────────────────────

  it("consumers: 401 when X-Admin-Token header is missing", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Org" }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("unauthorized");
  });

  it("consumers: 401 when X-Admin-Token is incorrect", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": "wrong-token-value",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Org" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("consumers: 400 when name field is missing", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("bad_request");
  });

  it("consumers: 201 with valid token creates consumer and returns gw_live_ prefixed key", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Valid Org" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: number;
      data: {
        consumerId: string;
        keyId: string;
        apiKey: string;
        prefix: string;
        scopes: string[];
        warning: string;
      };
    };
    expect(body.status).toBe(1);
    expect(body.data.apiKey).toMatch(/^gw_live_/);
    expect(body.data.scopes).toContain("*");
    expect(body.data.warning).toContain("once");
  });

  it("consumers: 201 with custom scopes persists only the specified scopes", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Scoped Org",
          scopes: ["project:create", "enterprise:balance"],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { scopes: string[] } };
    expect(body.data.scopes).toEqual(["project:create", "enterprise:balance"]);
  });

  // ── /internal/admin/api-keys ─────────────────────────────────────────────

  it("api-keys: 401 when X-Admin-Token is missing", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumerId: crypto.randomUUID() }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("api-keys: 400 when consumerId is not a valid UUID", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/api-keys", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consumerId: "not-a-uuid" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("bad_request");
  });

  it("api-keys: 201 creates a second key for an existing consumer", async () => {
    // First create a consumer
    const consumerRes = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/consumers", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Multi-Key Org" }),
      }),
    );
    const {
      data: { consumerId },
    } = (await consumerRes.json()) as {
      data: { consumerId: string };
    };

    // Then add another key
    const keyRes = await app.fetch(
      new Request("http://localhost/api/v1/internal/admin/api-keys", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ consumerId, scopes: ["enterprise:balance"] }),
      }),
    );
    expect(keyRes.status).toBe(201);
    const body = (await keyRes.json()) as {
      data: { consumerId: string; apiKey: string; scopes: string[] };
    };
    expect(body.data.consumerId).toBe(consumerId);
    expect(body.data.apiKey).toMatch(/^gw_live_/);
    expect(body.data.scopes).toEqual(["enterprise:balance"]);
  });

  // ── /auth/token (admin endpoint on auth router) ──────────────────────────

  it("/auth/token: 401 when X-Admin-Token is missing", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Org" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("/auth/token: 201 with valid admin token returns a JWT", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/token", {
        method: "POST",
        headers: {
          "x-admin-token": ADMIN_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "JWT Org" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { access_token: string; token_type: string } };
    expect(body.data.token_type).toBe("Bearer");
    expect(body.data.access_token.split(".")).toHaveLength(3);
  });
});
