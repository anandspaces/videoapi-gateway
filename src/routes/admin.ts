import { Hono } from "hono";
import { z } from "zod";
import { envelope } from "../http/response.ts";
import { logInfo, logWarn } from "../logging/logger.ts";

const createConsumerSchema = z.object({
  name: z.string().min(1).max(256),
  scopes: z.array(z.string()).optional(),
});

const createKeySchema = z.object({
  consumerId: z.string().uuid(),
  scopes: z.array(z.string()).optional(),
});

/** Mounted at `/internal` so paths are `/internal/admin/...`. */
export function adminRoutes() {
  const r = new Hono();

  r.use("/admin/*", async (c, next) => {
    const requestId = c.get("requestId");
    const token = c.req.header("x-admin-token");
    const env = c.get("env");
    if (!token || token !== env.ADMIN_BOOTSTRAP_TOKEN) {
      logWarn("admin.auth.failed", { requestId });
      return c.json(envelope(401, "Invalid admin token", { error: "unauthorized" }), 401);
    }
    logInfo("admin.auth.passed", { requestId });
    await next();
  });

  r.post("/admin/consumers", async (c) => {
    const requestId = c.get("requestId");
    logInfo("admin.consumers.create.start", { requestId });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logWarn("admin.consumers.create.invalid_json", { requestId });
      return c.json(envelope(400, "Invalid JSON", { error: "bad_request" }), 400);
    }
    const parsed = createConsumerSchema.safeParse(body);
    if (!parsed.success) {
      logWarn("admin.consumers.create.validation_failed", { requestId });
      return c.json(
        envelope(400, "Validation error", { error: "bad_request", details: parsed.error.flatten() }),
        400,
      );
    }
    const scopes = parsed.data.scopes ?? ["*"];
    const dbAccess = c.get("dbAccess");
    const out = await dbAccess.createConsumerWithKey({
      name: parsed.data.name,
      scopes,
    });
    logInfo("admin.consumers.create.success", { requestId, consumerId: out.consumerId });
    return c.json(
      envelope(201, "Consumer created", {
        consumerId: out.consumerId,
        keyId: out.keyId,
        apiKey: out.plaintext,
        prefix: out.prefix,
        scopes,
        warning: "Store apiKey securely; it is shown only once.",
      }),
      201,
    );
  });

  r.post("/admin/api-keys", async (c) => {
    const requestId = c.get("requestId");
    logInfo("admin.api_keys.create.start", { requestId });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logWarn("admin.api_keys.create.invalid_json", { requestId });
      return c.json(envelope(400, "Invalid JSON", { error: "bad_request" }), 400);
    }
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      logWarn("admin.api_keys.create.validation_failed", { requestId });
      return c.json(
        envelope(400, "Validation error", { error: "bad_request", details: parsed.error.flatten() }),
        400,
      );
    }
    const scopes = parsed.data.scopes ?? ["*"];
    const dbAccess = c.get("dbAccess");
    const out = await dbAccess.createApiKeyForConsumer({
      consumerId: parsed.data.consumerId,
      scopes,
    });
    logInfo("admin.api_keys.create.success", { requestId, consumerId: parsed.data.consumerId });
    return c.json(
      envelope(201, "API key created", {
        consumerId: parsed.data.consumerId,
        keyId: out.keyId,
        apiKey: out.plaintext,
        prefix: out.prefix,
        scopes,
        warning: "Store apiKey securely; it is shown only once.",
      }),
      201,
    );
  });

  return r;
}
