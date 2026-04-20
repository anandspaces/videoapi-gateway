import { Database } from "bun:sqlite";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashApiKey, randomApiKey, randomId } from "../crypto/hash.ts";
import { isPostgresUrl } from "../env.ts";
import { apiKeys as pgApiKeys, consumers as pgConsumers } from "./schema.pg.ts";
import { apiKeys as sqliteApiKeys, consumers as sqliteConsumers } from "./schema.sqlite.ts";

export type ApiKeyRow = {
  id: string;
  consumerId: string;
  scopes: string[];
  rateLimitRpm: number | null;
};

export type IssueKeyResult = {
  consumerId: string;
  plaintext: string;
  prefix: string;
  keyId: string;
  scopes: string[];
};

export type ConsumerRow = {
  id: string;
  email: string | null;
  passwordHash: string | null;
};

function parseScopesJson(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : [];
  } catch {
    return [];
  }
}

export type DbAccess = {
  findApiKeyByHash: (hash: string) => Promise<ApiKeyRow | null>;
  findConsumerByEmail: (email: string) => Promise<ConsumerRow | null>;
  createConsumerWithKey: (input: { name: string; scopes: string[] }) => Promise<IssueKeyResult>;
  registerConsumerWithPassword: (input: {
    name: string;
    email: string;
    passwordHash: string;
    scopes: string[];
  }) => Promise<IssueKeyResult>;
  createApiKeyForConsumer: (input: {
    consumerId: string;
    scopes: string[];
  }) => Promise<{ plaintext: string; prefix: string; keyId: string }>;
  revokeOtherApiKeys: (consumerId: string, keepKeyId: string) => Promise<void>;
  /** Scopes from the newest active key, or `["*"]` if none. */
  getLatestActiveKeyScopes: (consumerId: string) => Promise<string[]>;
  close: () => Promise<void>;
};

