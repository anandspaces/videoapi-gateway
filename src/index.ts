import { createDbAccess } from "./db/access.ts";
import { applyMigrations } from "./db/migrate.ts";
import { loadEnv } from "./env.ts";
import { buildGatewayApp } from "./gatewayApp.ts";

const env = loadEnv();
await applyMigrations(env.DATABASE_URL);
const dbAccess = createDbAccess(env.DATABASE_URL, env.API_KEY_PEPPER);
const app = buildGatewayApp({ env, dbAccess });

console.log(`Gateway listening on http://127.0.0.1:${env.PORT}`);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
