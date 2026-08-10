import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const modalityEnum = pgEnum("modality", [
  "text_to_image",
  "text_to_video",
  "image_to_video",
]);

export const generationStatusEnum = pgEnum("generation_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "canceled",
]);

export const transactionKindEnum = pgEnum("transaction_kind", [
  "grant", // signup bonus, admin grant, (later) purchase
  "reserve", // held when a generation is submitted
  "settle", // reserve finalized after success (no-op delta; marks the hold spent)
  "refund", // reserve returned after failure
]);

export const characterStatusEnum = pgEnum("character_status", [
  "draft", // collecting training images
  "training",
  "ready",
  "failed",
]);

// ---------------------------------------------------------------------------
// profiles — 1:1 with auth.users (Supabase). Created by trigger on signup.
// ---------------------------------------------------------------------------

export const profiles = pgTable("profiles", {
  // Matches auth.users.id; FK added in SQL migration (auth schema isn't in Drizzle's view)
  id: uuid("id").primaryKey(),
  username: text("username").unique(),
  avatarUrl: text("avatar_url"),
  // Cached projection of the ledger. Only ever written by the spend_credits /
  // grant_credits SQL functions — never from app code.
  creditBalance: integer("credit_balance").notNull().default(0),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// credit_transactions — append-only ledger. Balance is derivable by summing
// deltas; balance_after is a per-row snapshot for auditability.
// ---------------------------------------------------------------------------

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(), // negative = spend/reserve, positive = grant/refund
    kind: transactionKindEnum("kind").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    generationId: uuid("generation_id"), // FK added in migration (circular ref)
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_tx_user_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// models — the provider registry. Adding a model is a row insert, not a deploy.
// ---------------------------------------------------------------------------

export const models = pgTable("models", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("fal"),
  // e.g. "fal-ai/flux/schnell", "fal-ai/kling-video/v2/master/image-to-video"
  providerSlug: text("provider_slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  modality: modalityEnum("modality").notNull(),
  // JSON-schema-ish description of accepted params (aspect ratios, durations…)
  paramsSchema: jsonb("params_schema").notNull().default({}),
  // e.g. { type: "per_image", credits: 1 } | { type: "per_second", credits: 10 }
  costConfig: jsonb("cost_config").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// presets — the product. Curated prompt templates over registry models.
// ---------------------------------------------------------------------------

export const presets = pgTable(
  "presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(), // "style" | "camera" | "vfx" | …
    modality: modalityEnum("modality").notNull(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id),
    // "{subject}, crash zoom, anamorphic lens flare, 35mm film grain"
    promptTemplate: text("prompt_template").notNull(),
    negativePrompt: text("negative_prompt"),
    params: jsonb("params").notNull().default({}), // param overrides merged at submit
    thumbnailUrl: text("thumbnail_url"),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("presets_category_idx").on(t.category, t.modality)],
);

// ---------------------------------------------------------------------------
// generations — one row per job, driven through the async pipeline.
// ---------------------------------------------------------------------------

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    modality: modalityEnum("modality").notNull(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id),
    presetId: uuid("preset_id").references(() => presets.id),
    characterId: uuid("character_id"), // FK added in migration (characters defined below)
    prompt: text("prompt").notNull(), // what the user typed
    resolvedPrompt: text("resolved_prompt").notNull(), // after preset/trigger-word interpolation
    params: jsonb("params").notNull().default({}),
    // For image-to-video: the source asset
    sourceAssetId: uuid("source_asset_id"),
    status: generationStatusEnum("status").notNull().default("queued"),
    providerRequestId: text("provider_request_id"),
    creditsReserved: integer("credits_reserved").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("generations_idempotency_idx").on(t.userId, t.idempotencyKey),
    index("generations_user_idx").on(t.userId, t.createdAt),
    // The reconciliation cron sweeps by status + age
    index("generations_status_idx").on(t.status, t.createdAt),
    index("generations_provider_req_idx").on(t.providerRequestId),
  ],
);

// ---------------------------------------------------------------------------
// assets — persisted outputs. Bytes live in Supabase Storage; fal URLs are
// temporary and must never be the source of truth.
// ---------------------------------------------------------------------------

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "image" | "video"
    storagePath: text("storage_path").notNull(), // bucket-relative path
    mimeType: text("mime_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("duration_seconds"),
    thumbnailPath: text("thumbnail_path"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assets_user_idx").on(t.userId, t.createdAt),
    // Deterministic path per generation+index — makes webhook retries idempotent
    uniqueIndex("assets_storage_path_idx").on(t.storagePath),
  ],
);

// ---------------------------------------------------------------------------
// characters — Soul ID. A trained LoRA bound to a trigger word.
// ---------------------------------------------------------------------------

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: characterStatusEnum("status").notNull().default("draft"),
  triggerWord: text("trigger_word").notNull(),
  loraUrl: text("lora_url"),
  trainingRequestId: text("training_request_id"),
  // Explicit likeness consent — legally required, not a nicety
  consentAt: timestamp("consent_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const characterImages = pgTable(
  "character_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("character_images_character_idx").on(t.characterId)],
);
