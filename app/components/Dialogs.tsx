"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { FEED_SOURCES, normalizeSubreddit } from "@/lib/feed-data";

function Modal({ titleId, children, onClose }: { titleId: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
    (focusable()[0] ?? ref.current)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { window.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section ref={ref} tabIndex={-1} className="login-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}><button className="modal-close" aria-label="Close dialog" onClick={onClose}>×</button>{children}</section></div>;
}

export function LoginDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) }); const data = await response.json() as { error?: string }; if (!response.ok) setError(data.error ?? "Sign in failed"); else onSuccess(); } catch { setError("Sign in is temporarily unavailable"); } finally { setBusy(false); }
  };
  return <Modal titleId="login-title" onClose={onClose}><h2 id="login-title">Welcome back</h2><p>Sign in to customize sources and summarize every story.</p><form onSubmit={submit}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required /><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary modal-submit" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button></form></Modal>;
}

export function FeedPicker({ selected, onAdd, onClose }: { selected: readonly string[]; onAdd: (id: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState(""); const [customError, setCustomError] = useState("");
  return <Modal titleId="picker-title" onClose={onClose}><h2 id="picker-title">Add a feed</h2><p>Choose a curated source or add a Reddit community.</p><div className="feed-picker-list">{FEED_SOURCES.map((source) => <button key={source.id} type="button" disabled={selected.includes(source.id)} onClick={() => onAdd(source.id)}><span className="source-dot" style={{ background: source.color }} />{source.name}<span>{selected.includes(source.id) ? "Added" : "+"}</span></button>)}</div><form className="custom-reddit" onSubmit={(event) => { event.preventDefault(); const name = normalizeSubreddit(custom); if (!name) return setCustomError("Enter a valid subreddit name"); onAdd(`custom-reddit-${name}`); setCustom(""); setCustomError(""); }}><label htmlFor="subreddit">Custom Reddit community</label><div><span>r/</span><input id="subreddit" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="webdev" /><button className="button button-primary">Add</button></div>{customError && <p className="form-error">{customError}</p>}</form></Modal>;
}
