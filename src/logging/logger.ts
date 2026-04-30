export type LogLevel = "INFO" | "WARN" | "ERROR";

export type LogMeta = Record<string, unknown>;

function sanitizeMeta(meta: LogMeta): LogMeta {
  const out: LogMeta = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatMeta(meta: LogMeta): string {
  const entries = Object.entries(sanitizeMeta(meta));
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(" | ");
}

function inferModule(event: string): string {
  const parts = event.split(".");
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return parts[0] ?? "app";
}

const EVENT_MESSAGES: Record<string, string> = {
  "gateway.starting": "Gateway startup initiated",
  "gateway.migrations.applied": "Database migrations applied",
  "gateway.ready": "Gateway is ready to accept requests",
  "http.request.start": "Incoming request received",
  "http.request.end": "Request completed",
  "http.request.error": "Unhandled request error",
  "docs.openapi.serve": "Serving OpenAPI specification",
  "health.check": "Health check endpoint called",
  "auth.register.start": "Register request started",
  "auth.register.success": "User registration successful",
  "auth.register.invalid_json": "Register payload is not valid JSON",
  "auth.register.validation_failed": "Register request validation failed",
  "auth.register.conflict": "Register failed: email already exists",
  "auth.login.start": "Login request started",
  "auth.login.success": "User login successful",
  "auth.login.invalid_json": "Login payload is not valid JSON",
  "auth.login.validation_failed": "Login request validation failed",
  "auth.login.invalid_credentials": "Login failed: invalid credentials",
  "auth.admin_token.start": "Admin token issue request started",
  "auth.admin_token.success": "Admin token issued successfully",
  "auth.admin_token.unauthorized": "Admin token issue denied: invalid admin token",
  "auth.admin_token.invalid_json": "Admin token payload is not valid JSON",
  "auth.admin_token.validation_failed": "Admin token request validation failed",
  "auth.admin_api_key.start": "Admin API key issue request started",
  "auth.admin_api_key.success": "Admin API key issued successfully",
  "auth.admin_api_key.unauthorized": "Admin API key issue denied: invalid admin token",
  "auth.admin_api_key.invalid_json": "Admin API key payload is not valid JSON",
  "auth.admin_api_key.validation_failed": "Admin API key request validation failed",
  "auth.middleware.missing_bearer": "Authorization failed: missing Bearer token",
  "auth.middleware.empty_bearer": "Authorization failed: empty Bearer token",
  "auth.middleware.invalid_token": "Authorization failed: token is invalid or expired",
  "auth.middleware.invalid_path": "Authorization failed: API path is not allowed",
  "auth.middleware.insufficient_scope": "Authorization failed: insufficient scope",
  "auth.middleware.authorized": "Authorization successful",
  "admin.auth.failed": "Admin authentication failed",
  "admin.auth.passed": "Admin authentication successful",
  "admin.consumers.create.start": "Admin create-consumer request started",
  "admin.consumers.create.success": "Admin created consumer successfully",
  "admin.consumers.create.invalid_json": "Create-consumer payload is not valid JSON",
  "admin.consumers.create.validation_failed": "Create-consumer request validation failed",
  "admin.api_keys.create.start": "Admin create-api-key request started",
  "admin.api_keys.create.success": "Admin created API key successfully",
  "admin.api_keys.create.invalid_json": "Create-api-key payload is not valid JSON",
  "admin.api_keys.create.validation_failed": "Create-api-key request validation failed",
  "credits.insufficient_project": "Insufficient credits for POST /project/ request",
  "proxy.forward.start": "Forwarding request to upstream API",
  "proxy.forward.success": "Upstream API responded",
  "proxy.forward.failed": "Upstream API request failed",
};

function inferMessage(event: string): string {
  const mapped = EVENT_MESSAGES[event];
  if (mapped) return mapped;
  const tail = event.split(".").slice(2).join(".");
  if (!tail) return event;
  return tail.replaceAll("_", " ");
}

function write(level: LogLevel, event: string, meta: LogMeta = {}) {
  const ts = new Date().toISOString();
  const cleanMeta = sanitizeMeta(meta);
  const module = inferModule(event);
  const message = typeof cleanMeta.message === "string" ? cleanMeta.message : inferMessage(event);
  const endpoint =
    typeof cleanMeta.path === "string"
      ? cleanMeta.path
      : typeof cleanMeta.target === "string"
        ? cleanMeta.target
        : undefined;

  const extraMeta: LogMeta = { ...cleanMeta };
  delete extraMeta.message;
  const metaLine = formatMeta(extraMeta);
  const line =
    `${ts} [${level}] module=${module}` +
    `${endpoint ? ` | endpoint=${endpoint}` : ""}` +
    ` | message=${message}` +
    `${metaLine ? ` | ${metaLine}` : ""}`;
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
}

export function logInfo(event: string, meta?: LogMeta) {
  write("INFO", event, meta);
}

export function logWarn(event: string, meta?: LogMeta) {
  write("WARN", event, meta);
}

export function logError(event: string, meta?: LogMeta) {
  write("ERROR", event, meta);
}
