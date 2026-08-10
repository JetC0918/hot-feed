import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

test("client renders the focused Reddit feed controls without legacy gates", async () => {
  const source = await readFile(path.join(root, "app/page.tsx"), "utf8");
  assert.match(source, /Reddit, distilled/i);

  const vite = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(root) } },
  });

  try {
    const { default: App } = await vite.ssrLoadModule("/app/page.tsx");
    const html = renderToStaticMarkup(React.createElement(App));
    assert.match(html, /Reddit, distilled/i);
    assert.match(html, /aria-label="Subreddit"/i);
    assert.match(html, /Hot posts/i);
    assert.match(html, /New posts/i);
    assert.match(html, /Refresh/i);
    assert.doesNotMatch(html, /Sign In|AI summar|Add Feed/i);
  } finally {
    await vite.close();
  }
});

test("client versions feed requests so stale edge errors cannot persist across deployments", async () => {
  const source = await readFile(path.join(root, "app/page.tsx"), "utf8");
  assert.match(source, /feedVersion/);
  assert.match(source, /feedVersion\s*:\s*["']2["']/);
});
