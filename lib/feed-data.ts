export type SortMode = "hot" | "new";
export type SourceKind = "reddit" | "news" | "community";

export type FeedPost = {
  id: string;
  title: string;
  url: string;
  score: number;
  comments: number;
  author: string;
  ageHours: number;
};

export type FeedSource = {
  id: string;
  name: string;
  kind: SourceKind;
  color: string;
  allowedHosts: readonly string[];
  posts: readonly FeedPost[];
  removable?: boolean;
};

const makePosts = (
  source: string,
  host: string,
  titles: readonly string[],
  author: string,
): FeedPost[] =>
  titles.map((title, index) => ({
    id: `${source}-${index + 1}`,
    title,
    url: `https://${host}/${source}/${index + 1}`,
    score: 100 - index * 7,
    comments: Math.max(0, 64 - index * 9),
    author,
    ageHours: index === 0 ? 5 : index * 2,
  }));

const redditPosts: FeedPost[] = [
  ["Will there be an AI apocalypse? A closer look at the policy debate", 100, 46, "vox", 18, "1opghaq"],
  ["SoftBank sells its entire stake in Nvidia for $5.83 billion", 95, 31, "Franco1875", 2, "1ou41go"],
  ["OpenAI could be spending millions per day on generated video", 90, 82, "RioMovieFan11", 5, "1otng8q"],
  ["iPhone Air sales reportedly push the next version further out", 85, 27, "ControlCAD", 4, "1otrogc"],
  ["The head of the Cybertruck program has left Tesla", 80, 51, "chrisdh79", 1, "1ou6qxx"],
  ["AI coding tools are changing how software teams ship products", 74, 18, "future_stack", 7, "1demo6"],
  ["The race to build smaller, faster chips enters a new phase", 69, 24, "siliconwatch", 3, "1demo7"],
  ["Researchers unveil a more efficient battery recycling process", 63, 11, "green_tech", 8, "1demo8"],
] .map(([title, score, comments, author, ageHours, slug], index) => ({
  id: `reddit-technology-${index + 1}`,
  title: String(title), score: Number(score), comments: Number(comments), author: String(author), ageHours: Number(ageHours),
  url: `https://www.reddit.com/r/technology/comments/${slug}/`,
}));

const source = (
  id: string,
  name: string,
  kind: SourceKind,
  color: string,
  host: string,
  titles: readonly string[],
  author: string,
): FeedSource => ({ id, name, kind, color, allowedHosts: [host, `www.${host}`], posts: makePosts(id, host, titles, author), removable: true });

export const FEED_SOURCES: readonly FeedSource[] = [
  { id: "reddit-technology", name: "Reddit (r/technology)", kind: "reddit", color: "#ff4b1f", allowedHosts: ["reddit.com", "www.reddit.com"], posts: redditPosts },
  source("hacker-news", "Hacker News", "community", "#ff7a00", "news.ycombinator.com", ["Mario meets Pareto", "Unexpected things that are people", "The toy story you remember", "AMD acquires a compiler team", "Unix V4 tape found", "GitHub Actions and Pages are experiencing degraded service"], "community"),
  source("v2ex", "V2EX", "community", "#3b82f6", "v2ex.com", ["Building a calm personal knowledge system", "An open-source release for keyboard workflows", "What changed after adopting local-first tools", "Developer survey: the tools people keep", "Why this small utility became essential", "A practical guide to better terminal habits"], "members"),
  source("lobsters", "Lobsters", "community", "#25b8e6", "lobste.rs", ["Too lazy, didn't validate: meetings left open", "Zig's threaded runtime is neat", "A shell exclamation mark is not for yelling", "A tour of the latest browser internals", "Parsing data without losing context", "Taste is all that's left"], "community"),
  source("ars-technica", "Ars Technica", "news", "#3478f6", "arstechnica.com", ["Organ donation group accused of trying to take living man's organs", "Explosive drone found hovering near aircraft", "Advertisers ask circuit to overrule privacy decision", "Watermarks for AI-generated media gain support", "A cloud provider designs its own hardware", "Large genome models used to design viruses"], "Ars staff"),
  source("bbc-news", "BBC News", "news", "#23b5df", "bbc.com", ["Officer who led investigation applauds verdict", "Arrests follow a night of disorder", "Regulator issues largest child safety ruling", "Leaders trade sharp words over weapons shortage", "Artificial intelligence used to design new vaccines", "Village sees weeks without rain during heatwave"], "BBC"),
  source("nytimes", "NYTimes", "news", "#aab4c4", "nytimes.com", ["Executive orders reshape technology policy", "Administration faces a deregulation deadline", "Company ordered to pay a record fine", "Republican challenger wins a close nomination", "How cities are planning for a hotter future", "Inside the rehabilitation facility debate"], "News desk"),
  source("techcrunch", "TechCrunch", "news", "#3182f6", "techcrunch.com", ["A new AI smart speaker may sell for less", "Your table awaits at the startup showcase", "Hardware company receives another approval", "Get up to $400 off a conference pass", "Hackers are calling financial firm employees", "Open-source robotics startup raises a new round"], "TechCrunch"),
  source("the-verge", "The Verge", "news", "#21b9e6", "theverge.com", ["Google's Pixel launch event has a familiar host", "A tiny AI gadget is reportedly puck-sized", "The latest earbuds reach their best price", "Movie casting hints at more adaptations", "Music startup shares a plan to combat spam", "Broadcast consolidation receives approval"], "The Verge"),
  source("product-hunt", "Product Hunt", "community", "#22b8e6", "producthunt.com", ["Vibe code business operations", "The open-source Ahrefs alternative", "Warm your prospects before reaching out", "Prevent product drift in AI-written code", "Shared memory across apps and agents", "Open-source workspace for AI workflows"], "makers"),
  { id: "reddit-programming", name: "programming", kind: "reddit", color: "#23b5df", allowedHosts: ["reddit.com", "www.reddit.com"], posts: [], removable: true },
  { id: "reddit-vibecoding", name: "vibecoding", kind: "reddit", color: "#23b5df", allowedHosts: ["reddit.com", "www.reddit.com"], posts: [], removable: true },
] as const;

export const DEFAULT_SOURCE_IDS = ["reddit-technology"] as const;
export const AUTHENTICATED_SOURCE_IDS = FEED_SOURCES.slice(0, 10).map((item) => item.id);

export function getSource(sourceId: string) {
  return FEED_SOURCES.find((item) => item.id === sourceId);
}

export function sortPosts(posts: readonly FeedPost[], mode: SortMode) {
  return [...posts].sort((a, b) => mode === "hot" ? b.score - a.score : a.ageHours - b.ageHours);
}

export function getRankedPost(sourceId: string, mode: SortMode, rank: number) {
  const source = getSource(sourceId);
  if (!source || !Number.isInteger(rank) || rank < 1) return null;
  return sortPosts(source.posts, mode)[rank - 1] ?? null;
}

export function normalizeSubreddit(value: string) {
  const name = value.trim().replace(/^r\//i, "").toLowerCase();
  return /^[a-z0-9_]{2,21}$/.test(name) ? name : null;
}
