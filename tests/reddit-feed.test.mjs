import assert from "node:assert/strict";
import test from "node:test";
import * as feed from "../functions/_lib/reddit.ts";

const env = {
  REDDIT_CLIENT_ID: "client-id",
  REDDIT_CLIENT_SECRET: "client-secret",
  REDDIT_USER_AGENT: "web:hot-feed:test (by /u/example)",
};

function redditListing() {
  return {
    data: {
      children: [
        {
          kind: "t3",
          data: {
            id: "abc123",
            title: "A useful release",
            author: "builder",
            score: 321,
            num_comments: 45,
            created_utc: 1_800_000_000,
            permalink: "/r/webdev/comments/abc123/a_useful_release/",
            url: "https://example.com/release",
            is_self: false,
            thumbnail: "https://preview.redd.it/abc123.jpg",
          },
        },
      ],
    },
  };
}

test("feed query accepts Reddit names and bounds sort and limit", () => {
  assert.equal(typeof feed.parseFeedQuery, "function");
  assert.deepEqual(
    feed.parseFeedQuery(new URL("https://hotfeed.test/api/reddit?subreddit=r%2FWebDev&sort=new&limit=12")),
    { subreddit: "webdev", sort: "new", limit: 12 },
  );
  assert.deepEqual(
    feed.parseFeedQuery(new URL("https://hotfeed.test/api/reddit")),
    { subreddit: "technology", sort: "hot", limit: 25 },
  );
  for (const query of [
    "subreddit=../private",
    "sort=top",
    "limit=0",
    "limit=51",
    "limit=twenty",
  ]) {
    assert.throws(() => feed.parseFeedQuery(new URL(`https://hotfeed.test/api/reddit?${query}`)), /invalid/i);
  }
});

test("Reddit listings are normalized into the browser feed contract", () => {
  assert.equal(typeof feed.normalizeRedditListing, "function");
  const response = feed.normalizeRedditListing(redditListing(), "webdev", "hot");
  assert.deepEqual(response, {
    subreddit: "webdev",
    sort: "hot",
    posts: [
      {
        id: "abc123",
        title: "A useful release",
        author: "builder",
        score: 321,
        commentCount: 45,
        createdAt: "2027-01-15T08:00:00.000Z",
        permalink: "https://www.reddit.com/r/webdev/comments/abc123/a_useful_release/",
        outboundUrl: "https://example.com/release",
        isSelfPost: false,
        thumbnailUrl: "https://preview.redd.it/abc123.jpg",
      },
    ],
  });
  assert.throws(() => feed.normalizeRedditListing({ data: { children: "invalid" } }, "webdev", "hot"), /invalid/i);
});

test("feed handler uses application OAuth and returns cacheable normalized data", async () => {
  assert.equal(typeof feed.handleRedditFeedRequest, "function");
  const calls = [];
  const fetchStub = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    if (calls.length === 1) return Response.json({ access_token: "token-123", expires_in: 3600 });
    return Response.json(redditListing());
  };

  const response = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit?subreddit=webdev&sort=hot&limit=10"),
    env,
    fetchStub,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=120/);
  assert.deepEqual(await response.json(), feed.normalizeRedditListing(redditListing(), "webdev", "hot"));
  assert.equal(calls[0].url, "https://www.reddit.com/api/v1/access_token");
  assert.equal(calls[0].init.method, "POST");
  assert.match(String(calls[0].init.headers.Authorization), /^Basic /);
  assert.equal(calls[0].init.headers["User-Agent"], env.REDDIT_USER_AGENT);
  assert.equal(calls[0].init.body, "grant_type=client_credentials");
  assert.equal(calls[1].url, "https://oauth.reddit.com/r/webdev/hot?limit=10&raw_json=1");
  assert.equal(calls[1].init.headers.Authorization, "Bearer token-123");
});

test("feed handler rejects invalid methods and requests before calling Reddit", async () => {
  let calls = 0;
  const fetchStub = async () => { calls += 1; return new Response(); };
  const methodResponse = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit", { method: "POST" }),
    env,
    fetchStub,
  );
  const queryResponse = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit?subreddit=not%20valid"),
    env,
    fetchStub,
  );
  assert.equal(methodResponse.status, 405);
  assert.equal(queryResponse.status, 400);
  assert.equal(calls, 0);
});

test("feed handler fails safely when configuration or Reddit is unavailable", async () => {
  let calls = 0;
  const missingConfig = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit"),
    {},
    async () => { calls += 1; return new Response(); },
  );
  assert.equal(missingConfig.status, 503);
  assert.equal(calls, 0);
  assert.deepEqual(await missingConfig.json(), {
    error: { code: "not_configured", message: "The Reddit feed is not configured yet." },
  });

  const oauthFailure = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit"),
    env,
    async () => new Response(`credential=${env.REDDIT_CLIENT_SECRET}`, { status: 401 }),
  );
  assert.equal(oauthFailure.status, 502);
  const body = JSON.stringify(await oauthFailure.json());
  assert.match(body, /reddit_unavailable/);
  assert.doesNotMatch(body, new RegExp(env.REDDIT_CLIENT_SECRET));
});
