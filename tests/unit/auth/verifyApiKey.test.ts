import { describe, expect, it } from "bun:test";
import type { Context, Next } from "hono";
import { signAccessJwt } from "../../../src/auth/jwt.ts";
import { createAuthMiddleware } from "../../../src/auth/verifyApiKey.ts";

const JWT_SECRET = "12345678901234567890123456789012satisfiesminlength";

type StubEnv = { JWT_SECRET: string };

function makeContext(opts: {
  authHeader?: string | null;
  url?: string;
  env?: StubEnv;
}): { ctx: Context; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  store.set("requestId", "test-request-id");
  store.set("env", opts.env ?? { JWT_SECRET });

  const headers = new Headers();
  if (opts.authHeader) headers.set("authorization", opts.authHeader);

  const url = opts.url ?? "http://localhost/api/v1/project/";

  const ctx = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    req: {
      header: (k: string) => headers.get(k),
      url,
    },
    json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  } as unknown as Context;

  return { ctx, store };
}

async function makeValidToken(scopes: string[] = ["*"]): Promise<string> {
  const { token } = await signAccessJwt({
    consumerId: "consumer-abc",
    scopes,
    secret: JWT_SECRET,
    expiresInHours: 1,
  });
  return token;
}

const noopNext: Next = async () => {};

describe("createAuthMiddleware — missing / malformed token", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const mw = createAuthMiddleware();
    const { ctx } = makeContext({ authHeader: null });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(401);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("unauthorized");
  });

  it("returns 401 when Authorization has no Bearer prefix", async () => {
    const mw = createAuthMiddleware();
    const { ctx } = makeContext({ authHeader: "Basic dXNlcjpwYXNz" });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is empty string", async () => {
    const mw = createAuthMiddleware();
    const { ctx } = makeContext({ authHeader: "Bearer " });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is not a valid JWT structure", async () => {
    const mw = createAuthMiddleware();
    const { ctx } = makeContext({ authHeader: "Bearer notajwt" });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(401);
  });

  it("returns 401 when JWT is signed with wrong secret", async () => {
    const mw = createAuthMiddleware();
    const { token } = await signAccessJwt({
      consumerId: "c1",
      scopes: ["*"],
      secret: "wrong-secret-that-is-32-chars-long!",
      expiresInHours: 1,
    });
    const { ctx } = makeContext({ authHeader: `Bearer ${token}` });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(401);
  });

  it("returns 401 when JWT is expired", async () => {
    const mw = createAuthMiddleware();
    const { token } = await signAccessJwt({
      consumerId: "c1",
      scopes: ["*"],
      secret: JWT_SECRET,
      expiresInHours: -1,
    });
    const { ctx } = makeContext({ authHeader: `Bearer ${token}` });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(401);
  });
});

describe("createAuthMiddleware — scope enforcement", () => {
  it("returns 403 for an unmapped path (no scope rule)", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["project:create"]);
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/api/v1/totally-unknown-path/",
    });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("forbidden");
  });

  it("returns 403 when token scopes do not include required scope", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["enterprise:balance"]);
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/api/v1/project/",
    });
    const res = (await mw(ctx, noopNext)) as Response;
    expect(res.status).toBe(403);
  });

  it("wildcard scope '*' passes any mapped path", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["*"]);
    let called = false;
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/api/v1/enterprise/balance/",
    });
    const res = await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
    expect(res).toBeUndefined();
  });

  it("exact scope match allows access", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["project:create"]);
    let called = false;
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/api/v1/project/",
    });
    const res = await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
    expect(res).toBeUndefined();
  });
});

describe("createAuthMiddleware — context population on success", () => {
  it("sets apiKey on context with consumerId and jti from JWT", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["*"]);
    const { ctx, store } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/api/v1/project/",
    });
    await mw(ctx, noopNext);
    const apiKey = store.get("apiKey") as {
      id: string;
      consumerId: string;
      scopes: string[];
      rateLimitRpm: null;
    };
    expect(apiKey).toBeDefined();
    expect(apiKey.consumerId).toBe("consumer-abc");
    expect(apiKey.scopes).toEqual(["*"]);
    expect(apiKey.rateLimitRpm).toBeNull();
    expect(typeof apiKey.id).toBe("string");
    expect(apiKey.id.length).toBeGreaterThan(0);
  });

  it("calls next() exactly once on success", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["*"]);
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/api/v1/enterprise/balance/",
    });
    let callCount = 0;
    await mw(ctx, async () => { callCount++; });
    expect(callCount).toBe(1);
  });
});

describe("createAuthMiddleware — path normalization", () => {
  it("accepts sub-app relative path (without /api/v1 prefix)", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["*"]);
    let called = false;
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: "http://localhost/enterprise/balance/",
    });
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  it("handles project detail UUID route", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["project:detail"]);
    const projectId = crypto.randomUUID();
    let called = false;
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: `http://localhost/api/v1/project/${projectId}/`,
    });
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  it("handles project progress route", async () => {
    const mw = createAuthMiddleware();
    const token = await makeValidToken(["project:progress:read"]);
    const projectId = crypto.randomUUID();
    let called = false;
    const { ctx } = makeContext({
      authHeader: `Bearer ${token}`,
      url: `http://localhost/api/v1/project/${projectId}/progress`,
    });
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });
});
