import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the HotFeed experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>HotFeed - Your Personal Trend Radar<\/title>/i);
  assert.match(html, /Reddit trend aggregator/);
  assert.match(html, /Reddit \(r\/technology\)/);
  assert.match(html, /Hottest/);
  assert.match(html, /Newest/);
  assert.match(html, /Guests can preview AI summaries for the top three posts/);
  assert.match(html, /Sign In for Full Access/);
  assert.doesNotMatch(html, /Add Feed/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
