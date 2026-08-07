import { getRankedPost, getSource, type SortMode } from "@/lib/feed-data";
import { canRequestSummary } from "@/lib/entitlement";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { getCachedSummary, putCachedSummary } from "@/lib/summary-cache";
import { canonicalizeSourceUrl, fetchArticleExcerpt, hashUrl } from "@/lib/summary-security";

type SummaryPayload = { url?: unknown; title?: unknown; sourceId?: unknown; rank?: unknown; sortMode?: unknown };

function error(message: string, status: number, code: string, retryable = false) {
  return Response.json({ error: message, code, retryable }, { status });
}

export async function POST(request: Request) {
  let payload: SummaryPayload;
  try { payload = await request.json() as SummaryPayload; } catch { return error("Invalid request", 400, "invalid_request"); }
  const { url, title, sourceId, rank, sortMode } = payload;
  if (typeof url !== "string" || typeof title !== "string" || typeof sourceId !== "string" || !Number.isInteger(rank) || Number(rank) < 1 || title.length > 500 || (sortMode !== "hot" && sortMode !== "new")) return error("Invalid request", 400, "invalid_request");
  const source = getSource(sourceId);
  if (!source) return error("Unknown feed source", 400, "invalid_source");
  const registeredPost = getRankedPost(sourceId, sortMode as SortMode, Number(rank));
  if (!registeredPost || registeredPost.url !== url || registeredPost.title !== title) return error("Post does not match this feed and rank", 400, "invalid_post");
  const runtime = getRuntimeEnv();
  const authenticated = await verifySessionToken(readCookie(request, SESSION_COOKIE), runtime.SESSION_SECRET);
  if (!canRequestSummary(authenticated, Number(rank))) return error("Sign in to summarize posts beyond the top three", 403, "sign_in_required");
  let canonicalUrl: string;
  try { canonicalUrl = canonicalizeSourceUrl(url, sourceId); } catch { return error("This link cannot be summarized safely", 400, "invalid_url"); }
  const hash = await hashUrl(canonicalUrl);
  try {
    const cached = await getCachedSummary(runtime.DB, hash);
    if (cached) return Response.json({ ...cached, cached: true });
  } catch { /* A missing cache must not make the article inaccessible. */ }
  if (!runtime.API_KEY) return error("AI summaries are not configured yet", 503, "not_configured");

  let excerpt = "";
  let basis: "article" | "metadata" = "article";
  try { excerpt = await fetchArticleExcerpt(canonicalUrl, sourceId); } catch { basis = "metadata"; }
  const context = excerpt || `Only metadata is available. Title: ${title}. Source: ${source.name}.`;
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
  } catch { return error("The summary service is temporarily unavailable", 502, "upstream_unavailable", true); }
  if (upstream.status === 429) return error("The summary service is busy. Try again shortly", 429, "rate_limited", true);
  if (!upstream.ok) return error("The summary could not be generated", 502, "upstream_error", true);
  let result: { choices?: Array<{ message?: { content?: string } }> };
  try { result = await upstream.json() as typeof result; } catch { return error("The summary service returned an invalid response", 502, "invalid_upstream_response", true); }
  const summary = result.choices?.[0]?.message?.content?.trim();
  if (!summary) return error("The summary could not be generated", 502, "empty_response", true);
  try { await putCachedSummary(runtime.DB, { hash, url: canonicalUrl, sourceId, title, summary, basis }); } catch { /* cache failure is non-fatal */ }
  return Response.json({ summary, basis, cached: false });
}
