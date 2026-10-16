export type SummaryStatus = "pending" | "ready" | "unavailable";

export interface Story {
  id: number;
  rank: number;
  title: string;
  url: string | null;
  domain: string | null;
  points: number;
  commentCount: number;
  author: string;
  time: number;
  type: string;
  text: string | null;
  summary: string | null;
  bullets?: string[];
  summaryStatus: SummaryStatus;
  summarySource?: "article" | "comments" | "post" | "none";
}

export interface FrontPage {
  updatedAt: number;
  stories: Story[];
  refreshStats?: RefreshStats;
}

export interface RefreshStats {
  fetched: number;
  summarized: number;
  unavailable: number;
  pending: number;
  errors: string[];
}

export interface SummaryRecord {
  id: number;
  status: SummaryStatus;
  /** One-sentence core takeaway */
  summary: string | null;
  /** Up to two short supporting facts */
  bullets: string[];
  source: "article" | "comments" | "post" | "none";
  updatedAt: number;
  error?: string;
}

export interface Env {
  CACHE: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  AI_MODEL: string;
  TOP_N: string;
  SUMMARIES_PER_RUN: string;
  ADMIN_SECRET: string;
}
