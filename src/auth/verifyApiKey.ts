import type { Context, Next } from "hono";
import { hashApiKey } from "../crypto/hash.ts";
import { normalizeGatewayPathname } from "./apiPath.ts";
import { pathUnderApiV1, requiredScopeForPath, scopesAllow } from "./scopes.ts";

export function createAuthMiddleware() {
  return async (c: Context, next: Next) => {
    const auth = c.req.header("authorization");
    if (!auth?.toLowerCase().startsWith("bearer ")) {
      return c.json({ error: "unauthorized", message: "Missing Bearer token" }, 401);
    }
    const token = auth.slice(7).trim();
    if (!token) {
      return c.json({ error: "unauthorized", message: "Empty Bearer token" }, 401);
    }

    const env = c.get("env");
    const dbAccess = c.get("dbAccess");
    const hash = await hashApiKey(token, env.API_KEY_PEPPER);
    const row = await dbAccess.findApiKeyByHash(hash);
    if (!row) {
      return c.json({ error: "unauthorized", message: "Invalid API key" }, 401);
    }

    const pathname = normalizeGatewayPathname(new URL(c.req.url).pathname);
    const rest = pathUnderApiV1(pathname);
    if (rest === null) {
      return c.json({ error: "forbidden", message: "Invalid path" }, 403);
    }
    const required = requiredScopeForPath(rest);
    if (!scopesAllow(required, row.scopes)) {
      return c.json({ error: "forbidden", message: "Insufficient scope for this endpoint" }, 403);
    }

    c.set("apiKey", row);
    await next();
  };
}
