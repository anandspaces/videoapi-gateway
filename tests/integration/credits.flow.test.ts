import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { drainWallet, getWalletBalance, registerUser, setupGateway } from "./helpers/setup.ts";

describe("credits flow", () => {
  let app: Hono;
  let upstream: ReturnType<typeof Bun.serve>;
  let databaseUrl: string;

  beforeAll(async () => {
    ({ app, upstream, databaseUrl } = await setupGateway());
  });

  afterAll(() => upstream?.stop());

  it("registration grants 100 credits in the wallet", async () => {
    const { consumerId } = await registerUser(app);
    const balance = await getWalletBalance(databaseUrl, consumerId);
    expect(balance).toBe(100);
  });

  it("POST /project/ deducts 1 credit from the wallet", async () => {
    const { token, consumerId } = await registerUser(app);

    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const balance = await getWalletBalance(databaseUrl, consumerId);
    expect(balance).toBe(99);
  });

  it("multiple POST /project/ calls each deduct 1 credit", async () => {
    const { token, consumerId } = await registerUser(app);

    for (let i = 0; i < 3; i++) {
      await app.fetch(
        new Request("http://localhost/api/v1/project/", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    }

    const balance = await getWalletBalance(databaseUrl, consumerId);
    expect(balance).toBe(97);
  });

  it("returns 402 with insufficient_credits when wallet is empty", async () => {
    const { token, consumerId } = await registerUser(app);
    await drainWallet(databaseUrl, consumerId);

    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      status: number;
      message: string;
      data: { error: string; balance: number; required: number };
    };
    expect(body.status).toBe(0);
    expect(body.data.error).toBe("insufficient_credits");
    expect(body.data.balance).toBe(0);
    expect(body.data.required).toBe(1);
  });

  it("balance stays at 0 after a failed 402 request", async () => {
    const { token, consumerId } = await registerUser(app);
    await drainWallet(databaseUrl, consumerId);

    await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const balance = await getWalletBalance(databaseUrl, consumerId);
    expect(balance).toBe(0);
  });

  it("GET /project/{uuid}/progress does NOT deduct credits", async () => {
    const { token, consumerId } = await registerUser(app);
    const projectId = crypto.randomUUID();

    await app.fetch(
      new Request(`http://localhost/api/v1/project/${projectId}/progress`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const balance = await getWalletBalance(databaseUrl, consumerId);
    expect(balance).toBe(100);
  });

  it("GET /project/{uuid}/ does NOT deduct credits", async () => {
    const { token, consumerId } = await registerUser(app);
    const projectId = crypto.randomUUID();

    await app.fetch(
      new Request(`http://localhost/api/v1/project/${projectId}/`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const balance = await getWalletBalance(databaseUrl, consumerId);
    expect(balance).toBe(100);
  });

  it("proxied response body wraps upstream JSON under data.upstream", async () => {
    const { token } = await registerUser(app);

    const res = await app.fetch(
      new Request("http://localhost/api/v1/project/", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    const body = (await res.json()) as {
      status: number;
      data: { upstream: { ok: boolean }; status_code: number };
    };
    expect(body.status).toBe(1);
    expect(body.data.upstream).toEqual({ ok: true });
    expect(body.data.status_code).toBe(200);
  });
});
