import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("package and source tree describe a static Vite Pages app", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.dev, "vite");
  assert.equal(packageJson.scripts.build, "vite build");
  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit");
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.mjs");

  const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const dependency of [
    "vinext",
    "next",
    "drizzle-orm",
    "drizzle-kit",
    "@cloudflare/vite-plugin",
    "@vitejs/plugin-rsc",
    "react-server-dom-webpack",
  ]) {
    assert.equal(allDependencies[dependency], undefined, `${dependency} should be removed`);
  }

  const viteConfig = await readFile(path.join(root, "vite.config.ts"), "utf8");
  assert.doesNotMatch(viteConfig, /vinext|cloudflare|hosting\.json|worker\/index/i);
  assert.match(viteConfig, /react\(\)/);

  const functionPath = path.join(root, "functions", "api", "reddit.ts");
  assert.equal(existsSync(functionPath), true, "Pages Function should exist");
  const functionSource = await readFile(functionPath, "utf8");
  assert.match(functionSource, /handleRedditFeedRequest/);
});

test("environment template contains only an optional Reddit user agent", async () => {
  const template = await readFile(path.join(root, ".env.example"), "utf8");
  assert.match(template, /^REDDIT_USER_AGENT=/m);
  assert.doesNotMatch(template, /REDDIT_CLIENT_ID|REDDIT_CLIENT_SECRET/);
  assert.doesNotMatch(template, /API_KEY|PROTOTYPE_AUTH|SESSION_SECRET|DATABASE|\bDB=/);
});

async function sourceFilesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFilesBelow(fullPath));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

test("browser-owned modules do not reference Reddit credential names", async () => {
  const files = [
    ...await sourceFilesBelow(path.join(root, "app")),
    ...await sourceFilesBelow(path.join(root, "lib")),
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /REDDIT_CLIENT_ID|REDDIT_CLIENT_SECRET|REDDIT_USER_AGENT/);
});

test("production source has no Reddit OAuth credential boundary", async () => {
  const files = [
    ...await sourceFilesBelow(path.join(root, "app")),
    ...await sourceFilesBelow(path.join(root, "functions")),
    ...await sourceFilesBelow(path.join(root, "lib")),
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /REDDIT_CLIENT_ID|REDDIT_CLIENT_SECRET|access_token|oauth\.reddit\.com/);
});

test("Pages Function returns an edge-cached feed without contacting Reddit", async () => {
  const originalCaches = globalThis.caches;
  const cachedBody = { subreddit: "webdev", sort: "hot", posts: [] };
  let cacheMatches = 0;
  globalThis.caches = {
    default: {
      async match() {
        cacheMatches += 1;
        return Response.json(cachedBody, { headers: { "X-HotFeed-Cache": "HIT" } });
      },
      async put() {
        throw new Error("cache.put should not run on a hit");
      },
    },
  };

  try {
    const moduleUrl = new URL("../functions/api/reddit.ts", import.meta.url);
    moduleUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    const { onRequest } = await import(moduleUrl.href);
    const response = await onRequest({
      request: new Request("https://hotfeed.test/api/reddit?subreddit=webdev&sort=hot&limit=25"),
      env: {},
      waitUntil() {},
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-HotFeed-Cache"), "HIT");
    assert.deepEqual(await response.json(), cachedBody);
    assert.equal(cacheMatches, 1);
  } finally {
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("Pages Function canonicalizes cache keys to feed parameters", async () => {
  const originalCaches = globalThis.caches;
  const matchedUrls = [];
  globalThis.caches = {
    default: {
      async match(request) {
        matchedUrls.push(String(request.url ?? request));
        return Response.json({ subreddit: "webdev", sort: "new", posts: [] });
      },
      async put() {},
    },
  };

  try {
    const moduleUrl = new URL("../functions/api/reddit.ts", import.meta.url);
    moduleUrl.searchParams.set("canonical-test", `${process.pid}-${Date.now()}`);
    const { onRequest } = await import(moduleUrl.href);
    const response = await onRequest({
      request: new Request("https://hotfeed.test/api/reddit?subreddit=r%2FWebDev&sort=new&limit=25&feedVersion=2&diagnostic=ignored"),
      env: {},
      waitUntil() {},
    });
    assert.equal(response.status, 200);
    assert.equal(matchedUrls.length, 1);
    assert.match(matchedUrls[0], /\/__hotfeed-cache\/fresh\?/);
    assert.match(matchedUrls[0], /subreddit=webdev/);
    assert.match(matchedUrls[0], /sort=new/);
    assert.match(matchedUrls[0], /limit=25/);
    assert.doesNotMatch(matchedUrls[0], /feedVersion|diagnostic/);
  } finally {
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test("Pages Function serves a stale successful feed when Reddit is rate-limited", async () => {
  const originalCaches = globalThis.caches;
  const originalFetch = globalThis.fetch;
  const staleBody = { subreddit: "technology", sort: "new", posts: [{ id: "stale-post" }] };
  const matchedUrls = [];
  globalThis.caches = {
    default: {
      async match(request) {
        const url = String(request.url ?? request);
        matchedUrls.push(url);
        return url.includes("/__hotfeed-cache/stale?") ? Response.json(staleBody) : undefined;
      },
      async put() {},
    },
  };
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });

  try {
    const moduleUrl = new URL("../functions/api/reddit.ts", import.meta.url);
    moduleUrl.searchParams.set("stale-test", `${process.pid}-${Date.now()}`);
    const { onRequest } = await import(moduleUrl.href);
    const response = await onRequest({
      request: new Request("https://hotfeed.test/api/reddit?subreddit=technology&sort=new&limit=25&feedVersion=2"),
      env: {},
      waitUntil() {},
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-HotFeed-Cache"), "STALE");
    assert.match(response.headers.get("Warning") ?? "", /stale/i);
    assert.deepEqual(await response.json(), staleBody);
    assert.equal(matchedUrls.some((url) => url.includes("/__hotfeed-cache/stale?")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});
