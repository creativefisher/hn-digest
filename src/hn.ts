import type { Story } from "./types";

const HN_API = "https://hacker-news.firebaseio.com/v0";

export interface HnItem {
  id: number;
  deleted?: boolean;
  type?: string;
  by?: string;
  time?: number;
  text?: string;
  dead?: boolean;
  parent?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  descendants?: number;
}

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchTopStoryIds(limit = 30): Promise<number[]> {
  const res = await fetch(`${HN_API}/topstories.json`);
  if (!res.ok) throw new Error(`HN topstories failed: ${res.status}`);
  const ids = (await res.json()) as number[];
  return ids.slice(0, limit);
}

export async function fetchItem(id: number): Promise<HnItem | null> {
  const res = await fetch(`${HN_API}/item/${id}.json`);
  if (!res.ok) return null;
  return (await res.json()) as HnItem;
}

export async function fetchItems(ids: number[]): Promise<HnItem[]> {
  const results = await Promise.all(ids.map((id) => fetchItem(id)));
  return results.filter((x): x is HnItem => !!x && !x.deleted && !x.dead);
}

export async function fetchTopComments(kids: number[] | undefined, max = 5): Promise<string[]> {
  if (!kids?.length) return [];
  const items = await fetchItems(kids.slice(0, max));
  return items
    .filter((i) => i.type === "comment" && i.text)
    .map((i) => decodeHtmlEntities(i.text!))
    .filter((t) => t.length > 40);
}

export function itemToStory(item: HnItem, rank: number): Story {
  const url = item.url || null;
  return {
    id: item.id,
    rank,
    title: item.title || "(untitled)",
    url,
    domain: domainFromUrl(url),
    points: item.score ?? 0,
    commentCount: item.descendants ?? 0,
    author: item.by || "unknown",
    time: item.time ?? 0,
    type: item.type || "story",
    text: item.text ? decodeHtmlEntities(item.text) : null,
    summary: null,
    summaryStatus: "pending",
  };
}
