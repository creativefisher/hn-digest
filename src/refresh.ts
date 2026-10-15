import { fetchTopStoryIds, fetchItems, fetchTopComments, itemToStory } from "./hn";
import { fetchArticleText } from "./fetchArticle";
import { summarizeStory } from "./summarize";
import {
  getSummary,
  putSummary,
  putFrontPage,
  mergeSummariesIntoStories,
  tryAcquireLock,
  releaseLock,
} from "./cache";
import type { Env, FrontPage, RefreshStats, Story } from "./types";

function num(env: Env, key: "TOP_N" | "SUMMARIES_PER_RUN", fallback: number): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Refresh frontpage metadata from HN, then summarize up to SUMMARIES_PER_RUN
 * stories that still need a summary. Designed for free-plan CPU limits:
 * page visits never call this; cron/admin do, in small batches.
 */
export async function refreshFrontPage(env: Env): Promise<FrontPage> {
  const gotLock = await tryAcquireLock(env, 120);
  if (!gotLock) {
    // Another refresh is running; return whatever we have after merging
    const { getFrontPage } = await import("./cache");
    const existing = await getFrontPage(env);
    if (existing) return existing;
  }

  const stats: RefreshStats = {
    fetched: 0,
    summarized: 0,
    unavailable: 0,
    pending: 0,
    errors: [],
  };

  try {
    const topN = Math.min(num(env, "TOP_N", 30), 30);
    const perRun = Math.min(num(env, "SUMMARIES_PER_RUN", 4), 6);

    const ids = await fetchTopStoryIds(topN);
    const items = await fetchItems(ids);
    // Preserve HN rank order
    const byId = new Map(items.map((i) => [i.id, i]));
    const stories: Story[] = [];
    let rank = 1;
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) continue;
      stories.push(itemToStory(item, rank++));
    }
    stats.fetched = stories.length;

    // Attach cached summaries
    let withSummaries = await mergeSummariesIntoStories(env, stories);

    // Persist frontpage early so visitors see fresh ranks even while AI runs
    let page: FrontPage = {
      updatedAt: Date.now(),
      stories: withSummaries,
      refreshStats: stats,
    };
    await putFrontPage(env, page);

    // Pick stories that need summarization (pending only; skip already ready/unavailable)
    const needWork = withSummaries.filter((s) => s.summaryStatus === "pending");
    const batch = needWork.slice(0, perRun);

    for (const story of batch) {
      try {
        // Double-check cache in case of race
        const existing = await getSummary(env, story.id);
        if (existing && existing.status !== "pending") continue;

        let articleText: string | null = null;
        if (story.url) {
          const fetched = await fetchArticleText(story.url);
          articleText = fetched.text;
          if (!fetched.text && fetched.reason) {
            // keep going — may fall back to comments/post
          }
        }

        let comments: string[] = [];
        // Only fetch comments if we need a fallback
        const needsFallback =
          (!articleText || articleText.length < 200) &&
          !(story.text && story.text.length >= 80);
        if (needsFallback) {
          const item = byId.get(story.id);
          comments = await fetchTopComments(item?.kids, 5);
        }

        const rec = await summarizeStory(env, story, articleText, comments);
        await putSummary(env, rec);

        if (rec.status === "ready") stats.summarized++;
        else stats.unavailable++;
      } catch (err) {
        stats.errors.push(
          `#${story.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        // Mark unavailable so we don't retry forever in a tight loop; cron will
        // still leave other pending stories for later runs.
        await putSummary(env, {
          id: story.id,
          status: "unavailable",
          summary: null,
          source: "none",
          updatedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
        stats.unavailable++;
      }
    }

    withSummaries = await mergeSummariesIntoStories(env, stories);
    stats.pending = withSummaries.filter((s) => s.summaryStatus === "pending").length;
    stats.unavailable = withSummaries.filter((s) => s.summaryStatus === "unavailable").length;
    // recounted ready via summarized this run; keep cumulative from statuses:
    // leave stats.summarized as "this run"

    page = {
      updatedAt: Date.now(),
      stories: withSummaries,
      refreshStats: stats,
    };
    await putFrontPage(env, page);
    return page;
  } finally {
    if (gotLock) await releaseLock(env);
  }
}
