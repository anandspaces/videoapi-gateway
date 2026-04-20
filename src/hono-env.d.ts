import type { ApiKeyRow, DbAccess } from "./db/access.ts";
import type { Env } from "./env.ts";

declare module "hono" {
  interface ContextVariableMap {
    env: Env;
    dbAccess: DbAccess;
    apiKey: ApiKeyRow;
  }
}
