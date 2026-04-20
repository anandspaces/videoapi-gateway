import { Hono } from "hono";
import { cors } from "hono/cors";
import { normalizeGatewayPathname } from "./auth/apiPath.ts";
import { createAuthMiddleware } from "./auth/verifyApiKey.ts";
import type { DbAccess } from "./db/access.ts";
import type { Env } from "./env.ts";
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
    c.set("env", env);
    c.set("dbAccess", dbAccess);
    await next();
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

  app.route("/", healthRoutes());
  app.route("/", docsRoutes());
  app.route("/", authRoutes());
  app.route("/internal", adminRoutes());

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
    const url = new URL(c.req.url);
    const pathname = normalizeGatewayPathname(url.pathname);
    let pq = pathname.replace(/^\/api\/v1/, "") || "/";
    if (!pq.startsWith("/")) pq = `/${pq}`;
    const pathAndQuery = `${pq}${url.search}`;

    const target = joinUpstreamUrl(env.UPSTREAM_BASE_URL, pathAndQuery);

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
      return c.json({ error: "bad_gateway", message: msg }, 502);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: filterResponseHeaders(upstream),
    });
  });

  app.route("/api/v1", apiV1);

  return app;
}
