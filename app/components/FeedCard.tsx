"use client";

import type { FeedSource, SortMode } from "@/lib/feed-data";
import { sortPosts } from "@/lib/feed-data";
import { SummaryPopover } from "./SummaryPopover";

export function FeedCard({ source, sortMode, authenticated, onRemove }: { source: FeedSource; sortMode: SortMode; authenticated: boolean; onRemove?: () => void }) {
  const posts = sortPosts(source.posts, sortMode);
  return <section className="feed-card dashboard-card" aria-labelledby={`feed-${source.id}`}>
    <div className="feed-heading-row">
      <span className="source-dot" style={{ background: source.color }} aria-hidden="true" />
      <h2 id={`feed-${source.id}`}>{source.name}</h2>
      {onRemove && <button className="remove-feed" onClick={onRemove} aria-label={`Remove ${source.name}`}>×</button>}
    </div>
    {posts.length ? <ol className="feed-list">
      {posts.map((post, index) => <li key={post.id} className="post-row">
        <span className="rank" aria-label={`Rank ${index + 1}`} style={{ background: source.color }}>{index + 1}</span>
        <SummaryPopover post={post} sourceId={source.id} rank={index + 1} sortMode={sortMode} eligible={authenticated || index < 3}>
          <span className="post-copy">
            <a href={post.url} target="_blank" rel="noreferrer" className="post-title">{post.title}</a>
            <span className="post-meta"><span>{post.score} ↑</span><span>•</span><span>{post.comments} comments</span><span>•</span><span>{post.author}</span></span>
          </span>
        </SummaryPopover>
      </li>)}
    </ol> : <div className="empty-feed">No posts yet</div>}
  </section>;
}
