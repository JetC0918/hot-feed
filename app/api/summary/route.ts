import { getRankedPost, getSource, type SortMode } from "@/lib/feed-data";
import { canRequestSummary } from "@/lib/entitlement";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { readCookie, requireSessionSecret, SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { assertSummaryStore, getCachedSummary, publishCachedSummaryAndRelease } from "@/lib/summary-cache";
import { acquireSummaryLease, renewSummaryLease, releaseSummaryLease } from "@/lib/summary-lease";
import { canonicalizeSourceUrl, fetchArticleExcerpt, hashUrl } from "@/lib/summary-security";
import { assertRequestBoundary, readBoundedJson, RequestBoundaryError } from "@/lib/request-boundary";
import { BoundedRateLimiter } from "@/lib/rate-limit";

type SummaryPayload = { url?: unknown; title?: unknown; sourceId?: unknown; rank?: unknown; sortMode?: unknown };
type SummaryResult = { summary: string; basis: "article" | "metadata" };

const inFlightSummaries = new Map<string, Promise<SummaryResult>>();
const MAX_REQUEST_BODY_BYTES = 16_384;
const limiter = new BoundedRateLimiter(60_000, 20);

class SummaryGenerationError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable: boolean, message: string) {
    super(message);
  }
}

class SummaryInProgressError extends SummaryGenerationError {
  constructor() { super(409, "summary_in_progress", true, "This summary is already being generated. Try again shortly"); }
}

function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

async function generateSummary(
  runtime: ReturnType<typeof getRuntimeEnv>,
  canonicalUrl: string,
  sourceId: string,
  title: string,
  source: NonNullable<ReturnType<typeof getSource>>,
  renew: () => Promise<void>,
): Promise<SummaryResult> {
  if (!runtime.API_KEY) throw new SummaryGenerationError(503, "not_configured", false, "AI summaries are not configured yet");

  let excerpt = "";
  let basis: "article" | "metadata" = "article";
  await renew();
  try { excerpt = await fetchArticleExcerpt(canonicalUrl, sourceId); } catch { basis = "metadata"; }
  const context = excerpt || `Only metadata is available. Title: ${title}. Source: ${source.name}.`;
  await renew();

  let upstream: Response;
  try {
    upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-flash", thinking: { type: "disabled" }, max_tokens: 130, temperature: 0.2, messages: [
        { role: "system", content: "Summarize the linked story in 2 concise, factual sentences. Do not speculate or include markdown." },
        { role: "user", content: `Title: ${title}\nSource: ${source.name}\nContent: ${context}` },
      ] }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SummaryGenerationError(502, "upstream_unavailable", true, "The summary service is temporarily unavailable");
  }
  if (upstream.status === 429) throw new SummaryGenerationError(429, "rate_limited", true, "The summary service is busy. Try again shortly");
  if (!upstream.ok) throw new SummaryGenerationError(502, "upstream_error", true, "The summary could not be generated");

  let result: { choices?: Array<{ message?: { content?: string } }> };
  try { result = await upstream.json() as typeof result; } catch {
    throw new SummaryGenerationError(502, "invalid_upstream_response", true, "The summary service returned an invalid response");
  }
  const summary = result.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new SummaryGenerationError(502, "empty_response", true, "The summary could not be generated");

  await renew();
  return { summary, basis };
}

function error(message: string, status: number, code: string, retryable = false) {
  return Response.json({ error: message, code, retryable }, { status });
}

