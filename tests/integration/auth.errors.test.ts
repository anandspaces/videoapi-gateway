import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { signAccessJwt } from "../../src/auth/jwt.ts";
import { registerUser, setupGateway } from "./helpers/setup.ts";

describe("auth error cases", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    ({ app, upstream } = await setupGateway());
  });

  afterAll(() => upstream?.stop());

  // ── Register validation ──────────────────────────────────────────────────

  it("register: 400 when body is missing required fields", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "No Email" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("bad_request");
  });

  it("register: 400 when password is too short (< 8 chars)", async () => {
    const email = `short-pw-${crypto.randomUUID()}@example.com`;
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "A", email, password: "short" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("register: 400 when email is malformed", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "A", email: "not-an-email", password: "password123" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("register: 400 when body is not valid JSON", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json at all",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("register: 409 on duplicate email", async () => {
    const { email } = await registerUser(app);

    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Dup", email, password: "password123" }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("conflict");
  });

  it("register: 409 is case-insensitive for email", async () => {
    const { email } = await registerUser(app);
    const upperEmail = email.toUpperCase();

    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Dup", email: upperEmail, password: "password123" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  // ── Login ────────────────────────────────────────────────────────────────

  it("login: 401 for non-existent email", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ghost@nowhere.example.com", password: "password123" }),
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("unauthorized");
  });

  it("login: 401 for correct email but wrong password", async () => {
    const { email } = await registerUser(app);

    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "wrongpassword" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("login: 400 when email field is missing", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "password123" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // ── Proxy auth ───────────────────────────────────────────────────────────

  it("proxy: 401 when Authorization header is absent", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/"),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("unauthorized");
  });

  it("proxy: 401 when token is not a JWT (raw API key syntax)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        headers: { Authorization: "Bearer gw_live_notajwt" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("proxy: 401 when JWT is signed with wrong secret", async () => {
    const { token } = await signAccessJwt({
      consumerId: "fake-consumer-id",
      scopes: ["*"],
      secret: "totally-wrong-secret-that-is-long-enough",
      expiresInHours: 1,
    });

    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Invalid or expired token");
  });

  it("proxy: 401 when JWT is expired", async () => {
    const { token } = await signAccessJwt({
      consumerId: "fake-consumer-id",
      scopes: ["*"],
      secret: "12345678901234567890123456789012",
      expiresInHours: -1,
    });

    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("proxy: 403 when path has no scope rule (unknown endpoint)", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request("http://localhost/api/v1/no-such-route/", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { data: { error: string } };
    expect(body.data.error).toBe("forbidden");
  });

  it("proxy: 403 when token scopes do not include the required scope", async () => {
    // Sign a JWT with only enterprise:balance scope, then hit /project/
    const { token } = await signAccessJwt({
      consumerId: "some-consumer",
      scopes: ["enterprise:balance"],
      secret: "12345678901234567890123456789012",
      expiresInHours: 1,
    });

    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  // ── Health (sanity: unprotected route always reachable) ──────────────────

  it("GET /api/v1/health returns 200 with no auth", async () => {
    const res = await app.fetch(new Request("http://localhost/api/v1/health"));
    expect(res.status).toBe(200);
  });
});
