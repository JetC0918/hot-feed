# HotFeed

HotFeed is a lightweight Reddit reader for people who want the useful part of a
subreddit without the surrounding noise. Enter a community, switch between its
**hot** and **new** posts, and open anything interesting in the original Reddit
discussion.

**Live app:** [hot-feed.jetnyee.my](https://hot-feed.jetnyee.my/)

## What the app does

- Loads up to 25 posts from any valid public subreddit.
- Switches between Reddit's hot and newest feeds.
- Shows titles, authors, publication times, and links to the original threads.
- Includes light and dark themes, with the preference saved in the browser.
- Requires no Reddit login, account access, or OAuth credentials.

The interface is intentionally focused: it is designed for quickly scanning a
community rather than reproducing Reddit's full feature set.

## Tech stack

| Layer | Technology | Role |
| --- | --- | --- |
| UI | React 19 + TypeScript | Component rendering, feed state, theme preference, and interactions |
| Build | Vite 8 | Local development and optimized static production assets |
| Hosting | Cloudflare Pages | Serves the frontend from Cloudflare's edge network |
| API | Cloudflare Pages Functions | Validates feed requests and keeps Reddit XML away from the browser |
| Data source | Reddit Atom/RSS | Supplies public `hot` and `new` subreddit listings without OAuth |
| Resilience | Cloudflare Cache API | Provides a 10-minute fresh cache and a 24-hour fallback cache |
| Tooling | Wrangler, ESLint, Node test runner | Local Pages runtime, code quality, contract tests, and deployment |

## Architecture

```text
Browser
  -> GET /api/reddit?subreddit=technology&sort=hot&limit=25
  -> Cloudflare Pages Function
  -> Reddit Atom/RSS feed
  -> validated and normalized FeedResponse JSON
  -> React feed UI
```

The browser never fetches or parses Reddit XML directly. The Pages Function is
the server boundary: it validates query parameters, requests the public feed
with a descriptive User-Agent, supports both Atom and RSS 2.0, filters invalid
entries, and returns a stable JSON shape to the client.

### Edge-cache behavior

Cache identity is based only on the normalized `subreddit`, `sort`, and `limit`
values, so unrelated query parameters do not create extra Reddit requests.

- Successful feeds are fresh at the edge for 10 minutes.
- The same response is retained as a fallback for 24 hours.
- A fresh hit returns `X-HotFeed-Cache: HIT` without contacting Reddit.
- If Reddit times out or rate-limits a refresh, HotFeed can return the last
  successful feed with `X-HotFeed-Cache: STALE` instead of showing an outage.

This matters because Reddit may throttle repeated RSS requests from shared
Cloudflare infrastructure.

## Project structure

```text
app/page.tsx                 React UI and client-side feed state
app/globals.css              Responsive layout, themes, and component styles
functions/api/reddit.ts      Public Pages Function and edge-cache orchestration
functions/_lib/reddit.ts     Query validation, Reddit fetch, and XML normalization
lib/feed-types.ts            Browser-safe feed contract shared across boundaries
tests/                       API, client, cache, and deployment contract tests
```

## Run locally

### Requirements

- Node.js `>=22.13.0`
- npm

Install dependencies:

```bash
npm install
```

Run the complete Pages app, including `/api/reddit`:

```bash
npm run pages:dev
```

For frontend-only work, `npm run dev` starts Vite without the Pages Function.

### Optional environment variable

The API has a safe default User-Agent. To customize it, copy `.env.example` to
an ignored `.dev.vars` file and set:

```text
REDDIT_USER_AGENT=web:hot-feed:0.2.0 (RSS reader)
```

No Reddit client ID, client secret, access token, database, or browser-exposed
`VITE_` credential is required.

## API contract

```http
GET /api/reddit?subreddit=technology&sort=hot&limit=25
```

| Parameter | Accepted values | Default |
| --- | --- | --- |
| `subreddit` | 2-21 letters, numbers, or underscores; optional `r/` prefix | `technology` |
| `sort` | `hot` or `new` | `hot` |
| `limit` | Integer from 1 to 50 | `25` |

Example successful response:

```json
{
  "subreddit": "technology",
  "sort": "hot",
  "posts": [
    {
      "id": "example",
      "title": "Example post title",
      "author": "example_user",
      "createdAt": "2026-08-11T08:00:00.000Z",
      "permalink": "https://www.reddit.com/r/technology/comments/example/",
      "outboundUrl": "https://www.reddit.com/r/technology/comments/example/"
    }
  ]
}
```

Reddit's public feeds do not reliably include scores, comment counts,
thumbnails, or self-post metadata. HotFeed therefore treats those fields as
optional and links users to Reddit for the complete discussion.

## Quality checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The test suite covers query validation, Atom/RSS normalization, safe Reddit
links, error responses, cache fallback behavior, client/API compatibility, and
Cloudflare deployment assumptions.

## Deploy to Cloudflare Pages

Import the repository in **Workers & Pages -> Create application -> Pages** and
use these settings:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank |
| Node version | `22` |

Cloudflare deploys the static Vite output and the `functions/` directory
together. No bindings or secrets are required. An optional
`REDDIT_USER_AGENT` can be added under **Settings -> Variables and Secrets** for
both production and preview environments.

To deploy from an authenticated Wrangler session instead:

```bash
npm run deploy
```

## Available scripts

- `npm run dev` - start the Vite client.
- `npm run pages:dev` - build and run the client with Pages Functions locally.
- `npm run preview` - preview an existing production build.
- `npm test` - run the contract test suite.
- `npm run lint` - run ESLint.
- `npm run typecheck` - type-check without emitting files.
- `npm run build` - create the production `dist` directory.
- `npm run deploy` - build and deploy to the `hot-feed` Pages project.
