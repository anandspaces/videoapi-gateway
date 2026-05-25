import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const featureTypeEnum = pgEnum("feature_type", [
  "text2vid",
  "vid2vid",
  "text2avatar",
  "img2vid",
  "vid2audio",
  "custom",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "credit_purchase",
  "credit_deduction",
  "refund",
  "bonus",
  "adjustment",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);

export const paymentProviderEnum = pgEnum("payment_provider", [
  "stripe",
  "razorpay",
  "paypal",
  "manual",
]);

export const webhookEventStatusEnum = pgEnum("webhook_event_status", [
  "pending",
  "delivered",
  "failed",
  "retrying",
]);

export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "revoked", "expired"]);

// Outcome of a single proxied request to the upstream video-generation server.
export const requestOutcomeEnum = pgEnum("request_outcome", [
  "success", // upstream responded with a 2xx
  "upstream_error", // upstream responded with a 4xx/5xx
  "timeout", // upstream did not respond within UPSTREAM_TIMEOUT_MS
  "gateway_error", // connection/transport failure reaching upstream
  "blocked", // rejected at the gateway before reaching upstream (e.g. insufficient credits)
]);

// ─────────────────────────────────────────────
// CONSUMERS (Users / Tenants)
// ─────────────────────────────────────────────

export const consumers = pgTable(
  "consumers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),

    // Contact & identity
    phone: text("phone"),
    company: text("company"),
    avatarUrl: text("avatar_url"),
    timezone: text("timezone").default("UTC"),

    // Account state
    isActive: boolean("is_active").notNull().default(true),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),

    // Soft-delete
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),

    // Arbitrary extensible metadata (plan overrides, feature flags, etc.)
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("consumers_email_unique").on(t.email)],
);

// ─────────────────────────────────────────────
// API KEYS
// ─────────────────────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),

    name: text("name").notNull().default("Default Key"),
    keyHash: text("key_hash").notNull().unique(),
    prefix: text("prefix").notNull(), // e.g. first chars of gw_live_…
    status: apiKeyStatusEnum("status").notNull().default("active"),

    // Scope is a JSON array of feature slugs e.g. ["text2vid","vid2vid"]
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),

    // Per-key rate limits override consumer plan limits when set
    rateLimitRpm: integer("rate_limit_rpm"),
    rateLimitRpd: integer("rate_limit_rpd"),

    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_consumer_idx").on(t.consumerId)],
);

// ─────────────────────────────────────────────
// PLANS (Subscription tiers)
// ─────────────────────────────────────────────

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),

  includedCredits: real("included_credits").notNull().default(0),
  creditCap: real("credit_cap"),

  rateLimitRpm: integer("rate_limit_rpm").notNull().default(60),
  rateLimitRpd: integer("rate_limit_rpd").notNull().default(1000),

  allowedFeatures: jsonb("allowed_features").$type<string[] | null>(),

  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),

  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),

  metadata: jsonb("metadata"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),

    status: text("status").notNull().default("active"),

    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),

    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "date" }),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_consumer_idx").on(t.consumerId),
    index("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
  ],
);

// ─────────────────────────────────────────────
// CREDIT WALLETS
// ─────────────────────────────────────────────

export const creditWallets = pgTable("credit_wallets", {
  id: text("id").primaryKey(),
  consumerId: text("consumer_id")
    .notNull()
    .unique()
    .references(() => consumers.id, { onDelete: "cascade" }),

  balance: real("balance").notNull().default(0),
  lifetimeEarned: real("lifetime_earned").notNull().default(0),
  lifetimeSpent: real("lifetime_spent").notNull().default(0),

  creditCap: real("credit_cap"),

  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// CREDIT TRANSACTIONS (immutable ledger)
// ─────────────────────────────────────────────

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => creditWallets.id, { onDelete: "restrict" }),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "restrict" }),

    type: transactionTypeEnum("type").notNull(),
    amount: real("amount").notNull(),
    balanceAfter: real("balance_after").notNull(),

    description: text("description"),

    jobId: text("job_id"),
    paymentId: text("payment_id"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_txn_wallet_idx").on(t.walletId),
    index("credit_txn_consumer_idx").on(t.consumerId),
    index("credit_txn_job_idx").on(t.jobId),
  ],
);

