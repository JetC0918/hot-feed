"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FeedPost, SortMode } from "@/lib/feed-data";

type SummaryState = { status: "idle" | "loading" | "loaded" | "error"; summary?: string; basis?: string; error?: string; retryable?: boolean };
const cache = new Map<string, SummaryState>();
const pending = new Map<string, Promise<SummaryState>>();
let cacheGeneration = 0;

export function clearSummaryCache() {
  cacheGeneration += 1;
  cache.clear();
  pending.clear();
}

export function SummaryPopover({ post, sourceId, rank, sortMode, eligible, children }: { post: FeedPost; sourceId: string; rank: number; sortMode: SortMode; eligible: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SummaryState>(() => cache.get(post.url) ?? { status: "idle" });
  const intentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    if (!eligible || state.status === "loading" || state.status === "loaded") return;
    const generation = cacheGeneration;
    const loading: SummaryState = { status: "loading" };
    setState(loading);
    let request = pending.get(post.url);
    if (!request) {
      let tracked: Promise<SummaryState> = (async (): Promise<SummaryState> => {
        try {
          const response = await fetch("/api/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: post.url, title: post.title, sourceId, rank, sortMode }) });
          const data = await response.json() as { summary?: string; basis?: string; error?: string; retryable?: boolean };
          if (response.status === 401 || response.status === 403) window.dispatchEvent(new Event("hotfeed:auth-expired"));
          return response.ok && data.summary ? { status: "loaded", summary: data.summary, basis: data.basis } : { status: "error", error: data.error ?? "Summary unavailable", retryable: data.retryable };
        } catch { return { status: "error", error: "Summary unavailable", retryable: true }; }
      })();
      tracked = tracked.finally(() => {
        if (pending.get(post.url) === tracked) pending.delete(post.url);
      });
      request = tracked;
      pending.set(post.url, request);
    }
    const next = await request;
    if (generation !== cacheGeneration) return;
    cache.set(post.url, next); setState(next);
  };

  const showWithIntent = () => { setOpen(true); intentTimer.current = setTimeout(load, 350); };
  const hide = () => { if (intentTimer.current) clearTimeout(intentTimer.current); setOpen(false); };
  const showNow = () => { if (intentTimer.current) clearTimeout(intentTimer.current); setOpen(true); void load(); };
  useEffect(() => () => { if (intentTimer.current) clearTimeout(intentTimer.current); }, []);

  return (
    <span className="summary-wrap" onMouseEnter={showWithIntent} onMouseLeave={hide} onFocus={showNow} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hide(); }}>
      {children}
      <button className="summary-trigger" type="button" aria-label={`AI summary for ${post.title}`} aria-expanded={open} onClick={() => open ? hide() : showNow()}>AI</button>
      {open && <span className="summary-popover" role="status">
        <strong>AI quick take</strong>
        {!eligible && <><span>Guest summaries are available for the top three posts.</span><span className="summary-note">Sign in for every story.</span></>}
        {eligible && state.status === "idle" && <span>Preparing summary…</span>}
        {eligible && state.status === "loading" && <span className="summary-loading">Reading the story…</span>}
        {state.status === "loaded" && <><span>{state.summary}</span>{state.basis === "metadata" && <span className="summary-note">Based on title and source metadata.</span>}</>}
        {state.status === "error" && <><span>{state.error}</span>{state.retryable && <button type="button" className="summary-retry" onClick={() => { cache.delete(post.url); setState({ status: "idle" }); setTimeout(load, 0); }}>Try again</button>}</>}
      </span>}
    </span>
  );
}
