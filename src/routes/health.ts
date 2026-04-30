import { Hono } from "hono";
import { envelope } from "../http/response.ts";
import { logInfo } from "../logging/logger.ts";

export function healthRoutes() {
  const r = new Hono();
  r.get("/health", (c) => {
    logInfo("health.check", { requestId: c.get("requestId") });
    return c.json(envelope(200, "Healthy", { status: "ok" }));
  });
  return r;
}
