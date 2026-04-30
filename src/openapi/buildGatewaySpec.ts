import type { Context } from "hono";
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

function envelopeSchema(dataSchema: Record<string, unknown>) {
  return {
    type: "object",
    properties: {
      status: { type: "integer", enum: [-1, 0, 1, 2, 3] },
      message: { type: "string" },
      data: dataSchema,
    },
  };
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

function healthPaths(origin: string): Record<string, unknown> {
  const servers = [{ url: origin, description: "Gateway" }];
  return {
    "/api/v1/health": {
      servers,
      get: {
        tags: ["Health"],
        summary: "Gateway health check",
        security: [],
        responses: {
          "200": {
            description: "Healthy",
            content: {
              "application/json": {
                schema: envelopeSchema({
                  type: "object",
                  properties: { status: { type: "string", enum: ["ok"] } },
                }),
              },
            },
          },
        },
      },
    },
  };
}

function adminPaths(origin: string): Record<string, unknown> {
  const servers = [{ url: origin, description: "Gateway" }];
  return {
    "/api/v1/internal/admin/consumers": {
      servers,
      post: {
        tags: ["Admin"],
        summary: "Create consumer and first API key",
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
          "201": {
            description: "Consumer created",
            content: {
              "application/json": {
                schema: envelopeSchema({
                  type: "object",
                  properties: {
                    consumerId: { type: "string", format: "uuid" },
                    keyId: { type: "string", format: "uuid" },
                    apiKey: { type: "string" },
                    prefix: { type: "string" },
                    scopes: { type: "array", items: { type: "string" } },
                    warning: { type: "string" },
                  },
                }),
              },
            },
          },
          "400": { description: "Validation error (enveloped response)" },
          "401": { description: "Invalid admin token (enveloped response)" },
        },
      },
    },
    "/api/v1/internal/admin/api-keys": {
      servers,
      post: {
        tags: ["Admin"],
        summary: "Create API key for existing consumer",
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
          "201": {
            description: "API key created",
            content: {
              "application/json": {
                schema: envelopeSchema({
                  type: "object",
                  properties: {
                    consumerId: { type: "string", format: "uuid" },
                    keyId: { type: "string", format: "uuid" },
                    apiKey: { type: "string" },
                    prefix: { type: "string" },
                    scopes: { type: "array", items: { type: "string" } },
                    warning: { type: "string" },
                  },
                }),
              },
            },
          },
          "400": { description: "Validation error (enveloped response)" },
          "401": { description: "Invalid admin token (enveloped response)" },
        },
      },
    },
  };
}

function proxyPaths(origin: string): Record<string, unknown> {
  const servers = [{ url: origin, description: "Gateway" }];
  const proxyOperationBase = {
    tags: ["Proxy"],
    summary: "Proxy request to upstream via gateway",
    description:
      "Forwards the request to configured upstream API after gateway auth + rate limit checks. Response is wrapped in the gateway envelope format.",
    security: [{ BearerAuth: [] }],
    parameters: [
      {
        name: "proxyPath",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "Upstream path portion after /api/v1/",
      },
    ],
    responses: {
      "200": { description: "Gateway-enveloped upstream response" },
      "401": { description: "Unauthorized (missing/invalid bearer token)" },
      "429": { description: "Rate limited" },
      "502": { description: "Bad gateway / upstream timeout or failure" },
    },
  };
  const writeRequestBody = {
    required: false,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: true,
          description: "Arbitrary JSON payload forwarded upstream.",
        },
        examples: {
          generic: {
            summary: "Generic JSON",
            value: { prompt: "Generate a short demo video", duration: 6 },
          },
        },
      },
      "application/x-www-form-urlencoded": {
        schema: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      "multipart/form-data": {
        schema: {
          type: "object",
          additionalProperties: true,
          description: "Form-data body (including file uploads) proxied as-is.",
        },
      },
      "text/plain": {
        schema: { type: "string" },
      },
    },
  };
  return {
    "/api/v1/{proxyPath}": {
      servers,
      get: {
        ...proxyOperationBase,
        description:
          "Proxy GET request to upstream. Use query params and path variables inside `proxyPath`.",
      },
      post: {
        ...proxyOperationBase,
        description: "Proxy POST request to upstream with body forwarded as-is.",
        requestBody: writeRequestBody,
      },
      put: {
        ...proxyOperationBase,
        description: "Proxy PUT request to upstream with body forwarded as-is.",
        requestBody: writeRequestBody,
      },
      patch: {
        ...proxyOperationBase,
        description: "Proxy PATCH request to upstream with body forwarded as-is.",
        requestBody: writeRequestBody,
      },
      delete: {
        ...proxyOperationBase,
        description: "Proxy DELETE request to upstream. Optional body is forwarded as-is.",
        requestBody: writeRequestBody,
      },
      head: {
        ...proxyOperationBase,
        description: "Proxy HEAD request to upstream.",
      },
      options: {
        ...proxyOperationBase,
        description: "Proxy OPTIONS request to upstream.",
      },
    },
  };
}

/** Build OpenAPI spec strictly from gateway backend routes (no external spec merge). */
export function buildGatewayOpenApiSpec(c: Context, env: Env): Record<string, unknown> {
  const origin = getRequestOrigin(c, env);
  const spec: Record<string, unknown> = {
    openapi: "3.0.3",
    info: {
      title: "Gateway API",
      version: "1.0.0",
      description:
        "OpenAPI generated from this gateway backend routes only. All responses use `{status,message,data}` envelope.",
    },
    servers: [{ url: `${origin}/api/v1`, description: "Gateway API base" }],
    paths: {
      ...healthPaths(origin),
      ...gatewayAuthPaths(origin),
      ...adminPaths(origin),
      ...proxyPaths(origin),
    },
    tags: [
      { name: "Health", description: "Gateway health endpoints" },
      { name: "Gateway Auth", description: "Register, login, and bootstrap gateway API keys" },
      { name: "Admin", description: "Admin endpoints under /internal/admin/*" },
      { name: "Proxy", description: "Authenticated proxy to upstream under /api/v1/*" },
    ],
  };

  const components: Record<string, unknown> = {};
  const securitySchemes = {
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

  return spec;
}