export function createDbAccess(databaseUrl: string, pepper: string): DbAccess {
  if (isPostgresUrl(databaseUrl)) {
    const sql = postgres(databaseUrl);
    const db = drizzlePg(sql, { schema: { consumers: pgConsumers, apiKeys: pgApiKeys } });
    const apiKeys = pgApiKeys;
    const consumers = pgConsumers;

    return {
      async findApiKeyByHash(hash: string) {
        const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
        const row = rows[0];
        if (!row) return null;
        if (row.revokedAt) return null;
        if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
        return {
          id: row.id,
          consumerId: row.consumerId,
          scopes: parseScopesJson(row.scopes),
          rateLimitRpm: row.rateLimitRpm,
        };
      },
      async findConsumerByEmail(email: string) {
        const rows = await db.select().from(consumers).where(eq(consumers.email, email)).limit(1);
        const row = rows[0];
        if (!row) return null;
        return { id: row.id, email: row.email, passwordHash: row.passwordHash };
      },
      async createConsumerWithKey(input) {
        const consumerId = randomId();
        const keyId = randomId();
        const { plaintext, prefix } = randomApiKey();
        const keyHash = await hashApiKey(plaintext, pepper);
        const scopesJson = JSON.stringify(input.scopes);

        await db.insert(consumers).values({
          id: consumerId,
          name: input.name,
          email: null,
          passwordHash: null,
          metadata: null,
        });
        await db.insert(apiKeys).values({
          id: keyId,
          consumerId,
          keyHash,
          prefix,
          scopes: scopesJson,
          revokedAt: null,
          expiresAt: null,
          rateLimitRpm: null,
        });

        return {
          consumerId,
          plaintext,
          prefix,
          keyId,
          scopes: input.scopes,
        };
      },
      async registerConsumerWithPassword(input) {
        const consumerId = randomId();
        const keyId = randomId();
        const { plaintext, prefix } = randomApiKey();
        const keyHash = await hashApiKey(plaintext, pepper);
        const scopesJson = JSON.stringify(input.scopes);

        await db.insert(consumers).values({
          id: consumerId,
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          metadata: null,
        });
        await db.insert(apiKeys).values({
          id: keyId,
          consumerId,
          keyHash,
          prefix,
          scopes: scopesJson,
          revokedAt: null,
          expiresAt: null,
          rateLimitRpm: null,
        });

        return {
          consumerId,
          plaintext,
          prefix,
          keyId,
          scopes: input.scopes,
        };
      },
      async createApiKeyForConsumer(input) {
        const keyId = randomId();
        const { plaintext, prefix } = randomApiKey();
        const keyHash = await hashApiKey(plaintext, pepper);
        const scopesJson = JSON.stringify(input.scopes);

        await db.insert(apiKeys).values({
          id: keyId,
          consumerId: input.consumerId,
          keyHash,
          prefix,
          scopes: scopesJson,
          revokedAt: null,
          expiresAt: null,
          rateLimitRpm: null,
        });

        return { plaintext, prefix, keyId };
      },
      async revokeOtherApiKeys(consumerId: string, keepKeyId: string) {
        await db
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(apiKeys.consumerId, consumerId),
              ne(apiKeys.id, keepKeyId),
              isNull(apiKeys.revokedAt),
            ),
          );
      },
      async getLatestActiveKeyScopes(consumerId: string) {
        const rows = await db
          .select()
          .from(apiKeys)
          .where(and(eq(apiKeys.consumerId, consumerId), isNull(apiKeys.revokedAt)))
          .orderBy(desc(apiKeys.createdAt))
          .limit(1);
        const row = rows[0];
        return row ? parseScopesJson(row.scopes) : ["*"];
      },
      async close() {
        await sql.end();
      },
    };
  }

  const filePath = databaseUrl.replace(/^file:/, "");
  const raw = new Database(filePath);
  const db = drizzleSqlite(raw, {
    schema: { consumers: sqliteConsumers, apiKeys: sqliteApiKeys },
  });
  const apiKeys = sqliteApiKeys;
  const consumers = sqliteConsumers;

  return {
    async findApiKeyByHash(hash: string) {
      const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.revokedAt) return null;
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
      return {
        id: row.id,
        consumerId: row.consumerId,
        scopes: parseScopesJson(row.scopes),
        rateLimitRpm: row.rateLimitRpm,
      };
    },
    async findConsumerByEmail(email: string) {
      const rows = await db.select().from(consumers).where(eq(consumers.email, email)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, email: row.email, passwordHash: row.passwordHash };
    },
    async createConsumerWithKey(input) {
      const consumerId = randomId();
      const keyId = randomId();
      const { plaintext, prefix } = randomApiKey();
      const keyHash = await hashApiKey(plaintext, pepper);
      const scopesJson = JSON.stringify(input.scopes);

      await db.insert(consumers).values({
        id: consumerId,
        name: input.name,
        email: null,
        passwordHash: null,
        metadata: null,
      });
      await db.insert(apiKeys).values({
        id: keyId,
        consumerId,
        keyHash,
        prefix,
        scopes: scopesJson,
        revokedAt: null,
        expiresAt: null,
        rateLimitRpm: null,
      });

      return {
        consumerId,
        plaintext,
        prefix,
        keyId,
        scopes: input.scopes,
      };
    },
    async registerConsumerWithPassword(input) {
      const consumerId = randomId();
      const keyId = randomId();
      const { plaintext, prefix } = randomApiKey();
      const keyHash = await hashApiKey(plaintext, pepper);
      const scopesJson = JSON.stringify(input.scopes);

      await db.insert(consumers).values({
        id: consumerId,
        name: input.name,
        email: input.email,
        passwordHash: input.passwordHash,
        metadata: null,
      });
      await db.insert(apiKeys).values({
        id: keyId,
        consumerId,
        keyHash,
        prefix,
        scopes: scopesJson,
        revokedAt: null,
        expiresAt: null,
        rateLimitRpm: null,
      });

      return {
        consumerId,
        plaintext,
        prefix,
        keyId,
        scopes: input.scopes,
      };
    },
    async createApiKeyForConsumer(input) {
      const keyId = randomId();
      const { plaintext, prefix } = randomApiKey();
      const keyHash = await hashApiKey(plaintext, pepper);
      const scopesJson = JSON.stringify(input.scopes);

      await db.insert(apiKeys).values({
        id: keyId,
        consumerId: input.consumerId,
        keyHash,
        prefix,
        scopes: scopesJson,
        revokedAt: null,
        expiresAt: null,
        rateLimitRpm: null,
      });

      return { plaintext, prefix, keyId };
    },
    async revokeOtherApiKeys(consumerId: string, keepKeyId: string) {
      await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.consumerId, consumerId),
            ne(apiKeys.id, keepKeyId),
            isNull(apiKeys.revokedAt),
          ),
        );
    },
    async getLatestActiveKeyScopes(consumerId: string) {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.consumerId, consumerId), isNull(apiKeys.revokedAt)))
        .orderBy(desc(apiKeys.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? parseScopesJson(row.scopes) : ["*"];
    },
    async close() {
      raw.close();
    },
  };
}
