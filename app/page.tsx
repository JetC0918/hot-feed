"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FeedCard } from "./components/FeedCard";
import { clearSummaryCache } from "./components/SummaryPopover";
import { FeedPicker, LoginDialog } from "./components/Dialogs";
import { AUTHENTICATED_SOURCE_IDS, DEFAULT_SOURCE_IDS, FEED_SOURCES, normalizePersistedSourceIds, SOURCE_SELECTION_VERSION, type FeedSource, type SortMode } from "@/lib/feed-data";

const FEED_STORAGE = "hotfeed-selected-sources-v2";

function customSource(id: string): FeedSource | null {
  const prefix = "custom-reddit-";
  if (!id.startsWith(prefix)) return null;
  const name = id.slice(prefix.length).toLowerCase();
  if (!/^[a-z0-9_]{2,21}$/.test(name) || id !== `${prefix}${name}`) return null;
  return { id, name: `Reddit (r/${name})`, kind: "reddit", color: "#23b5df", allowedHosts: ["reddit.com", "www.reddit.com"], posts: [], removable: true };
}

export default function Home() {
  const [sortMode, setSortMode] = useState<SortMode>("hot");
  const [isDark, setIsDark] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([...DEFAULT_SOURCE_IDS]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [logoutError, setLogoutError] = useState("");

  const applyAuthenticatedState = useCallback(() => {
    setAuthenticated(true);
    let saved: string[] | null = null;
    try { const raw = window.localStorage.getItem(FEED_STORAGE) ?? window.localStorage.getItem("hotfeed-selected-sources-v1"); if (raw) saved = normalizePersistedSourceIds(JSON.parse(raw)); } catch { /* Ignore invalid device-local preferences. */ }
    setSelectedIds(saved?.length ? saved : [...AUTHENTICATED_SOURCE_IDS]);
  }, []);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("hotfeed-theme");
    const dark = storedTheme !== "light";
    const themeFrame = window.requestAnimationFrame(() => { setIsDark(dark); document.documentElement.dataset.theme = dark ? "dark" : "light"; });
    const onExpired = () => { setAuthenticated(false); setSelectedIds([...DEFAULT_SOURCE_IDS]); setAuthEpoch((value) => value + 1); clearSummaryCache(); };
    window.addEventListener("hotfeed:auth-expired", onExpired);
    fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()).then((data: { authenticated?: boolean }) => { if (data.authenticated) applyAuthenticatedState(); }).catch(() => undefined).finally(() => setSessionLoaded(true));
    return () => { window.cancelAnimationFrame(themeFrame); window.removeEventListener("hotfeed:auth-expired", onExpired); };
  }, [applyAuthenticatedState]);

  const sources = useMemo(() => selectedIds.map((id) => FEED_SOURCES.find((source) => source.id === id) ?? customSource(id)).filter((source): source is FeedSource => Boolean(source)), [selectedIds]);
  const postCount = sources.reduce((sum, source) => sum + source.posts.length, 0);

  const toggleTheme = () => { const next = !isDark; setIsDark(next); document.documentElement.dataset.theme = next ? "dark" : "light"; window.localStorage.setItem("hotfeed-theme", next ? "dark" : "light"); };
  const saveFeeds = (ids: string[]) => { const normalized = normalizePersistedSourceIds(ids); setSelectedIds(normalized); window.localStorage.setItem(FEED_STORAGE, JSON.stringify({ version: SOURCE_SELECTION_VERSION, sourceIds: normalized })); };
  const addFeed = (id: string) => { if (!selectedIds.includes(id)) saveFeeds([...selectedIds, id]); setPickerOpen(false); };
  const removeFeed = (id: string) => saveFeeds(selectedIds.filter((item) => item !== id));
  const logout = async () => { setLogoutError(""); try { const response = await fetch("/api/auth/logout", { method: "POST" }); if (!response.ok) { setLogoutError("Could not sign out. Please try again."); return; } setAuthenticated(false); setSelectedIds([...DEFAULT_SOURCE_IDS]); setAuthEpoch((value) => value + 1); clearSummaryCache(); } catch { setLogoutError("Could not sign out. Check your connection and try again."); } };
  const refresh = () => { setRefreshing(true); window.setTimeout(() => { setRefreshTick((value) => value + 1); setLastRefreshed(new Date()); setRefreshing(false); }, 650); };

  return <div className="app-shell">
    <header className="site-header"><div className="container header-inner">
      <div className="brand-block"><div className="logo-mark" aria-hidden="true">♨</div><div><h1>HotFeed</h1><p>Reddit trend aggregator</p></div></div>
      <div className="header-actions">
        <span className="post-count" aria-live="polite">{postCount} posts</span>
        <button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}><span aria-hidden="true">{isDark ? "☾" : "☀"}</span></button>
        {authenticated ? <><button className="button button-secondary button-small" onClick={refresh} disabled={refreshing}><span aria-hidden="true">↻</span><span className="button-label"> {refreshing ? "Refreshing…" : "Refresh"}</span></button><button className="button button-secondary button-small" onClick={logout}><span aria-hidden="true">↪</span><span className="button-label"> Logout</span></button></> : <button className="button button-primary button-small" onClick={() => setLoginOpen(true)} disabled={!sessionLoaded}><span className="button-label">Sign In</span></button>}
      </div>
    </div></header>
    <section className="toolbar" aria-label="Feed sorting"><div className="container toolbar-inner"><span className="sort-label">Sort by:</span><div className="segmented-control"><button className={sortMode === "hot" ? "active" : ""} onClick={() => setSortMode("hot")} aria-pressed={sortMode === "hot"}>🔥 Hottest</button><button className={sortMode === "new" ? "active" : ""} onClick={() => setSortMode("new")} aria-pressed={sortMode === "new"}>▰ Newest</button></div>{authenticated && <span className="refresh-status" aria-live="polite">{lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Ready to refresh"}</span>}</div></section>
    <main className="container main-content">
      <div className={authenticated ? "feed-grid" : "guest-grid"} key={refreshTick}>
        {sources.map((source) => <FeedCard key={source.id} source={source} sortMode={sortMode} authenticated={authenticated} authEpoch={authEpoch} onRemove={authenticated && source.id !== DEFAULT_SOURCE_IDS[0] ? () => removeFeed(source.id) : undefined} />)}
        {authenticated && <button className="add-feed-card" onClick={() => setPickerOpen(true)}><span aria-hidden="true">＋</span><strong>Add Feed</strong><small>Reddit communities and curated sources</small></button>}
      </div>
      {!authenticated && <section className="guest-callout"><p>Guests can preview AI summaries for the top three posts.</p><button className="button button-primary button-large" onClick={() => setLoginOpen(true)}>Sign In for Full Access</button></section>}
      {logoutError && <p className="form-error" role="alert">{logoutError}</p>}
    </main>
    {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} onSuccess={() => { applyAuthenticatedState(); setSessionLoaded(true); setLoginOpen(false); }} />}
    {pickerOpen && <FeedPicker selected={selectedIds} onAdd={addFeed} onClose={() => setPickerOpen(false)} />}
  </div>;
}
