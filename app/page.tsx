import { FormEvent, useEffect, useState } from "react";
import type { FeedPost, FeedResponse, SortMode } from "../lib/feed-types";

type LoadState = "loading" | "ready" | "error";

type FeedError = {
  error?: {
    message?: string;
  };
};

export default function App() {
  const [subredditInput, setSubredditInput] = useState("technology");
  const [subreddit, setSubreddit] = useState("technology");
  const [resolvedSubreddit, setResolvedSubreddit] = useState("technology");
  const [sort, setSort] = useState<SortMode>("hot");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const storedTheme = window.localStorage.getItem("hotfeed-theme");
    return storedTheme
      ? storedTheme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, [isDark]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ subreddit, sort, limit: "25", feedVersion: "2" });

    fetch(`/api/reddit?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as FeedResponse | FeedError;
        if (!response.ok || !("posts" in payload)) {
          throw new Error("error" in payload ? payload.error?.message : undefined);
        }
        return payload;
      })
      .then((payload) => {
        setPosts(payload.posts);
        setResolvedSubreddit(payload.subreddit);
        setSubredditInput(payload.subreddit);
        setLoadState("ready");
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setPosts([]);
        setError(requestError instanceof Error && requestError.message !== "error"
          ? requestError.message
          : "Could not load this subreddit. Check the name and try again.");
        setLoadState("error");
      });

    return () => controller.abort();
  }, [refreshKey, sort, subreddit]);

  function submitSubreddit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = subredditInput.trim();
    if (!next) return;
    setLoadState("loading");
    setError("");
    if (next === subreddit) setRefreshKey((value) => value + 1);
    else setSubreddit(next);
  }

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.localStorage.setItem("hotfeed-theme", next ? "dark" : "light");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="/" aria-label="HotFeed home">
            <span className="brand-mark" aria-hidden="true">HF</span>
            <span>HotFeed</span>
          </a>
          <button className="theme-toggle" type="button" onClick={toggleTheme}>
            <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
            <span className="sr-only">Switch to {isDark ? "light" : "dark"} theme</span>
          </button>
        </div>
      </header>

      <main className="container main-content">
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">A calmer front page</p>
          <h1 id="page-title">Reddit, distilled.</h1>
          <p className="hero-copy">
            Pick a community and see what is rising now—without the rest of the noise.
          </p>

          <form className="subreddit-form" onSubmit={submitSubreddit}>
            <label htmlFor="subreddit">Subreddit</label>
            <div className="subreddit-field">
              <span aria-hidden="true">r/</span>
              <input
                id="subreddit"
                aria-label="Subreddit"
                value={subredditInput}
                onChange={(event) => setSubredditInput(event.target.value)}
                autoComplete="off"
                maxLength={23}
                spellCheck={false}
              />
              <button type="submit">Load feed</button>
            </div>
          </form>
        </section>

        <section className="feed-panel" aria-labelledby="feed-title">
          <div className="feed-toolbar">
            <div>
              <p className="feed-kicker">Browsing</p>
              <h2 id="feed-title">r/{resolvedSubreddit}</h2>
            </div>
            <div className="feed-actions">
              <div className="sort-control" aria-label="Post sorting">
                <button
                  type="button"
                  className={sort === "hot" ? "active" : ""}
                  aria-pressed={sort === "hot"}
                  onClick={() => {
                    setLoadState("loading");
                    setError("");
                    if (sort === "hot") setRefreshKey((value) => value + 1);
                    else setSort("hot");
                  }}
                >
                  Hot posts
                </button>
                <button
                  type="button"
                  className={sort === "new" ? "active" : ""}
                  aria-pressed={sort === "new"}
                  onClick={() => {
                    setLoadState("loading");
                    setError("");
                    if (sort === "new") setRefreshKey((value) => value + 1);
                    else setSort("new");
                  }}
                >
                  New posts
                </button>
              </div>
              <button
                className="refresh-button"
                type="button"
                onClick={() => {
                  setLoadState("loading");
                  setError("");
                  setRefreshKey((value) => value + 1);
                }}
                disabled={loadState === "loading"}
              >
                <span aria-hidden="true">↻</span> Refresh
              </button>
            </div>
          </div>

          <div className="feed-status" aria-live="polite">
            {loadState === "loading" && (
              <div className="state-card">
                <span className="spinner" aria-hidden="true" />
                <p>Loading r/{subreddit.replace(/^r\//i, "")}…</p>
              </div>
            )}
            {loadState === "error" && (
              <div className="state-card error-card" role="alert">
                <strong>Feed unavailable</strong>
                <p>{error}</p>
                <button type="button" onClick={() => {
                  setLoadState("loading");
                  setError("");
                  setRefreshKey((value) => value + 1);
                }}>Try again</button>
              </div>
            )}
            {loadState === "ready" && posts.length === 0 && (
              <div className="state-card"><strong>No posts found</strong><p>Try another community or refresh later.</p></div>
            )}
          </div>

          {loadState === "ready" && posts.length > 0 && (
            <ol className="post-list">
              {posts.map((post, index) => (
                <li key={post.id}>
                  <article className="post-card">
                    <span className="post-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                    <div className="post-body">
                      <div className="post-meta">
                        <span>u/{post.author}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString()}</time>
                      </div>
                      <h3><a href={post.outboundUrl} target="_blank" rel="noreferrer">{post.title}</a></h3>
                      <div className="post-footer">
                        <a href={post.permalink} target="_blank" rel="noreferrer">
                          Open Reddit discussion
                        </a>
                        <span className="source-label">Reddit RSS</span>
                      </div>
                    </div>
                    {post.thumbnailUrl && <img className="post-thumbnail" src={post.thumbnailUrl} alt="" loading="lazy" />}
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">Posts link to their original authors and discussions on Reddit.</div>
      </footer>
    </div>
  );
}
