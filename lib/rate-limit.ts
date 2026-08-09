export type RateLimitRecord = { count: number; resetAt: number };

/** Bounded, insertion-ordered limiter state; cleanup work is capped per request. */
export class BoundedRateLimiter {
  private readonly records = new Map<string, RateLimitRecord>();
  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
    private readonly maxEntries = 2048,
  ) {}

  isLimited(key: string, now = Date.now()) {
    let inspected = 0;
    for (const [entryKey, record] of this.records) {
      if (record.resetAt > now || inspected++ >= 64) break;
      this.records.delete(entryKey);
    }
    const existing = this.records.get(key);
    if (!existing || existing.resetAt <= now) {
      if (existing) this.records.delete(key);
      while (this.records.size >= this.maxEntries) {
        const oldest = this.records.keys().next().value;
        if (oldest === undefined) break;
        this.records.delete(oldest);
      }
      this.records.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    existing.count += 1;
    return existing.count > this.maxRequests;
  }

  get size() { return this.records.size; }
}
