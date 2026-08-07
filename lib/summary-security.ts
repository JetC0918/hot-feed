import { getSource } from "./feed-data.ts";

const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const PRIVATE_V6 = /^(?:\[?::1\]?|\[?f[cd][0-9a-f]{2}:|\[?fe[89ab][0-9a-f]:)/i;

export function canonicalizeSourceUrl(rawUrl: string, sourceId: string) {
  const source = getSource(sourceId);
  if (!source) throw new Error("Unknown source");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Only public HTTPS URLs are supported");
  if (host === "localhost" || host.endsWith(".localhost") || PRIVATE_V4.test(host) || PRIVATE_V6.test(host)) throw new Error("Private network URLs are not supported");
  if (!source.allowedHosts.some((allowed) => host === allowed)) throw new Error("URL does not belong to this source");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}

export async function hashUrl(url: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function htmlToText(html: string) {
  return html.replace(/<(script|style|svg|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|quot|#39);/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchArticleExcerpt(initialUrl: string, sourceId: string, fetcher: typeof fetch = fetch) {
  let current = canonicalizeSourceUrl(initialUrl, sourceId);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetcher(current, { redirect: "manual", headers: { Accept: "text/html", "User-Agent": "HotFeed-Summary/1.0" }, signal: AbortSignal.timeout(7000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Invalid redirect");
      current = canonicalizeSourceUrl(new URL(location, current).toString(), sourceId);
      continue;
    }
    if (!response.ok) throw new Error("Article unavailable");
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) throw new Error("Article is not HTML");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 150_000) throw new Error("Article is too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Article body unavailable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 150_000) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 150_000) break;
      chunks.push(value);
    }
    await reader.cancel().catch(() => undefined);
    const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const text = htmlToText(new TextDecoder().decode(merged)).slice(0, 6000);
    if (text.length < 80) throw new Error("Article text unavailable");
    return text;
  }
  throw new Error("Too many redirects");
}
