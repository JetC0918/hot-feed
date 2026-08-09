# HotFeed

HotFeed is a focused Reddit reader for viewing the hot or newest posts from a
single subreddit. It is a static Vite + React site with one Cloudflare Pages
Function that proxies Reddit's public RSS feed.

## Requirements

- Node.js `>=22.13.0`
- A Cloudflare account for Pages deployment

## Local setup

Install dependencies:

```bash
npm install
```

Create an ignored `.dev.vars` file from `.env.example` if you want to customize
the User-Agent. The value is optional because the Function has a safe default:

```text
REDDIT_USER_AGENT=web:hot-feed:0.2.0 (RSS reader)
```

Do not put secrets in browser-exposed `VITE_` variables.

Run the full Pages application locally:

```bash
npm run pages:dev
```

`npm run dev` starts the Vite client only and is useful for UI work when an API
proxy is already available.

## Cloudflare Pages deployment

Import this repository in **Workers & Pages → Create application → Pages** and
use:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: leave blank
- Node version: 22

No Reddit secrets or database bindings are required. You may add
`REDDIT_USER_AGENT` under the Pages project's **Settings → Variables and
Secrets** for production and preview, or use the built-in default.

Cloudflare automatically deploys `functions/api/reddit.ts` alongside the static
assets. You can also deploy from an authenticated local Wrangler session:

```bash
npm run deploy
```

## Commands

- `npm run dev` — run the Vite client
- `npm run pages:dev` — build and run Pages plus the Reddit function locally
- `npm test` — run API, UI, and deployment contract tests
- `npm run lint` — lint the project
- `npm run typecheck` — type-check without emitting files
- `npm run build` — produce the static `dist` directory
- `npm run deploy` — build and deploy to the `hot-feed` Pages project

## API

`GET /api/reddit?subreddit=technology&sort=hot&limit=25`

- `subreddit`: 2–21 letters, numbers, or underscores; `r/` is accepted
- `sort`: `hot` or `new`
- `limit`: 1–50

Successful RSS responses are normalized to a small browser-safe contract and
cached at the edge for two minutes. RSS does not reliably provide score or
comment counts, so the UI links to the Reddit discussion instead.
