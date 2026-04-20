import { Hono } from "hono";
import { z } from "zod";

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
    const token = c.req.header("x-admin-token");
    const env = c.get("env");
    if (!token || token !== env.ADMIN_BOOTSTRAP_TOKEN) {
      return c.json({ error: "unauthorized", message: "Invalid admin token" }, 401);
    }
    await next();
  });

  r.post("/admin/consumers", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
    const parsed = createConsumerSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: parsed.error.flatten() }, 400);
    }
    const scopes = parsed.data.scopes ?? ["*"];
    const dbAccess = c.get("dbAccess");
    const out = await dbAccess.createConsumerWithKey({
      name: parsed.data.name,
      scopes,
    });
    return c.json(
      {
        consumerId: out.consumerId,
        keyId: out.keyId,
        apiKey: out.plaintext,
        prefix: out.prefix,
        scopes,
        warning: "Store apiKey securely; it is shown only once.",
      },
      201,
    );
  });

  r.post("/admin/api-keys", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
    const parsed = createKeySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: parsed.error.flatten() }, 400);
    }
    const scopes = parsed.data.scopes ?? ["*"];
    const dbAccess = c.get("dbAccess");
    const out = await dbAccess.createApiKeyForConsumer({
      consumerId: parsed.data.consumerId,
      scopes,
    });
    return c.json(
      {
        consumerId: parsed.data.consumerId,
        keyId: out.keyId,
        apiKey: out.plaintext,
        prefix: out.prefix,
        scopes,
        warning: "Store apiKey securely; it is shown only once.",
      },
      201,
    );
  });

  return r;
}
