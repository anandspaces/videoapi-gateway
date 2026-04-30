import { readFileSync } from "fs";
import type { Context } from "hono";
import { join } from "path";
import type { Env } from "../env.ts";

function getRequestOrigin(c: Context, env: Env): string {
  if (env.GATEWAY_PUBLIC_URL) {
    return env.GATEWAY_PUBLIC_URL;
  }
  const url = new URL(c.req.url);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  const xfProto = c.req.header("x-forwarded-proto");
  const proto =
    xfProto ?? (url.protocol === "https:" ? "https" : url.protocol === "http:" ? "http" : "http");
  return `${proto}://${host}`;
}

function gatewayAuthPaths(origin: string): Record<string, unknown> {
  const servers = [{ url: origin, description: "Gateway" }];
  const tokenDataSchema = {
    type: "object",
    properties: {
      token_type: { type: "string", example: "Bearer" },
      access_token: { type: "string", description: "Signed JWT access token." },
      consumer_id: { type: "string", format: "uuid" },
      key_id: { type: "string", format: "uuid" },
      prefix: { type: "string" },
      scopes: { type: "array", items: { type: "string" } },
      issued_at: { type: "string", format: "date-time" },
      expires_at: { type: "string", format: "date-time" },
    },
  };
  const envelopeSchema = (dataSchema: Record<string, unknown>) => ({
    type: "object",
    properties: {
      status: { type: "integer", enum: [-1, 0, 1, 2, 3] },
      message: { type: "string" },
      data: dataSchema,
    },
  });
  const tokenResponse = {
    "201": {
      description: "Issued",
      content: {
        "application/json": {
          schema: envelopeSchema(tokenDataSchema),
        },
      },
    },
  };

  return {
    "/api/v1/auth/register": {
      servers,
      post: {
        tags: ["Gateway Auth"],
        summary: "Register",
        description:
          "Create an account with email and password and receive a gateway API key with starter credits.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "email", "password"],
                properties: {
                  name: { type: "string" },
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          ...tokenResponse,
          "400": { description: "Validation error (enveloped response)" },
          "409": { description: "Email already registered (enveloped response)" },
        },
      },
    },
    "/api/v1/auth/login": {
      servers,
      post: {
        tags: ["Gateway Auth"],
        summary: "Login",
        description:
          "Verify email and password and issue a new gateway API key (optionally revoking other keys).",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          ...tokenResponse,
          "400": { description: "Validation error (enveloped response)" },
          "401": { description: "Invalid credentials (enveloped response)" },
        },
      },
    },
    "/api/v1/auth/token": {
      servers,
      post: {
        tags: ["Gateway Auth"],
        summary: "Bootstrap consumer (admin)",
        description: "Create a consumer without credentials; requires X-Admin-Token.",
        security: [{ AdminBootstrap: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  scopes: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          ...tokenResponse,
          "400": { description: "Validation error (enveloped response)" },
          "401": { description: "Invalid admin token (enveloped response)" },
        },
      },
    },
    "/api/v1/auth/api-keys": {
      servers,
      post: {
        tags: ["Gateway Auth"],
        summary: "Issue API key for consumer (admin)",
        security: [{ AdminBootstrap: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["consumerId"],
                properties: {
                  consumerId: { type: "string", format: "uuid" },
                  scopes: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          ...tokenResponse,
          "400": { description: "Validation error (enveloped response)" },
          "401": { description: "Invalid admin token (enveloped response)" },
        },
      },
    },
  };
}

/** Merge upstream Magicroll OpenAPI with gateway auth and correct server URL for Try it out. */
export function buildGatewayOpenApiSpec(c: Context, env: Env): Record<string, unknown> {
  const raw = readFileSync(join(import.meta.dir, "../../../api-2.json"), "utf-8");
  const spec = JSON.parse(raw) as Record<string, unknown>;
  if (spec.openapi == null || String(spec.openapi).trim() === "") {
    spec.openapi = "3.0.3";
  }

  const origin = getRequestOrigin(c, env);
  spec.servers = [{ url: `${origin}/api/v1`, description: "Gateway (proxied upstream)" }];

  const info = spec.info as Record<string, unknown>;
  const gatewayNote =
    "\n\n---\n\n## Gateway\n\nUse **this gateway host** for all requests. Send your signed JWT as `Authorization: Bearer`. Get a token via `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, or admin `POST /api/v1/auth/token`. All gateway responses use `{status,message,data}`.";
  info.description = `${String(info.description ?? "")}${gatewayNote}`;

  const paths = { ...((spec.paths as Record<string, unknown>) ?? {}) };
  Object.assign(paths, gatewayAuthPaths(origin));
  spec.paths = paths;

  const components = { ...((spec.components as Record<string, unknown>) ?? {}) };
  const securitySchemes = {
    ...((components.securitySchemes as Record<string, unknown>) ?? {}),
    BearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Gateway-issued JWT access token. Not the upstream Magicroll token.",
    },
    AdminBootstrap: {
      type: "apiKey",
      in: "header",
      name: "X-Admin-Token",
      description: "Must match ADMIN_BOOTSTRAP_TOKEN on the gateway.",
    },
  };
  components.securitySchemes = securitySchemes;
  spec.components = components;

  const tags = Array.isArray(spec.tags) ? [...spec.tags] : [];
  tags.push({
    name: "Gateway Auth",
    description: "Register, login, and bootstrap gateway API keys",
  });
  spec.tags = tags;

  return spec;
}
