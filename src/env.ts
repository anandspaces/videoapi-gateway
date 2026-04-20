import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .optional()
    .transform((v) => v ?? "file:./data/gateway.sqlite"),
  API_KEY_PEPPER: z.string().min(8, "API_KEY_PEPPER must be at least 8 chars"),
  UPSTREAM_BASE_URL: z.string().url().default("https://api.magicroll.ai/api/v1"),
  UPSTREAM_BEARER_TOKEN: z.string().min(1),
  ADMIN_BOOTSTRAP_TOKEN: z.string().min(16),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),
  GATEWAY_PUBLIC_URL: z
    .string()
    .url()
    .optional()
    .transform((v) => (v ? v.replace(/\/$/, "") : undefined)),
  ALLOW_PUBLIC_REGISTRATION: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  AUTH_REVOKE_KEYS_ON_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return parsed.data;
}

export function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}
