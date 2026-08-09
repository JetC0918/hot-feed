import type { FeedPost, FeedResponse, SortMode } from "../../lib/feed-types.ts";

export type RedditEnv = {
  REDDIT_USER_AGENT?: string;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_SUBREDDIT = "technology";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const REDDIT_TIMEOUT_MS = 8_000;
const DEFAULT_USER_AGENT = "web:hot-feed:0.2.0 (RSS reader)";

export class FeedRequestError extends Error {}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const radix = code[0].toLowerCase() === "x" ? 16 : 10;
      const number = Number.parseInt(code.slice(radix === 16 ? 1 : 0), radix);
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
    })
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
    }[name] ?? ""));
}

function xmlField(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]).trim() : "";
}

function redditPermalink(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "reddit.com" || hostname.endsWith(".reddit.com") || hostname === "redd.it")) {
      throw new FeedRequestError("Invalid Reddit permalink");
    }
    if (!url.pathname.startsWith("/r/") && !url.pathname.startsWith("/comments/")) {
      throw new FeedRequestError("Invalid Reddit permalink");
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    throw new FeedRequestError("Invalid Reddit permalink");
  }
}

function postId(guid: string, permalink: string) {
  const fromGuid = guid.replace(/^t3_/i, "").trim();
  if (/^[a-z0-9]+$/i.test(fromGuid)) return fromGuid;
  const match = new URL(permalink).pathname.match(/\/comments\/([^/]+)/i);
  return match?.[1] ?? "";
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

export function normalizeRssFeed(xml: string, subreddit: string, sort: SortMode): FeedResponse {
  if (!/<rss(?:\s[^>]*)?>[\s\S]*<channel(?:\s[^>]*)?>/i.test(xml)) {
    throw new FeedRequestError("Invalid Reddit RSS feed");
  }

  const posts: FeedPost[] = [];
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  for (const item of items) {
    const title = xmlField(item, "title");
    const link = xmlField(item, "link");
    const createdAt = new Date(xmlField(item, "pubDate"));
    const permalink = (() => {
      try {
        return redditPermalink(link);
      } catch {
        return null;
      }
    })();
    const id = permalink ? postId(xmlField(item, "guid"), permalink) : "";
    if (!title || !permalink || !id || Number.isNaN(createdAt.valueOf())) continue;

    posts.push({
      id,
      title,
      author: xmlField(item, "dc:creator") || xmlField(item, "author") || "[deleted]",
      createdAt: createdAt.toISOString(),
      permalink,
      outboundUrl: permalink,
    });
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

  try {
    const signal = AbortSignal.timeout(REDDIT_TIMEOUT_MS);
    const rssUrl = new URL(`https://www.reddit.com/r/${query.subreddit}/${query.sort}.rss`);
    rssUrl.searchParams.set("limit", String(query.limit));
    const response = await fetcher(rssUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": env.REDDIT_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      },
      signal,
    });
    if (!response.ok) throw new FeedRequestError("Reddit rejected the RSS request");
    const feed = normalizeRssFeed(await response.text(), query.subreddit, query.sort);

    return json(feed, 200, {
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
