import { Hono } from "hono";
import { z } from "zod";
import { signAccessJwt } from "../auth/jwt.ts";
import { hashPassword, verifyPassword } from "../crypto/password.ts";
import type { IssueKeyResult } from "../db/access.ts";
import { envelope } from "../http/response.ts";
import { logInfo, logWarn } from "../logging/logger.ts";

const registerSchema = z.object({
  name: z.string().min(1).max(256),
  email: z.string().email(),
  password: z.string().min(8),
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

async function tokenBody(
  result: IssueKeyResult,
  jwtInput: { secret: string; expiresInHours: number },
): Promise<Record<string, unknown>> {
  const issuedAt = new Date().toISOString();
  const jwt = await signAccessJwt({
    consumerId: result.consumerId,
    scopes: result.scopes,
    secret: jwtInput.secret,
    expiresInHours: jwtInput.expiresInHours,
  });
  return {
    token_type: "Bearer",
    access_token: jwt.token,
    consumer_id: result.consumerId,
    key_id: result.keyId,
    prefix: result.prefix,
    scopes: result.scopes,
    issued_at: issuedAt,
    expires_at: jwt.expiresAt,
  };
}

export function authRoutes(): Hono {
  const r = new Hono();

  r.post("/auth/register", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");
    const requestId = c.get("requestId");
    logInfo("auth.register.start", { requestId });

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logWarn("auth.register.invalid_json", { requestId });
      return c.json(envelope(400, "Invalid JSON", { error: "bad_request" }), 400);
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      logWarn("auth.register.validation_failed", { requestId });
      return c.json(
        envelope(400, "Validation error", {
          error: "bad_request",
          details: parsed.error.flatten(),
        }),
        400,
      );
    }

    const email = normalizeEmail(parsed.data.email);
    const scopes = ["*"];

    const existing = await db.findConsumerByEmail(email);
    if (existing) {
      logWarn("auth.register.conflict", { requestId, email });
      return c.json(envelope(409, "Email already registered", { error: "conflict" }), 409);
    }

    const passwordHash = await hashPassword(parsed.data.password, env.BCRYPT_COST);
    try {
      const result = await db.registerConsumerWithPassword({
        name: parsed.data.name,
        email,
        passwordHash,
        scopes,
      });
      const token = await tokenBody(result, {
        secret: env.JWT_SECRET,
        expiresInHours: env.JWT_EXPIRES_IN_HOURS,
      });
      logInfo("auth.register.success", { requestId, consumerId: result.consumerId });
      return c.json(envelope(201, "Registration successful", token), 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE") || msg.includes("unique") || msg.includes("duplicate")) {
        logWarn("auth.register.conflict", { requestId, email });
        return c.json(envelope(409, "Email already registered", { error: "conflict" }), 409);
      }
      throw e;
    }
  });

  r.post("/auth/login", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");
    const requestId = c.get("requestId");
    logInfo("auth.login.start", { requestId });

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logWarn("auth.login.invalid_json", { requestId });
      return c.json(envelope(400, "Invalid JSON", { error: "bad_request" }), 400);
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      logWarn("auth.login.validation_failed", { requestId });
      return c.json(
        envelope(400, "Validation error", {
          error: "bad_request",
          details: parsed.error.flatten(),
        }),
        400,
      );
    }

    const email = normalizeEmail(parsed.data.email);
    const consumer = await db.findConsumerByEmail(email);
    if (!consumer?.passwordHash) {
      logWarn("auth.login.invalid_credentials", { requestId, email });
      return c.json(envelope(401, "Invalid email or password", { error: "unauthorized" }), 401);
    }

    const ok = await verifyPassword(parsed.data.password, consumer.passwordHash);
    if (!ok) {
      logWarn("auth.login.invalid_credentials", { requestId, email });
      return c.json(envelope(401, "Invalid email or password", { error: "unauthorized" }), 401);
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
    const token = await tokenBody(result, {
      secret: env.JWT_SECRET,
      expiresInHours: env.JWT_EXPIRES_IN_HOURS,
    });
    logInfo("auth.login.success", { requestId, consumerId: result.consumerId });
    return c.json(envelope(201, "Login successful", token), 201);
  });

  r.post("/auth/token", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");
    const requestId = c.get("requestId");
    logInfo("auth.admin_token.start", { requestId });

    const adminTok = c.req.header("x-admin-token");
    if (!adminTok || adminTok !== env.ADMIN_BOOTSTRAP_TOKEN) {
      logWarn("auth.admin_token.unauthorized", { requestId });
      return c.json(envelope(401, "Invalid admin token", { error: "unauthorized" }), 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logWarn("auth.admin_token.invalid_json", { requestId });
      return c.json(envelope(400, "Invalid JSON", { error: "bad_request" }), 400);
    }
    const parsed = adminTokenSchema.safeParse(body);
    if (!parsed.success) {
      logWarn("auth.admin_token.validation_failed", { requestId });
      return c.json(
        envelope(400, "Validation error", {
          error: "bad_request",
          details: parsed.error.flatten(),
        }),
        400,
      );
    }

    const scopes = parsed.data.scopes ?? ["*"];
    const result = await db.createConsumerWithKey({ name: parsed.data.name, scopes });
    const token = await tokenBody(result, {
      secret: env.JWT_SECRET,
      expiresInHours: env.JWT_EXPIRES_IN_HOURS,
    });
    logInfo("auth.admin_token.success", { requestId, consumerId: result.consumerId });
    return c.json(envelope(201, "Token issued", token), 201);
  });

  r.post("/auth/api-keys", async (c) => {
    const env = c.get("env");
    const db = c.get("dbAccess");
    const requestId = c.get("requestId");
    logInfo("auth.admin_api_key.start", { requestId });

    const adm = c.req.header("x-admin-token");
    if (!adm || adm !== env.ADMIN_BOOTSTRAP_TOKEN) {
      logWarn("auth.admin_api_key.unauthorized", { requestId });
      return c.json(envelope(401, "Invalid admin token", { error: "unauthorized" }), 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      logWarn("auth.admin_api_key.invalid_json", { requestId });
      return c.json(envelope(400, "Invalid JSON", { error: "bad_request" }), 400);
    }
    const parsed = adminApiKeySchema.safeParse(body);
    if (!parsed.success) {
      logWarn("auth.admin_api_key.validation_failed", { requestId });
      return c.json(
        envelope(400, "Validation error", {
          error: "bad_request",
          details: parsed.error.flatten(),
        }),
        400,
      );
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
    const token = await tokenBody(result, {
      secret: env.JWT_SECRET,
      expiresInHours: env.JWT_EXPIRES_IN_HOURS,
    });
    logInfo("auth.admin_api_key.success", { requestId, consumerId: result.consumerId });
    return c.json(envelope(201, "Token issued", token), 201);
  });

  return r;
}