// ─────────────────────────────────────────────
// PAYMENT RECORDS
// ─────────────────────────────────────────────

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "restrict" }),

    provider: paymentProviderEnum("provider").notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),

    providerPaymentId: text("provider_payment_id").unique(),
    providerOrderId: text("provider_order_id"),
    providerCustomerId: text("provider_customer_id"),

    amountMinorUnits: integer("amount_minor_units").notNull(),
    currency: text("currency").notNull().default("USD"),

    creditsToAward: real("credits_to_award").notNull(),

    subscriptionId: text("subscription_id").references(() => subscriptions.id),

    refundedAmountMinorUnits: integer("refunded_amount_minor_units").notNull().default(0),

    receiptUrl: text("receipt_url"),
    metadata: jsonb("metadata"),

    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_consumer_idx").on(t.consumerId),
    index("payments_provider_payment_idx").on(t.providerPaymentId),
  ],
);

// ─────────────────────────────────────────────
// FEATURES (per-feature pricing catalogue)
// ─────────────────────────────────────────────

export const features = pgTable("features", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  type: featureTypeEnum("type").notNull(),
  name: text("name").notNull(),
  description: text("description"),

  creditCostPerUnit: real("credit_cost_per_unit").notNull(),

  unitLabel: text("unit_label").notNull().default("per_request"),

  isActive: boolean("is_active").notNull().default(true),

  constraints: jsonb("constraints"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// BACKEND PROVIDERS (video gen backends to route to)
// ─────────────────────────────────────────────

export const backendProviders = pgTable("backend_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  baseUrl: text("base_url").notNull(),

  supportedFeatures: jsonb("supported_features").$type<string[]>().notNull().default([]),

  authConfig: jsonb("auth_config"),

  weight: integer("weight").notNull().default(100),

  isActive: boolean("is_active").notNull().default(true),
  healthCheckUrl: text("health_check_url"),
  lastHealthyAt: timestamp("last_healthy_at", { withTimezone: true, mode: "date" }),

  metadata: jsonb("metadata"),

  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// JOBS (every generation request)
// ─────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "restrict" }),
    apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id),
    backendProviderId: text("backend_provider_id").references(() => backendProviders.id, {
      onDelete: "set null",
    }),

    status: jobStatusEnum("status").notNull().default("queued"),

    requestPayload: jsonb("request_payload"),

    providerJobId: text("provider_job_id"),

    outputUrl: text("output_url"),
    outputMetadata: jsonb("output_metadata"),

    estimatedCredits: real("estimated_credits"),
    actualCreditsCharged: real("actual_credits_charged"),

    queuedDurationMs: integer("queued_duration_ms"),
    processingDurationMs: integer("processing_duration_ms"),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),

    webhookDelivered: boolean("webhook_delivered").notNull().default(false),

    metadata: jsonb("metadata"),

    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_consumer_idx").on(t.consumerId),
    index("jobs_status_idx").on(t.status),
    index("jobs_provider_job_idx").on(t.providerJobId),
    index("jobs_created_at_idx").on(t.createdAt),
    index("jobs_feature_idx").on(t.featureId),
  ],
);

// ─────────────────────────────────────────────
// WEBHOOK ENDPOINTS (consumer-registered)
// ─────────────────────────────────────────────

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),

    url: text("url").notNull(),
    secret: text("secret").notNull(),
    description: text("description"),

    events: jsonb("events").$type<string[]>().notNull().default([]),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_consumer_idx").on(t.consumerId)],
);

// ─────────────────────────────────────────────
// WEBHOOK DELIVERIES (audit log)
// ─────────────────────────────────────────────

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),

    event: text("event").notNull(),
    status: webhookEventStatusEnum("status").notNull().default("pending"),

    requestPayload: jsonb("request_payload"),
    responseStatusCode: integer("response_status_code"),
    responseBody: text("response_body"),

    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    index("webhook_deliveries_job_idx").on(t.jobId),
    index("webhook_deliveries_status_idx").on(t.status),
  ],
);

// ─────────────────────────────────────────────
// USAGE SNAPSHOTS (daily rollup for analytics)
// ─────────────────────────────────────────────

