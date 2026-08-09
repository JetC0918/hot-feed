import assert from "node:assert/strict";
import test from "node:test";
import * as feed from "../functions/_lib/reddit.ts";

const env = {
  REDDIT_USER_AGENT: "web:hot-feed:test (by /u/example)",
};

const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>webdev</title>
    <item>
      <title><![CDATA[A useful &amp; tested release]]></title>
      <link>https://www.reddit.com/r/webdev/comments/abc123/a_useful_release/</link>
      <guid isPermaLink="false">t3_abc123</guid>
      <pubDate>Wed, 15 Jan 2027 08:00:00 GMT</pubDate>
      <dc:creator><![CDATA[builder]]></dc:creator>
      <description><![CDATA[<p>Post body</p>]]></description>
    </item>
  </channel>
</rss>`;

test("feed query accepts Reddit names and bounds sort and limit", () => {
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

test("Reddit RSS entries are normalized into the browser feed contract", () => {
  assert.equal(typeof feed.normalizeRssFeed, "function");
  assert.deepEqual(feed.normalizeRssFeed(rssFeed, "webdev", "hot"), {
    subreddit: "webdev",
    sort: "hot",
    posts: [
      {
        id: "abc123",
        title: "A useful & tested release",
        author: "builder",
        createdAt: "2027-01-15T08:00:00.000Z",
        permalink: "https://www.reddit.com/r/webdev/comments/abc123/a_useful_release/",
        outboundUrl: "https://www.reddit.com/r/webdev/comments/abc123/a_useful_release/",
      },
    ],
  });
  assert.throws(() => feed.normalizeRssFeed("<html>not RSS</html>", "webdev", "hot"), /invalid/i);
});

test("feed handler fetches RSS without OAuth and returns cacheable normalized data", async () => {
  const calls = [];
  const fetchStub = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(rssFeed, { headers: { "Content-Type": "application/rss+xml" } });
  };

  const response = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit?subreddit=webdev&sort=hot&limit=10"),
    env,
    fetchStub,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=120/);
  assert.deepEqual(await response.json(), feed.normalizeRssFeed(rssFeed, "webdev", "hot"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.reddit.com/r/webdev/hot.rss?limit=10");
  assert.equal(calls[0].init.headers["User-Agent"], env.REDDIT_USER_AGENT);
  assert.equal(calls[0].init.headers.Authorization, undefined);
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

test("feed handler fails safely when RSS is unavailable", async () => {
  const response = await feed.handleRedditFeedRequest(
    new Request("https://hotfeed.test/api/reddit"),
    env,
    async () => new Response("upstream secret", { status: 503 }),
  );
  assert.equal(response.status, 502);
  const body = JSON.stringify(await response.json());
  assert.match(body, /reddit_unavailable/);
  assert.doesNotMatch(body, /upstream secret/);
});
