import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const consumers = sqliteTable(
  "consumers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    metadata: text("metadata"),
  },
  (t) => [uniqueIndex("consumers_email_unique").on(t.email)],
);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  consumerId: text("consumer_id")
    .notNull()
    .references(() => consumers.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  scopes: text("scopes").notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  rateLimitRpm: integer("rate_limit_rpm"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sqliteSchema = { consumers, apiKeys };
