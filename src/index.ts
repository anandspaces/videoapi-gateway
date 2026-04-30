import { createDbAccess } from "./db/access.ts";
import { applyMigrations } from "./db/migrate.ts";
import { loadEnv } from "./env.ts";
import { buildGatewayApp } from "./gatewayApp.ts";
import { logInfo } from "./logging/logger.ts";

const env = loadEnv();
logInfo("gateway.starting", { port: env.PORT, databaseUrl: env.DATABASE_URL });
await applyMigrations(env.DATABASE_URL);
logInfo("gateway.migrations.applied");
const dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
const app = buildGatewayApp({ env, dbAccess });

logInfo("gateway.ready", { url: `http://127.0.0.1:${env.PORT}` });

export default {
  port: env.PORT,
  fetch: app.fetch,
};
