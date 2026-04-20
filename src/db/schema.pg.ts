import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const consumers = pgTable(
  "consumers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    metadata: text("metadata"),
  },
  (t) => [uniqueIndex("consumers_email_unique").on(t.email)],
);

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  consumerId: text("consumer_id")
    .notNull()
    .references(() => consumers.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  scopes: text("scopes").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  rateLimitRpm: integer("rate_limit_rpm"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const pgSchema = { consumers, apiKeys };
