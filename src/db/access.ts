import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashApiKey, randomApiKey, randomId } from "../crypto/hash.ts";
import {
  apiKeys as pgApiKeys,
  auditLogs as pgAuditLogs,
  backendProviders as pgBackendProviders,
  consumers as pgConsumers,
  creditTransactions as pgCreditTransactions,
  creditWallets as pgCreditWallets,
  features as pgFeatures,
  jobs as pgJobs,
  payments as pgPayments,
  plans as pgPlans,
  subscriptions as pgSubscriptions,
  usageSnapshots as pgUsageSnapshots,
  webhookDeliveries as pgWebhookDeliveries,
  webhookEndpoints as pgWebhookEndpoints,
} from "./schema.pg.ts";

const drizzleSchema = {
  consumers: pgConsumers,
  apiKeys: pgApiKeys,
  plans: pgPlans,
  subscriptions: pgSubscriptions,
  creditWallets: pgCreditWallets,
  creditTransactions: pgCreditTransactions,
  payments: pgPayments,
  features: pgFeatures,
  backendProviders: pgBackendProviders,
  jobs: pgJobs,
  webhookEndpoints: pgWebhookEndpoints,
  webhookDeliveries: pgWebhookDeliveries,
  usageSnapshots: pgUsageSnapshots,
  auditLogs: pgAuditLogs,
};

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

export type VideoGenDeductResult =
  | { ok: true; balanceAfter: number }
  | { ok: false; reason: "insufficient_credits"; balance: number };

const REGISTER_STARTING_CREDITS = 100;

