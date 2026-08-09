export type SortMode = "hot" | "new";

export type FeedPost = {
  id: string;
  title: string;
  author: string;
  score: number;
  commentCount: number;
  createdAt: string;
  permalink: string;
  outboundUrl: string;
  isSelfPost: boolean;
  thumbnailUrl?: string;
};

export type FeedResponse = {
  subreddit: string;
  sort: SortMode;
  posts: FeedPost[];
};
