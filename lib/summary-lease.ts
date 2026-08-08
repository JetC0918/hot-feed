type D1Like = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

const LEASE_TTL_MS = 30_000;

export async function acquireSummaryLease(
  db: D1Like | undefined,
  hash: string,
  leaseId: string,
  now = Date.now(),
): Promise<boolean> {
  if (!db) return true;

  const row = await db.prepare(`
    INSERT INTO summary_generation_lease (url_hash, lease_id, expires_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(url_hash) DO UPDATE SET
      lease_id = excluded.lease_id,
      expires_at = excluded.expires_at
    WHERE summary_generation_lease.expires_at <= ?4
    RETURNING lease_id
  `).bind(hash, leaseId, now + LEASE_TTL_MS, now).first<{ lease_id: string }>();

  return row?.lease_id === leaseId;
}

export async function releaseSummaryLease(db: D1Like | undefined, hash: string, leaseId: string) {
  if (!db) return;
  await db.prepare("DELETE FROM summary_generation_lease WHERE url_hash = ?1 AND lease_id = ?2")
    .bind(hash, leaseId)
    .run();
}
