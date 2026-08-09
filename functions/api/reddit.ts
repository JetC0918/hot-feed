import { handleRedditFeedRequest, type RedditEnv } from "../_lib/reddit.ts";

type PagesContext = {
  request: Request;
  env: RedditEnv;
  waitUntil(promise: Promise<unknown>): void;
};

type EdgeCacheStorage = CacheStorage & { default?: Cache };

export async function onRequest(context: PagesContext) {
  const edgeCache = (globalThis.caches as EdgeCacheStorage | undefined)?.default;
  if (context.request.method === "GET" && edgeCache) {
    try {
      const cached = await edgeCache.match(context.request);
      if (cached) return cached;
    } catch {
      // A cache outage should degrade to a live Reddit request.
    }
  }

  const response = await handleRedditFeedRequest(context.request, context.env);
  if (response.ok && edgeCache) {
    context.waitUntil(edgeCache.put(context.request, response.clone()).catch(() => undefined));
  }
  return response;
}
