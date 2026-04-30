# Magicroll API gateway

Bun + TypeScript reverse proxy: consumers authenticate with **gateway-issued JWT bearer tokens**; the gateway swaps `Authorization` for your Magicroll enterprise token and forwards to the upstream API.

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string. Default `postgresql://postgres:root@localhost:5432/dt_videoapi_db`. |
| `API_KEY_PEPPER` | Secret mixed into SHA-256 of API keys (min 8 characters). |
| `UPSTREAM_BASE_URL` | Default `https://api.magicroll.ai/api/v1`. |
| `UPSTREAM_BEARER_TOKEN` | Enterprise Bearer token for Magicroll. |
| `ADMIN_BOOTSTRAP_TOKEN` | `X-Admin-Token` for admin routes (min 16 characters). |
| `JWT_SECRET` | Secret used to sign JWT access tokens (min 32 characters). |
| `JWT_EXPIRES_IN_HOURS` | Access token expiry in hours (positive integer). |
| `GATEWAY_PUBLIC_URL` | Optional. Public base URL (no trailing slash) for OpenAPI `servers` when behind a proxy. If unset, derived from request `Host` / `X-Forwarded-*`. |
| `AUTH_REVOKE_KEYS_ON_LOGIN` | `true` or `1` to revoke other active API keys for the consumer after a successful `POST /auth/login`. |
| `UPSTREAM_TIMEOUT_MS` | Optional. Default `120000`. |
| `PORT` | Optional. Default `3000`. |
| `CORS_ORIGINS` | Optional comma-separated list of allowed browser origins. |
| `PROJECT_CREATE_CREDIT_COST` | Credits deducted on each `POST /api/v1/project/` (video create). Default `1`. |

## Commands

```bash
bun install
bun run db:migrate   # apply PostgreSQL migrations from DATABASE_URL
bun run dev          # watch mode
bun run start        # production-style
bun test
```

Schema changes: `bun run db:generate` for PostgreSQL migration artifacts.

## Interactive docs (Swagger UI)

- **`GET /api/v1/docs`** — Swagger UI generated from this gateway backend routes.
- **`GET /api/v1/openapi.json`** — OpenAPI JSON generated in-process by the gateway (no external `api-2.json` dependency).

Use **Authorize** with `BearerAuth` and paste your JWT access token.

## Authentication flows

### Register / login (email + password)

- **`POST /api/v1/auth/register`** — body `{ "name", "email", "password" (min 8 chars) }`. Returns a JWT bearer token in the common envelope `{ "status", "message", "data" }`.
  - This route is open (no admin token required).
  - New users are automatically initialized with `100` starter credits in user metadata.
- **`POST /api/v1/auth/login`** — body `{ "email", "password" }`. Issues a **new** JWT token (optionally revokes others if `AUTH_REVOKE_KEYS_ON_LOGIN=true`).

### Bootstrap (admin only)

- **`POST /api/v1/auth/token`** — body `{ "name", "scopes"? }`. Header **`X-Admin-Token`**. Same as legacy admin create-consumer (no email/password).
- **`POST /api/v1/auth/api-keys`** — body `{ "consumerId", "scopes"? }`. Header **`X-Admin-Token`**. Extra key for an existing consumer.

Legacy aliases (same headers): **`POST /api/v1/internal/admin/consumers`** and **`POST /api/v1/internal/admin/api-keys`**.

## Postman

1. Set **`{{baseUrl}}`** (e.g. `http://localhost:3000`).
2. **Register or login**: `POST {{baseUrl}}/api/v1/auth/register` or `/api/v1/auth/login` → copy **`access_token`** into collection variable **`gateway_token`**.
3. Set collection **Authorization → Bearer Token** = `{{gateway_token}}` (JWT).
4. Call proxied routes: `GET {{baseUrl}}/api/v1/enterprise/balance/` (and other paths from the spec).

## Consumer API

Same paths as upstream under **`https://<gateway>/api/v1/...`** with **`Authorization: Bearer <gateway jwt>`**.