export const usageSnapshots = pgTable(
  "usage_snapshots",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id")
      .notNull()
      .references(() => consumers.id, { onDelete: "cascade" }),
    featureId: text("feature_id").references(() => features.id, { onDelete: "set null" }),

    date: text("date").notNull(),

    totalRequests: integer("total_requests").notNull().default(0),
    successfulRequests: integer("successful_requests").notNull().default(0),
    failedRequests: integer("failed_requests").notNull().default(0),
    creditsConsumed: real("credits_consumed").notNull().default(0),
    totalProcessingMs: integer("total_processing_ms").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("usage_snapshot_unique").on(t.consumerId, t.featureId, t.date),
    index("usage_snapshot_consumer_idx").on(t.consumerId),
    index("usage_snapshot_date_idx").on(t.date),
  ],
);

// ─────────────────────────────────────────────
// AUDIT LOGS
// ─────────────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    consumerId: text("consumer_id").references(() => consumers.id, { onDelete: "set null" }),

    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    country: text("country"),

    diff: jsonb("diff"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_consumer_idx").on(t.consumerId),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ],
);

// ─────────────────────────────────────────────
// API REQUEST LOGS (per-request proxy access log)
// ─────────────────────────────────────────────
//
// One row per request that the gateway forwards (or attempts to forward) to the
// upstream video-generation server. This is the raw access log: which endpoint
// was hit, the resulting status code, and how long the upstream took to respond.

export const apiRequestLogs = pgTable(
  "api_request_logs",
  {
    id: text("id").primaryKey(),

    // Correlation id shared with the structured application logs for one request.
    requestId: text("request_id").notNull(),

    // Caller identity (nullable: unauthenticated paths leave them empty).
    // Intentionally NOT foreign keys: this is an append-only audit log that must
    // record history independent of entity lifecycle. A hard FK would also make
    // the fire-and-forget insert fail when the key/consumer is deleted in the
    // window between request authorization and the async log write.
    consumerId: text("consumer_id"),
    apiKeyId: text("api_key_id"),

    // What got hit.
    method: text("method").notNull(),
    path: text("path").notNull(), // gateway-normalized path, e.g. /api/v1/project/
    upstreamUrl: text("upstream_url"), // full target URL on the video server (null if blocked before forwarding)

    // Result.
    outcome: requestOutcomeEnum("outcome").notNull(),
    success: boolean("success").notNull().default(false), // true when upstream returned 2xx
    statusCode: integer("status_code").notNull(), // status the gateway returned to the client
    upstreamStatusCode: integer("upstream_status_code"), // raw upstream status (null on timeout/transport error/blocked)

    // Latency.
    durationMs: integer("duration_ms").notNull(), // total gateway handling time
    upstreamDurationMs: integer("upstream_duration_ms"), // upstream round-trip only (the "time to respond")

    // Payload sizes (bytes), best-effort.
    requestBytes: integer("request_bytes"),
    responseBytes: integer("response_bytes"),
    contentType: text("content_type"),

    // Failure detail.
    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    // Billing linkage for this request, if credits were charged.
    creditsCharged: real("credits_charged"),

    // Client context.
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("api_request_logs_consumer_idx").on(t.consumerId),
    index("api_request_logs_request_id_idx").on(t.requestId),
    index("api_request_logs_created_at_idx").on(t.createdAt),
    index("api_request_logs_outcome_idx").on(t.outcome),
    index("api_request_logs_status_idx").on(t.statusCode),
    index("api_request_logs_path_idx").on(t.path),
  ],
);

// ─────────────────────────────────────────────
// EXPORT ALL
// ─────────────────────────────────────────────

export const pgSchema = {
  jobStatusEnum,
  featureTypeEnum,
  transactionTypeEnum,
  paymentStatusEnum,
  paymentProviderEnum,
  webhookEventStatusEnum,
  apiKeyStatusEnum,
  requestOutcomeEnum,
  consumers,
  apiKeys,
  plans,
  subscriptions,
  creditWallets,
  creditTransactions,
  payments,
  features,
  backendProviders,
  jobs,
  webhookEndpoints,
  webhookDeliveries,
  usageSnapshots,
  auditLogs,
  apiRequestLogs,
};
