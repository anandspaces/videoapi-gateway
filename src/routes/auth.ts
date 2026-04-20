import { Hono } from "hono";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../crypto/password.ts";
import type { IssueKeyResult } from "../db/access.ts";

const registerSchema = z.object({
  name: z.string().min(1).max(256),
  email: z.string().email(),
  password: z.string().min(8),
  scopes: z.array(z.string()).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const adminTokenSchema = z.object({
  name: z.string().min(1).max(256),
  scopes: z.array(z.string()).optional(),
});

const adminApiKeySchema = z.object({
  consumerId: z.string().uuid(),
  scopes: z.array(z.string()).optional(),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function tokenBody(result: IssueKeyResult): Record<string, unknown> {
  return {
    token_type: "Bearer",
    access_token: result.plaintext,
    consumer_id: result.consumerId,
    key_id: result.keyId,
    prefix: result.prefix,
    scopes: result.scopes,
    issued_at: new Date().toISOString(),
  };
}

export function authRoutes(): Hono {
  const r = new Hono();

  r.post("/auth/register", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: parsed.error.flatten() }, 400);
    }

    const email = normalizeEmail(parsed.data.email);
    const scopes = parsed.data.scopes ?? ["*"];

    const adminHeader = c.req.header("x-admin-token");
    const adminValid = !!adminHeader && adminHeader === env.ADMIN_BOOTSTRAP_TOKEN;
    if (!env.ALLOW_PUBLIC_REGISTRATION && !adminValid) {
      return c.json(
        { error: "forbidden", message: "Public registration is disabled; send X-Admin-Token" },
        403,
      );
    }

    const existing = await db.findConsumerByEmail(email);
    if (existing) {
      return c.json({ error: "conflict", message: "Email already registered" }, 409);
    }

    const passwordHash = await hashPassword(parsed.data.password);
    try {
      const result = await db.registerConsumerWithPassword({
        name: parsed.data.name,
        email,
        passwordHash,
        scopes,
      });
      return c.json(tokenBody(result), 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("unique") || msg.includes("duplicate")) {
        return c.json({ error: "conflict", message: "Email already registered" }, 409);
      }
      throw e;
    }
  });

  r.post("/auth/login", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: parsed.error.flatten() }, 400);
    }

    const email = normalizeEmail(parsed.data.email);
    const consumer = await db.findConsumerByEmail(email);
    if (!consumer?.passwordHash) {
      return c.json({ error: "unauthorized", message: "Invalid email or password" }, 401);
    }

    const ok = await verifyPassword(parsed.data.password, consumer.passwordHash);
    if (!ok) {
      return c.json({ error: "unauthorized", message: "Invalid email or password" }, 401);
    }

    const scopes = await db.getLatestActiveKeyScopes(consumer.id);
    const key = await db.createApiKeyForConsumer({ consumerId: consumer.id, scopes });

    if (env.AUTH_REVOKE_KEYS_ON_LOGIN) {
      await db.revokeOtherApiKeys(consumer.id, key.keyId);
    }

    const result: IssueKeyResult = {
      consumerId: consumer.id,
      plaintext: key.plaintext,
      prefix: key.prefix,
      keyId: key.keyId,
      scopes,
    };
    return c.json(tokenBody(result), 201);
  });

  r.post("/auth/token", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");

    const adminTok = c.req.header("x-admin-token");
    if (!adminTok || adminTok !== env.ADMIN_BOOTSTRAP_TOKEN) {
      return c.json({ error: "unauthorized", message: "Invalid admin token" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
    const parsed = adminTokenSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: parsed.error.flatten() }, 400);
    }

    const scopes = parsed.data.scopes ?? ["*"];
    const result = await db.createConsumerWithKey({ name: parsed.data.name, scopes });
    return c.json(tokenBody(result), 201);
  });

  r.post("/auth/api-keys", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");

    const adm = c.req.header("x-admin-token");
    if (!adm || adm !== env.ADMIN_BOOTSTRAP_TOKEN) {
      return c.json({ error: "unauthorized", message: "Invalid admin token" }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request", message: "Invalid JSON" }, 400);
    }
    const parsed = adminApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: parsed.error.flatten() }, 400);
    }

    const scopes = parsed.data.scopes ?? ["*"];
    const key = await db.createApiKeyForConsumer({
      consumerId: parsed.data.consumerId,
      scopes,
    });

    const result: IssueKeyResult = {
      consumerId: parsed.data.consumerId,
      plaintext: key.plaintext,
      prefix: key.prefix,
      keyId: key.keyId,
      scopes,
    };
    return c.json(tokenBody(result), 201);
  });

  return r;
}
