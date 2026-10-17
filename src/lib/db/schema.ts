import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  uuid,
  date,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { NormalizedMetadata, RawMetadata } from "@/lib/image/metadata";
import type { ImageStats } from "@/lib/image/stats";
import type { AnalysisResult, Fact } from "@/lib/analysis/types";

// ---------------------------------------------------------------- Auth.js (bảng chuẩn)

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------- App

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    previewWidth: integer("preview_width").notNull(),
    previewHeight: integer("preview_height").notNull(),
    sha256: text("sha256").notNull(),
    originalKey: text("original_key").notNull(),
    previewKey: text("preview_key").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("photos_user_created_idx").on(t.userId, t.createdAt), index("photos_user_sha_idx").on(t.userId, t.sha256)],
);

export const photoMetadata = pgTable("photo_metadata", {
  photoId: uuid("photo_id")
    .primaryKey()
    .references(() => photos.id, { onDelete: "cascade" }),
  make: text("make"),
  model: text("model"),
  lensModel: text("lens_model"),
  fNumber: real("f_number"),
  exposureTime: real("exposure_time"),
  iso: integer("iso"),
  focalLength: real("focal_length"),
  focalLength35: real("focal_length_35"),
  exposureBias: real("exposure_bias"),
  whiteBalance: text("white_balance"),
  meteringMode: text("metering_mode"),
  flash: text("flash"),
  takenAt: timestamp("taken_at", { mode: "date" }),
  software: text("software"),
  /** Chỉ lưu khi người dùng đồng ý */
  gpsLat: real("gps_lat"),
  gpsLng: real("gps_lng"),
  normalized: jsonb("normalized").$type<NormalizedMetadata>().notNull(),
  raw: jsonb("raw").$type<RawMetadata>(),
  stats: jsonb("stats").$type<ImageStats>().notNull(),
});

export type AnalysisStatus = "pending" | "done" | "failed";
export type AnalysisMode = "basic" | "advanced";

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<AnalysisStatus>().notNull().default("pending"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    locale: text("locale").notNull(),
    mode: text("mode").$type<AnalysisMode>().notNull(),
    facts: jsonb("facts").$type<Fact[]>(),
    result: jsonb("result").$type<AnalysisResult>(),
    overallScore: integer("overall_score"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("analyses_photo_idx").on(t.photoId, t.createdAt)],
);

export const usageQuota = pgTable(
  "usage_quota",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export type Photo = typeof photos.$inferSelect;
export type PhotoMetadataRow = typeof photoMetadata.$inferSelect;
export type Analysis = typeof analyses.$inferSelect;
