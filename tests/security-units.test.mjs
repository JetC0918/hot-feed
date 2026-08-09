import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canRequestSummary } from "../lib/entitlement.ts";
import { contrastForeground, getRankedPost, normalizePersistedSourceIds } from "../lib/feed-data.ts";
import { constantTimeEqual, createSessionToken, verifySessionToken } from "../lib/session.ts";
import { assertEmptyBody, RequestBoundaryError } from "../lib/request-boundary.ts";
import { canonicalizeSourceUrl, fetchArticleExcerpt } from "../lib/summary-security.ts";

test("signed sessions verify, reject tampering, and expire", async () => {
  const secret = "unit-test-only-secret-material-32-chars";
  const now = 1_800_000_000_000;
  const token = await createSessionToken(secret, now);
  assert.equal(await verifySessionToken(token, secret, now + 1_000), true);
  assert.equal(await verifySessionToken(`${token}x`, secret, now + 1_000), false);
  assert.equal(await verifySessionToken(token, secret, now + 13 * 60 * 60 * 1_000), false);
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("same", "different"), false);
});

test("guest entitlement is limited to the top three ranks", () => {
  assert.equal(canRequestSummary(false, 1), true);
  assert.equal(canRequestSummary(false, 3), true);
  assert.equal(canRequestSummary(false, 4), false);
  assert.equal(canRequestSummary(true, 40), true);
  assert.equal(canRequestSummary(true, 0), false);
});

test("feed rank is derived from the registered server fixture and sort mode", () => {
  const hottest = getRankedPost("reddit-technology", "hot", 1);
  const newest = getRankedPost("reddit-technology", "new", 1);
  assert.equal(hottest?.score, 100);
  assert.equal(newest?.ageHours, 1);
  assert.notEqual(hottest?.url, newest?.url);
  assert.equal(getRankedPost("reddit-technology", "hot", 999), null);
  assert.equal(getRankedPost("unknown", "hot", 1), null);
});

test("persisted source selections retain valid custom communities and remove duplicates/unknown IDs", () => {
  assert.deepEqual(
    normalizePersistedSourceIds({ version: 2, sourceIds: ["custom-reddit-webdev", "custom-reddit-webdev", "stale", "reddit-technology"] }),
    ["custom-reddit-webdev", "reddit-technology"],
  );
  assert.deepEqual(normalizePersistedSourceIds({ version: 99, sourceIds: ["reddit-technology"] }), ["reddit-technology"]);
  assert.deepEqual(normalizePersistedSourceIds(["custom-reddit-INVALID!"]), ["reddit-technology"]);
});

test("source badge foregrounds meet the reviewed contrast floor", () => {
  assert.equal(contrastForeground("#25b8e6"), "#101827");
  assert.equal(contrastForeground("#3478f6"), "#000");
});

test("canonical URLs enforce HTTPS, source ownership, and tracking removal", () => {
  assert.equal(canonicalizeSourceUrl("https://www.reddit.com/r/technology/?utm_source=test#comments", "reddit-technology"), "https://www.reddit.com/r/technology/");
  for (const url of ["http://www.reddit.com/story", "https://example.com/story", "https://127.0.0.1/story", "https://user:pass@www.reddit.com/story", "https://evil.www.reddit.com/story"]) {
    assert.throws(() => canonicalizeSourceUrl(url, "reddit-technology"));
  }
});

test("article fetching revalidates redirects and rejects oversized HTML", async () => {
  const sourceUrl = "https://www.reddit.com/r/technology/comments/1opghaq/";
  await assert.rejects(
    fetchArticleExcerpt(sourceUrl, "reddit-technology", async () => new Response(null, { status: 302, headers: { location: "https://example.com/private" } })),
    /URL does not belong/,
  );
  await assert.rejects(
    fetchArticleExcerpt(sourceUrl, "reddit-technology", async () => new Response("short", { headers: { "content-type": "text/html", "content-length": "150001" } })),
    /too large/,
  );
});

test("empty-body boundary drains chunked requests instead of stopping after two chunks", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array());
      controller.enqueue(new Uint8Array());
      controller.enqueue(new TextEncoder().encode("unexpected"));
      controller.close();
    },
  });
  await assert.rejects(
    assertEmptyBody(new Request("https://hotfeed.test/api/auth/logout", { method: "POST", body: stream, duplex: "half" })),
    (error) => error instanceof RequestBoundaryError && error.code === "body_not_allowed",
  );
});

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(full));
    else result.push(full);
  }
  return result;
}

test("browser assets do not contain server-only environment names", async () => {
  const clientDir = fileURLToPath(new URL("../dist/client/", import.meta.url));
  const files = await filesBelow(clientDir);
  const text = (await Promise.all(files.filter((file) => /\.(?:js|html|css)$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
  for (const name of ["API_KEY", "PROTOTYPE_AUTH_EMAIL", "PROTOTYPE_AUTH_PASSWORD", "SESSION_SECRET"]) assert.doesNotMatch(text, new RegExp(name));
});
