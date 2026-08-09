import type { FeedPost, FeedResponse, SortMode } from "../../lib/feed-types.ts";

export type RedditEnv = {
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  REDDIT_USER_AGENT?: string;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_SUBREDDIT = "technology";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const REDDIT_TIMEOUT_MS = 8_000;

export class FeedRequestError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function redditUrl(path: string) {
  if (!path.startsWith("/")) throw new FeedRequestError("Invalid Reddit permalink");
  return new URL(path, "https://www.reddit.com").toString();
}

function safeOutboundUrl(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function safeThumbnail(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeSubreddit(value: string) {
  const subreddit = value.trim().replace(/^r\//i, "").toLowerCase();
  return /^[a-z0-9_]{2,21}$/.test(subreddit) ? subreddit : null;
}

export function parseFeedQuery(url: URL) {
  const subreddit = normalizeSubreddit(url.searchParams.get("subreddit") ?? DEFAULT_SUBREDDIT);
  const sort = url.searchParams.get("sort") ?? "hot";
  const rawLimit = url.searchParams.get("limit") ?? String(DEFAULT_LIMIT);
  const limit = Number(rawLimit);

  if (!subreddit) throw new FeedRequestError("Invalid subreddit");
  if (sort !== "hot" && sort !== "new") throw new FeedRequestError("Invalid sort mode");
  if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new FeedRequestError("Invalid post limit");
  }

  return { subreddit, sort, limit } satisfies {
    subreddit: string;
    sort: SortMode;
    limit: number;
  };
}

export function normalizeRedditListing(
  payload: unknown,
  subreddit: string,
  sort: SortMode,
): FeedResponse {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.children)) {
    throw new FeedRequestError("Invalid Reddit listing");
  }

  const posts: FeedPost[] = [];
  for (const child of payload.data.children) {
    if (!isRecord(child) || child.kind !== "t3" || !isRecord(child.data)) continue;
    const post = child.data;
    if (typeof post.id !== "string" || typeof post.title !== "string" || !post.title.trim()) continue;
    if (typeof post.permalink !== "string") continue;

    let permalink: string;
    try {
      permalink = redditUrl(post.permalink);
    } catch {
      continue;
    }

    const createdUtc = finiteNumber(post.created_utc);
    const createdAt = new Date(createdUtc * 1_000);
    if (!createdUtc || Number.isNaN(createdAt.valueOf())) continue;

    const normalized: FeedPost = {
      id: post.id,
      title: post.title.trim(),
      author: typeof post.author === "string" && post.author ? post.author : "[deleted]",
      score: finiteNumber(post.score),
      commentCount: finiteNumber(post.num_comments),
      createdAt: createdAt.toISOString(),
      permalink,
      outboundUrl: safeOutboundUrl(post.url, permalink),
      isSelfPost: post.is_self === true,
    };
    const thumbnailUrl = safeThumbnail(post.thumbnail);
    if (thumbnailUrl) normalized.thumbnailUrl = thumbnailUrl;
    posts.push(normalized);
  }

  return { subreddit, sort, posts };
}

function json(body: unknown, status: number, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit) {
  return json({ error: { code, message } }, status, headers);
}

async function readJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw new FeedRequestError("Invalid Reddit response");
  }
}

function configuredEnv(env: RedditEnv) {
  const clientId = env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = env.REDDIT_USER_AGENT?.trim();
  return clientId && clientSecret && userAgent ? { clientId, clientSecret, userAgent } : null;
}

export async function handleRedditFeedRequest(
  request: Request,
  env: RedditEnv,
  fetcher: Fetcher = fetch,
) {
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Only GET requests are supported.", { Allow: "GET" });
  }

  let query: ReturnType<typeof parseFeedQuery>;
  try {
    query = parseFeedQuery(new URL(request.url));
  } catch {
    return errorResponse(400, "invalid_request", "Choose a valid subreddit, sort, and limit.");
  }

  const config = configuredEnv(env);
  if (!config) {
    return errorResponse(503, "not_configured", "The Reddit feed is not configured yet.");
  }

  try {
    const signal = AbortSignal.timeout(REDDIT_TIMEOUT_MS);
    const basicCredentials = btoa(`${config.clientId}:${config.clientSecret}`);
    const tokenResponse = await fetcher("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": config.userAgent,
      },
      body: "grant_type=client_credentials",
      signal,
    });
    if (!tokenResponse.ok) throw new FeedRequestError("Reddit OAuth rejected the request");
    const tokenPayload = await readJson(tokenResponse);
    if (!isRecord(tokenPayload) || typeof tokenPayload.access_token !== "string" || !tokenPayload.access_token) {
      throw new FeedRequestError("Invalid Reddit OAuth response");
    }

    const listingUrl = new URL(`https://oauth.reddit.com/r/${query.subreddit}/${query.sort}`);
    listingUrl.searchParams.set("limit", String(query.limit));
    listingUrl.searchParams.set("raw_json", "1");
    const listingResponse = await fetcher(listingUrl, {
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        "User-Agent": config.userAgent,
      },
      signal,
    });
    if (!listingResponse.ok) throw new FeedRequestError("Reddit rejected the listing request");
    const listing = normalizeRedditListing(await readJson(listingResponse), query.subreddit, query.sort);

    return json(listing, 200, {
      "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
      "CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return errorResponse(504, "reddit_timeout", "Reddit took too long to respond.");
    }
    return errorResponse(502, "reddit_unavailable", "Reddit is temporarily unavailable.");
  }
}
