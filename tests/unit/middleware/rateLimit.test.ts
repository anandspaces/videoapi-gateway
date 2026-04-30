import { beforeEach, describe, expect, it } from "bun:test";
import type { Context, Next } from "hono";
import {
  createRateLimitMiddleware,
  resetRateLimitBucketsForTests,
} from "../../../src/middleware/rateLimit.ts";

type ApiKeyCtx = { id: string; consumerId: string; scopes: string[]; rateLimitRpm: number | null };

function mockContext(apiKey: ApiKeyCtx): Context {
  return {
    get: (k: string) => (k === "apiKey" ? apiKey : undefined),
    json: (body: unknown, status?: number) =>
      new Response(JSON.stringify(body), { status: status ?? 200 }),
  } as unknown as Context;
}

describe("createRateLimitMiddleware", () => {
  beforeEach(() => {
    resetRateLimitBucketsForTests();
  });

  it("calls next when rateLimitRpm is null", async () => {
    const mw = createRateLimitMiddleware();
    let called = false;
    await mw(
      mockContext({ id: "a", consumerId: "c", scopes: [], rateLimitRpm: null }),
      async () => {
        called = true;
      },
    );
    expect(called).toBe(true);
  });

  it("calls next when rateLimitRpm is zero or negative", async () => {
    const mw = createRateLimitMiddleware();
    for (const rpm of [0, -1]) {
      let called = false;
      await mw(
        mockContext({ id: `k-${rpm}`, consumerId: "c", scopes: [], rateLimitRpm: rpm }),
        async () => {
          called = true;
        },
      );
      expect(called).toBe(true);
    }
  });

  it("returns 429 after exceeding rpm within the same minute window", async () => {
    const mw = createRateLimitMiddleware();
    const apiKey = { id: "rl-1", consumerId: "c", scopes: ["*"], rateLimitRpm: 2 };
    const ctx = mockContext(apiKey);
    const next: Next = async () => {};

    await mw(ctx, next);
    await mw(ctx, next);
    const res = await mw(ctx, next);
    expect(res).toBeDefined();
    expect((res as Response).status).toBe(429);
  });
});
