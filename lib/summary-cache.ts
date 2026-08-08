export type SummaryRecord = { summary: string; basis: "article" | "metadata" };

type D1Like = { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } };

export class SummaryStoreUnavailableError extends Error {
  constructor() {
    super("Summary storage is unavailable");
  }
}

export async function assertSummaryStore(db: D1Like | undefined): Promise<void> {
  if (!db) throw new SummaryStoreUnavailableError();
  await db.prepare("SELECT 1").bind().first<{ ok: number }>();
}

export async function getCachedSummary(db: D1Like | undefined, hash: string): Promise<SummaryRecord | null> {
  if (!db) throw new SummaryStoreUnavailableError();
  const row = await db.prepare("SELECT summary, basis FROM summary_cache WHERE url_hash = ?1").bind(hash).first<SummaryRecord>();
  if (row) await db.prepare("UPDATE summary_cache SET last_accessed_at = ?1 WHERE url_hash = ?2").bind(Date.now(), hash).run();
  return row;
}

export async function putCachedSummary(db: D1Like | undefined, values: { hash: string; url: string; sourceId: string; title: string; summary: string; basis: string }) {
  if (!db) throw new SummaryStoreUnavailableError();
  const now = Date.now();
  await db.prepare("INSERT INTO summary_cache (url_hash, canonical_url, source_id, title, summary, basis, created_at, last_accessed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(url_hash) DO UPDATE SET summary = excluded.summary, basis = excluded.basis, last_accessed_at = excluded.last_accessed_at")
    .bind(values.hash, values.url, values.sourceId, values.title, values.summary, values.basis, now).run();
}