export async function POST(request: Request) {
  try { assertRequestBoundary(request, { method: "POST", mediaType: "json", maxBytes: MAX_REQUEST_BODY_BYTES }); }
  catch (cause) { if (cause instanceof RequestBoundaryError) return error(cause.message, cause.status, cause.code, cause.status === 413); return error("Invalid request", 400, "invalid_request"); }
  let payload: SummaryPayload;
  try {
    const parsed = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return error("Invalid request", 400, "invalid_request");
    payload = parsed as SummaryPayload;
  } catch (cause) {
    if (cause instanceof RequestBoundaryError && cause.status === 413) return error(cause.message, 413, cause.code, true);
    return error("Invalid request", 400, "invalid_request");
  }
  const { url, title, sourceId, rank, sortMode } = payload;
  if (limiter.isLimited(clientKey(request))) return error("Too many summary requests. Try again later", 429, "rate_limited", true);
  if (typeof url !== "string" || typeof title !== "string" || typeof sourceId !== "string" || !Number.isInteger(rank) || Number(rank) < 1 || url.length > 2_048 || title.length > 500 || (sortMode !== "hot" && sortMode !== "new")) return error("Invalid request", 400, "invalid_request");
  const source = getSource(sourceId);
  if (!source) return error("Unknown feed source", 400, "invalid_source");
  const registeredPost = getRankedPost(sourceId, sortMode as SortMode, Number(rank));
  if (!registeredPost || registeredPost.url !== url || registeredPost.title !== title) return error("Post does not match this feed and rank", 400, "invalid_post");
  const runtime = getRuntimeEnv();
  try { requireSessionSecret(runtime.SESSION_SECRET); } catch { return error("The summary service is not configured", 503, "not_configured"); }
  try { await assertSummaryStore(runtime.DB); } catch { return error("The summary service is temporarily unavailable", 503, "cache_unavailable", true); }
  const sessionToken = readCookie(request, SESSION_COOKIE);
  const authenticated = await verifySessionToken(sessionToken, runtime.SESSION_SECRET);
  // A stale/invalid session cookie is authoritative evidence that a client
  // which believed it was signed in must refresh its auth epoch. Anonymous
  // requests without a cookie remain eligible for the guest top-three path.
  if (sessionToken && !authenticated) return error("Your session has expired. Sign in again", 401, "session_expired");
  if (!canRequestSummary(authenticated, Number(rank))) return error("Sign in to summarize posts beyond the top three", 403, "sign_in_required");
  let canonicalUrl: string;
  try { canonicalUrl = canonicalizeSourceUrl(url, sourceId); } catch { return error("This link cannot be summarized safely", 400, "invalid_url"); }
  const hash = await hashUrl(canonicalUrl);
  try {
    const cached = await getCachedSummary(runtime.DB, hash);
    if (cached) return Response.json({ ...cached, cached: true });
  } catch { return error("The summary service is temporarily unavailable", 503, "cache_unavailable", true); }

  const pending = inFlightSummaries.get(hash);
  if (pending) {
    try {
      const result = await pending;
      return Response.json({ ...result, cached: false, coalesced: true });
    } catch (cause) {
      if (cause instanceof SummaryGenerationError) return error(cause.message, cause.status, cause.code, cause.retryable);
      return error("The summary could not be generated", 502, "generation_failed", true);
    }
  }

  const leaseId = crypto.randomUUID();
  const generation = (async () => {
    let acquired: boolean;
    try { acquired = await acquireSummaryLease(runtime.DB, hash, leaseId); } catch {
      throw new SummaryGenerationError(503, "coordination_unavailable", true, "The summary service is temporarily unavailable");
    }
    if (!acquired) throw new SummaryInProgressError();
    let retainLease = false;
    try {
      const renew = async () => {
        if (!await renewSummaryLease(runtime.DB, hash, leaseId)) throw new SummaryGenerationError(409, "summary_in_progress", true, "This summary is already being generated. Try again shortly");
      };
      await renew();
      let postLease: Awaited<ReturnType<typeof getCachedSummary>>;
      try { postLease = await getCachedSummary(runtime.DB, hash); }
      catch { throw new SummaryGenerationError(503, "cache_unavailable", true, "The summary service is temporarily unavailable"); }
      if (postLease) {
        await releaseSummaryLease(runtime.DB, hash, leaseId);
        return postLease;
      }
      const result = await generateSummary(runtime, canonicalUrl, sourceId, title, source, renew);
      try {
        await publishCachedSummaryAndRelease(runtime.DB, { hash, url: canonicalUrl, sourceId, title, summary: result.summary, basis: result.basis }, leaseId);
      } catch {
        throw new SummaryGenerationError(503, "cache_unavailable", true, "The summary service is temporarily unavailable");
      }
      return result;
    } catch (cause) {
      retainLease = cause instanceof SummaryGenerationError && cause.code === "cache_unavailable";
      throw cause;
    } finally {
      if (!retainLease) {
        try { await releaseSummaryLease(runtime.DB, hash, leaseId); } catch { /* stale leases expire automatically */ }
      }
    }
  })();
  inFlightSummaries.set(hash, generation);
  try {
    const result = await generation;
    return Response.json({ ...result, cached: false });
  } catch (cause) {
    if (cause instanceof SummaryGenerationError) return error(cause.message, cause.status, cause.code, cause.retryable);
    return error("The summary could not be generated", 502, "generation_failed", true);
  } finally {
    if (inFlightSummaries.get(hash) === generation) inFlightSummaries.delete(hash);
  }
}
