# HotFeed

HotFeed is a focused Reddit reader for viewing the hot or newest posts from a
single subreddit. It is a static Vite + React site with one Cloudflare Pages
Function that keeps Reddit OAuth credentials on the server.

## Requirements

- Node.js `>=22.13.0`
- A Reddit application with Data API access
- A Cloudflare account for Pages deployment

## Local setup

Install dependencies:

```bash
npm install
```

Create an ignored `.dev.vars` file from `.env.example` and fill in the three
server-only values:

```text
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USER_AGENT=web:hot-feed:0.2.0 (by /u/your_reddit_username)
```

Never prefix these names with `VITE_`; Vite exposes variables with that prefix
to browser code.

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

Add `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` under
the Pages project's **Settings → Variables and Secrets** for both production
and preview environments. No D1 database or binding is required.

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

Successful Reddit responses are normalized to a small browser-safe contract and
cached at the edge for two minutes. Upstream bodies and credentials are never
included in error responses.
