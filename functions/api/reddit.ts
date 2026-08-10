import { handleRedditFeedRequest, parseFeedQuery, type RedditEnv } from "../_lib/reddit.ts";

type PagesContext = {
  request: Request;
  env: RedditEnv;
  waitUntil(promise: Promise<unknown>): void;
};

type EdgeCacheStorage = CacheStorage & { default?: Cache };

type CacheTier = "fresh" | "stale";

const CACHE_SECONDS: Record<CacheTier, number> = {
  fresh: 600,
  stale: 86_400,
};

function cacheRequest(request: Request, tier: CacheTier) {
  const query = parseFeedQuery(new URL(request.url));
  const url = new URL(request.url);
  url.pathname = `/__hotfeed-cache/${tier}`;
  url.search = "";
  url.searchParams.set("subreddit", query.subreddit);
  url.searchParams.set("sort", query.sort);
  url.searchParams.set("limit", String(query.limit));
  return new Request(url.toString(), { method: "GET" });
}

function storedResponse(response: Response, tier: CacheTier) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=0, s-maxage=${CACHE_SECONDS[tier]}`);
  headers.set("CDN-Cache-Control", `public, s-maxage=${CACHE_SECONDS[tier]}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function servedResponse(response: Response, cacheStatus: "HIT" | "STALE") {
  const headers = new Headers(response.headers);
  headers.set("X-HotFeed-Cache", cacheStatus);
  if (cacheStatus === "STALE") {
    headers.set("Warning", '110 - "Response is stale while Reddit is unavailable"');
    headers.set("Cache-Control", "public, max-age=30, s-maxage=60");
    headers.set("CDN-Cache-Control", "public, s-maxage=60");
  }
  return new Response(response.body, { status: 200, headers });
}

export async function onRequest(context: PagesContext) {
  const edgeCache = (globalThis.caches as EdgeCacheStorage | undefined)?.default;
  let freshKey: Request | undefined;
  let staleKey: Request | undefined;
  if (context.request.method === "GET" && edgeCache) {
    try {
      freshKey = cacheRequest(context.request, "fresh");
      staleKey = cacheRequest(context.request, "stale");
      const cached = await edgeCache.match(freshKey);
      if (cached) return servedResponse(cached, "HIT");
    } catch {
      // A cache outage should degrade to a live Reddit request.
    }
  }

  const response = await handleRedditFeedRequest(context.request, context.env);
  if (response.ok && edgeCache && freshKey && staleKey) {
    const fresh = storedResponse(response.clone(), "fresh");
    const stale = storedResponse(response.clone(), "stale");
    context.waitUntil(Promise.all([
      edgeCache.put(freshKey, fresh),
      edgeCache.put(staleKey, stale),
    ]).catch((error: unknown) => {
      console.error("HotFeed cache write failed", error);
    }));
  } else if ((response.status === 502 || response.status === 504) && edgeCache && staleKey) {
    try {
      const stale = await edgeCache.match(staleKey);
      if (stale) return servedResponse(stale, "STALE");
    } catch {
      // Preserve the original upstream error if stale cache access fails.
    }
  }
  return response;
}
