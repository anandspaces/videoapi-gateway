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
  const tokenResponse = {
    "201": {
      description: "Issued",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              token_type: { type: "string", example: "Bearer" },
              access_token: { type: "string" },
              consumer_id: { type: "string", format: "uuid" },
              key_id: { type: "string", format: "uuid" },
              prefix: { type: "string" },
              scopes: { type: "array", items: { type: "string" } },
              issued_at: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
  };

  return {
    "/auth/register": {
      servers,
      post: {
        tags: ["Gateway Auth"],
        summary: "Register",
        description:
          "Create an account with email and password and receive a gateway API key. When ALLOW_PUBLIC_REGISTRATION is false, requires X-Admin-Token.",
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
                  scopes: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          ...tokenResponse,
          "400": { description: "Validation error" },
          "403": { description: "Public registration disabled and no admin token" },
          "409": { description: "Email already registered" },
        },
      },
    },
    "/auth/login": {
      servers,
      post: {
        tags: ["Gateway Auth"],
        summary: "Login",
        description:
          "Verify email and password and issue a new gateway API key (optionally revoking other keys).",
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
          "400": { description: "Validation error" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/token": {
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
          "400": { description: "Validation error" },
          "401": { description: "Invalid admin token" },
        },
      },
    },
    "/auth/api-keys": {
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
          "400": { description: "Validation error" },
          "401": { description: "Invalid admin token" },
        },
      },
    },
  };
}

/** Merge upstream Magicroll OpenAPI with gateway auth and correct server URL for Try it out. */
export function buildGatewayOpenApiSpec(c: Context, env: Env): Record<string, unknown> {
  const raw = readFileSync(join(import.meta.dir, "../../../api-1.json"), "utf-8");
  const spec = JSON.parse(raw) as Record<string, unknown>;
  if (spec.openapi == null || String(spec.openapi).trim() === "") {
    spec.openapi = "3.0.3";
  }

  const origin = getRequestOrigin(c, env);
  spec.servers = [{ url: `${origin}/api/v1`, description: "Gateway (proxied upstream)" }];

  const info = spec.info as Record<string, unknown>;
  const gatewayNote =
    "\n\n---\n\n## Gateway\n\nUse **this gateway host** for all requests. Send your **gateway-issued** API key (`gw_live_...`) as `Authorization: Bearer`. Get a key via `POST /auth/register`, `POST /auth/login`, or admin `POST /auth/token`. The Magicroll enterprise token is configured only on the server.";
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
      bearerFormat: "Gateway API Key",
      description: "Gateway-issued key (gw_live_...). Not the upstream Magicroll token.",
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
