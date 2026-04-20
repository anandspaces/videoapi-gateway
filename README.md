# Magicroll API gateway

Bun + TypeScript reverse proxy: consumers authenticate with **gateway-issued** API keys; the gateway swaps `Authorization` for your Magicroll enterprise token and forwards to the upstream API.

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Default `file:./data/gateway.sqlite`. Use `postgresql://...` in production. |
| `API_KEY_PEPPER` | Secret mixed into SHA-256 of API keys (min 8 characters). |
| `UPSTREAM_BASE_URL` | Default `https://api.magicroll.ai/api/v1`. |
| `UPSTREAM_BEARER_TOKEN` | Enterprise Bearer token for Magicroll. |
| `ADMIN_BOOTSTRAP_TOKEN` | `X-Admin-Token` for admin and gated registration (min 16 characters). |
| `GATEWAY_PUBLIC_URL` | Optional. Public base URL (no trailing slash) for OpenAPI `servers` when behind a proxy. If unset, derived from request `Host` / `X-Forwarded-*`. |
| `ALLOW_PUBLIC_REGISTRATION` | `true` or `1` to allow `POST /auth/register` without `X-Admin-Token` (dev only; default off). |
| `AUTH_REVOKE_KEYS_ON_LOGIN` | `true` or `1` to revoke other active API keys for the consumer after a successful `POST /auth/login`. |
| `UPSTREAM_TIMEOUT_MS` | Optional. Default `120000`. |
| `PORT` | Optional. Default `3000`. |
| `CORS_ORIGINS` | Optional comma-separated list of allowed browser origins. |

## Commands

```bash
bun install
bun run db:migrate   # apply migrations (SQLite or Postgres from DATABASE_URL)
bun run dev          # watch mode
bun run start        # production-style
bun test
```

Schema changes: `bun run db:generate` (SQLite) and `bun run db:generate:pg` for PostgreSQL migration artifacts.

## Interactive docs (Swagger UI)

- **`GET /docs`** — Swagger UI for the merged spec (upstream Magicroll paths + gateway auth paths).
- **`GET /openapi.json`** — OpenAPI JSON; `servers` points at **this gateway** so **Try it out** hits `/api/v1/...` through the proxy.

Use **Authorize** with `BearerAuth` and paste your gateway API key (`gw_live_...`).

## Authentication flows

### Register / login (email + password)

- **`POST /auth/register`** — body `{ "name", "email", "password" (min 8 chars), "scopes"? }`. Returns `{ "token_type": "Bearer", "access_token", "consumer_id", ... }`.
  - With **`ALLOW_PUBLIC_REGISTRATION=false`** (default), send **`X-Admin-Token: <ADMIN_BOOTSTRAP_TOKEN>`** so operators can onboard accounts.
  - With **`ALLOW_PUBLIC_REGISTRATION=true`**, registration is open (local testing).
- **`POST /auth/login`** — body `{ "email", "password" }`. Issues a **new** API key (optionally revokes others if `AUTH_REVOKE_KEYS_ON_LOGIN=true`).

### Bootstrap (admin only)

- **`POST /auth/token`** — body `{ "name", "scopes"? }`. Header **`X-Admin-Token`**. Same as legacy admin create-consumer (no email/password).
- **`POST /auth/api-keys`** — body `{ "consumerId", "scopes"? }`. Header **`X-Admin-Token`**. Extra key for an existing consumer.

Legacy aliases (same headers): **`POST /internal/admin/consumers`** and **`POST /internal/admin/api-keys`**.

## Postman

1. Set **`{{baseUrl}}`** (e.g. `http://localhost:3000`).
2. **Register or login**: `POST {{baseUrl}}/auth/register` or `/auth/login` → copy **`access_token`** into collection variable **`gateway_token`**.
3. Set collection **Authorization → Bearer Token** = `{{gateway_token}}`.
4. Call proxied routes: `GET {{baseUrl}}/api/v1/enterprise/balance/` (and other paths from the spec).

## Consumer API

Same paths as upstream under **`https://<gateway>/api/v1/...`** with **`Authorization: Bearer <gateway api key>`**.
