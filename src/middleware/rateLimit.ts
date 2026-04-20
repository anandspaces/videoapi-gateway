import type { Context, Next } from "hono";

type Bucket = { windowId: number; count: number };

const buckets = new Map<string, Bucket>();

function windowId(now: number): number {
  return Math.floor(now / 60_000);
}

export function createRateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const row = c.get("apiKey");
    const limit = row.rateLimitRpm;
    if (limit == null || limit <= 0) {
      await next();
      return;
    }

    const now = Date.now();
    const wid = windowId(now);
    const key = row.id;
    let b = buckets.get(key);
    if (!b || b.windowId !== wid) {
      b = { windowId: wid, count: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > limit) {
      return c.json({ error: "rate_limit_exceeded", message: "Too many requests" }, 429);
    }
    await next();
  };
}