function normalizeScopes(raw: unknown): string[] {
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function creditsFromMetadata(m: unknown): number {
  if (m !== null && typeof m === "object" && !Array.isArray(m) && "credits" in m) {
    const v = (m as { credits?: unknown }).credits;
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  }
  return 0;
}

function mergeCreditsIntoMetadata(existing: unknown, credits: number): Record<string, unknown> {
  const base =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  base.credits = credits;
  return base;
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
  /** Deduct credits for POST /project/ before proxying upstream. Uses wallet row + ledger. */
  tryDeductCreditsForVideoGenRequest: (
    consumerId: string,
    cost: number,
  ) => Promise<VideoGenDeductResult>;
  close: () => Promise<void>;
};

export function createDbAccess(databaseUrl: string, pepper: string): DbAccess {
  const sql = postgres(databaseUrl);
  const db = drizzlePg(sql, { schema: drizzleSchema });
  const apiKeys = pgApiKeys;
  const consumers = pgConsumers;

  return {
    async findApiKeyByHash(hash: string) {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.status, "active")))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.revokedAt) return null;
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
      return {
        id: row.id,
        consumerId: row.consumerId,
        scopes: normalizeScopes(row.scopes),
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
        scopes: input.scopes,
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
      const walletId = randomId();
      const { plaintext, prefix } = randomApiKey();
      const keyHash = await hashApiKey(plaintext, pepper);

      await db.transaction(async (tx) => {
        await tx.insert(consumers).values({
          id: consumerId,
          name: input.name,
          email: input.email,
          passwordHash: input.passwordHash,
          metadata: { credits: REGISTER_STARTING_CREDITS },
        });
        await tx.insert(pgCreditWallets).values({
          id: walletId,
          consumerId,
          balance: REGISTER_STARTING_CREDITS,
          lifetimeEarned: REGISTER_STARTING_CREDITS,
          lifetimeSpent: 0,
        });
        await tx.insert(pgCreditTransactions).values({
          id: randomId(),
          walletId,
          consumerId,
          type: "bonus",
          amount: REGISTER_STARTING_CREDITS,
          balanceAfter: REGISTER_STARTING_CREDITS,
          description: "Registration starter credits",
        });
        await tx.insert(apiKeys).values({
          id: keyId,
          consumerId,
          keyHash,
          prefix,
          scopes: input.scopes,
          revokedAt: null,
          expiresAt: null,
          rateLimitRpm: null,
        });
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

      await db.insert(apiKeys).values({
        id: keyId,
        consumerId: input.consumerId,
        keyHash,
        prefix,
        scopes: input.scopes,
        revokedAt: null,
        expiresAt: null,
        rateLimitRpm: null,
      });

      return { plaintext, prefix, keyId };
    },
    async revokeOtherApiKeys(consumerId: string, keepKeyId: string) {
      await db
        .update(apiKeys)
        .set({ revokedAt: new Date(), status: "revoked" })
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
        .where(
          and(
            eq(apiKeys.consumerId, consumerId),
            isNull(apiKeys.revokedAt),
            eq(apiKeys.status, "active"),
            or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
          ),
        )
        .orderBy(desc(apiKeys.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? normalizeScopes(row.scopes) : ["*"];
    },
    async tryDeductCreditsForVideoGenRequest(consumerId: string, cost: number) {
      if (cost <= 0) {
        const [wallet] = await db
          .select({ balance: pgCreditWallets.balance })
          .from(pgCreditWallets)
          .where(eq(pgCreditWallets.consumerId, consumerId))
          .limit(1);
        if (wallet) return { ok: true, balanceAfter: wallet.balance };
        const [c] = await db
          .select({ metadata: consumers.metadata })
          .from(consumers)
          .where(eq(consumers.id, consumerId))
          .limit(1);
        return { ok: true, balanceAfter: creditsFromMetadata(c?.metadata ?? null) };
      }

      const result = await db.transaction(async (tx) => {
        let walletRows = await tx
          .select()
          .from(pgCreditWallets)
          .where(eq(pgCreditWallets.consumerId, consumerId))
          .for("update")
          .limit(1);

        let wallet = walletRows[0];

        if (!wallet) {
          const [c] = await tx
            .select({ metadata: consumers.metadata })
            .from(consumers)
            .where(eq(consumers.id, consumerId))
            .limit(1);
          const starter = creditsFromMetadata(c?.metadata ?? null);
          await tx
            .insert(pgCreditWallets)
            .values({
              id: randomId(),
              consumerId,
              balance: starter,
              lifetimeEarned: starter,
              lifetimeSpent: 0,
            })
            .onConflictDoNothing({ target: pgCreditWallets.consumerId });

          walletRows = await tx
            .select()
            .from(pgCreditWallets)
            .where(eq(pgCreditWallets.consumerId, consumerId))
            .for("update")
            .limit(1);
          wallet = walletRows[0];
          if (!wallet) {
            return { tag: "error" as const };
          }
        }

        const bal = wallet.balance;
        if (bal < cost) {
          return { tag: "insufficient" as const, balance: bal };
        }

        const newBal = bal - cost;
        await tx
          .update(pgCreditWallets)
          .set({
            balance: newBal,
            lifetimeSpent: wallet.lifetimeSpent + cost,
            updatedAt: new Date(),
          })
          .where(eq(pgCreditWallets.id, wallet.id));

        await tx.insert(pgCreditTransactions).values({
          id: randomId(),
          walletId: wallet.id,
          consumerId,
          type: "credit_deduction",
          amount: -cost,
          balanceAfter: newBal,
          description: "Video generation — POST /project/",
          metadata: { route: "POST /project/" },
        });

        const [cons] = await tx
          .select({ metadata: consumers.metadata })
          .from(consumers)
          .where(eq(consumers.id, consumerId))
          .limit(1);

        await tx
          .update(consumers)
          .set({
            metadata: mergeCreditsIntoMetadata(cons?.metadata ?? null, newBal),
            updatedAt: new Date(),
          })
          .where(eq(consumers.id, consumerId));

        return { tag: "ok" as const, balanceAfter: newBal };
      });

      if (result.tag === "insufficient") {
        return { ok: false, reason: "insufficient_credits", balance: result.balance };
      }
      if (result.tag === "error") {
        return { ok: false, reason: "insufficient_credits", balance: 0 };
      }
      return { ok: true, balanceAfter: result.balanceAfter };
    },
    async close() {
      await sql.end();
    },
  };
}
