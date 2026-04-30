import type { Context, Next } from "hono";
import { envelope } from "../http/response.ts";
import { logInfo, logWarn } from "../logging/logger.ts";
import { normalizeGatewayPathname } from "./apiPath.ts";
import { verifyAccessJwt } from "./jwt.ts";
import { pathUnderApiV1, requiredScopeForPath, scopesAllow } from "./scopes.ts";

export function createAuthMiddleware() {
  return async (c: Context, next: Next) => {
    const requestId = c.get("requestId");
    const auth = c.req.header("authorization");
    if (!auth?.toLowerCase().startsWith("bearer ")) {
      logWarn("auth.middleware.missing_bearer", { requestId });
      return c.json(envelope(401, "Missing Bearer token", { error: "unauthorized" }), 401);
    }
    const token = auth.slice(7).trim();
    if (!token) {
      logWarn("auth.middleware.empty_bearer", { requestId });
      return c.json(envelope(401, "Empty Bearer token", { error: "unauthorized" }), 401);
    }

    const env = c.get("env");
    const payload = await verifyAccessJwt(token, env.JWT_SECRET);
    if (!payload) {
      logWarn("auth.middleware.invalid_token", { requestId });
      return c.json(envelope(401, "Invalid or expired token", { error: "unauthorized" }), 401);
    }

    const pathname = normalizeGatewayPathname(new URL(c.req.url).pathname);
    const rest = pathUnderApiV1(pathname);
    if (rest === null) {
      logWarn("auth.middleware.invalid_path", { requestId, pathname });
      return c.json(envelope(403, "Invalid path", { error: "forbidden" }), 403);
    }
    const required = requiredScopeForPath(rest);
    if (!scopesAllow(required, payload.scope)) {
      logWarn("auth.middleware.insufficient_scope", { requestId, requiredScope: required });
      return c.json(
        envelope(403, "Insufficient scope for this endpoint", { error: "forbidden" }),
        403,
      );
    }

    logInfo("auth.middleware.authorized", { requestId, consumerId: payload.sub });
    c.set("apiKey", {
      id: payload.jti,
      consumerId: payload.sub,
      scopes: payload.scope,
      rateLimitRpm: null,
    });
    await next();
  };
}
