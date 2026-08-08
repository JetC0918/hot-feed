import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const summaryCache = sqliteTable("summary_cache", {
  urlHash: text("url_hash").primaryKey(),
  canonicalUrl: text("canonical_url").notNull(),
  sourceId: text("source_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  basis: text("basis", { enum: ["article", "metadata"] }).notNull(),
  createdAt: integer("created_at").notNull(),
  lastAccessedAt: integer("last_accessed_at").notNull(),
});

export const summaryGenerationLease = sqliteTable("summary_generation_lease", {
  urlHash: text("url_hash").primaryKey(),
  leaseId: text("lease_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
