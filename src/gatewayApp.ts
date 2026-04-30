import { Hono } from "hono";
import { cors } from "hono/cors";
import { normalizeGatewayPathname } from "./auth/apiPath.ts";
import { createAuthMiddleware } from "./auth/verifyApiKey.ts";
import type { DbAccess } from "./db/access.ts";
import type { Env } from "./env.ts";
import { envelope } from "./http/response.ts";
import { logError, logInfo, logWarn } from "./logging/logger.ts";
import { createRateLimitMiddleware } from "./middleware/rateLimit.ts";
import {
  buildUpstreamHeaders,
  filterResponseHeaders,
  joinUpstreamUrl,
  proxyToUpstream,
} from "./proxy/upstream.ts";
import { adminRoutes } from "./routes/admin.ts";
import { authRoutes } from "./routes/auth.ts";
import { docsRoutes } from "./routes/docs.ts";
import { healthRoutes } from "./routes/health.ts";

export function buildGatewayApp(ctx: { env: Env; dbAccess: DbAccess }): Hono {
  const { env, dbAccess } = ctx;

  const app = new Hono();

  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    const start = Date.now();
    c.set("env", env);
    c.set("dbAccess", dbAccess);
    c.set("requestId", requestId);
    logInfo("http.request.start", {
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    });
    await next();
    logInfo("http.request.end", {
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      statusCode: c.res.status,
      durationMs: Date.now() - start,
    });
  });

  app.onError((err, c) => {
    logError("http.request.error", {
      requestId: c.get("requestId"),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json(envelope(500, "Internal server error", { error: "internal_error" }), 500);
  });

  if (env.CORS_ORIGINS.length > 0) {
    app.use(
      "*",
      cors({
        origin: env.CORS_ORIGINS,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allowHeaders: ["Authorization", "Content-Type", "X-Admin-Token"],
        exposeHeaders: ["Content-Type"],
      }),
    );
  }

  app.route("/api/v1", healthRoutes());
  app.route("/api/v1", docsRoutes());
  app.route("/api/v1", authRoutes());
  app.route("/api/v1/internal", adminRoutes());

  const apiV1 = new Hono();

  // Variables set on the parent do not propagate to `app.route()` sub-apps in Hono.
  apiV1.use("*", async (c, next) => {
    c.set("env", env);
    c.set("dbAccess", dbAccess);
    await next();
  });

  apiV1.options("*", (c) => c.body(null, 204));

  apiV1.use("*", createAuthMiddleware());
  apiV1.use("*", createRateLimitMiddleware());

  apiV1.all("*", async (c) => {
    const requestId = c.get("requestId");
    const url = new URL(c.req.url);
    const pathname = normalizeGatewayPathname(url.pathname);
    let pq = pathname.replace(/^\/api\/v1/, "") || "/";
    if (!pq.startsWith("/")) pq = `/${pq}`;
    const pathAndQuery = `${pq}${url.search}`;

    const target = joinUpstreamUrl(env.UPSTREAM_BASE_URL, pathAndQuery);
    logInfo("proxy.forward.start", {
      requestId,
      method: c.req.method,
      path: pathname,
      target,
    });

    const headers = buildUpstreamHeaders(c.req.raw.headers, env.UPSTREAM_BEARER_TOKEN);

    const method = c.req.method;
    const body = method === "GET" || method === "HEAD" ? undefined : (c.req.raw.body ?? undefined);

    let upstream: Response;
    try {
      upstream = await proxyToUpstream({
        upstreamUrl: target,
        method,
        headers,
        body,
        timeoutMs: env.UPSTREAM_TIMEOUT_MS,
      });
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError" ? "Upstream timeout" : "Upstream error";
      logWarn("proxy.forward.failed", {
        requestId,
        method: c.req.method,
        path: pathname,
        target,
        error: e instanceof Error ? e.message : String(e),
      });
      return c.json(envelope(502, msg, { error: "bad_gateway" }), 502);
    }

    const responseHeaders = filterResponseHeaders(upstream);
    const contentType = upstream.headers.get("content-type") ?? "";
    const isJson = contentType.toLowerCase().includes("application/json");

    if (isJson) {
      let upstreamJson: unknown;
      try {
        upstreamJson = await upstream.json();
      } catch {
        upstreamJson = null;
      }
      logInfo("proxy.forward.success", {
        requestId,
        method: c.req.method,
        path: pathname,
        target,
        upstreamStatus: upstream.status,
        contentType,
      });
      return new Response(
        JSON.stringify(
          envelope(
            upstream.status,
            upstream.ok ? "Request successful" : "Upstream request failed",
            {
              upstream: upstreamJson,
              status_code: upstream.status,
            },
          ),
        ),
        {
          status: upstream.status,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const upstreamText = await upstream.text();
    logInfo("proxy.forward.success", {
      requestId,
      method: c.req.method,
      path: pathname,
      target,
      upstreamStatus: upstream.status,
      contentType,
    });
    return new Response(
      JSON.stringify(
        envelope(upstream.status, upstream.ok ? "Request successful" : "Upstream request failed", {
          raw: upstreamText,
          content_type: contentType || null,
          status_code: upstream.status,
        }),
      ),
      {
        status: upstream.status,
        headers: {
          ...responseHeaders,
          "content-type": "application/json",
        },
      },
    );
  });

  app.route("/api/v1", apiV1);

  return app;
}
