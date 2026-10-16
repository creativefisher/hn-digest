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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Workers KV: max one write per key per second — pace frontpage + meta writes. */
async function putFrontPagePaced(
  env: Env,
  page: FrontPage,
  lastWriteAt: { ms: number }
): Promise<void> {
  const elapsed = Date.now() - lastWriteAt.ms;
  if (lastWriteAt.ms > 0 && elapsed < 1100) {
    await sleep(1100 - elapsed);
  }
  await putFrontPage(env, page);
  lastWriteAt.ms = Date.now();
}

function applySummary(stories: Story[], storyId: number, patch: Partial<Story>): Story[] {
  return stories.map((s) => (s.id === storyId ? { ...s, ...patch } : s));
}

/**
 * Refresh frontpage metadata from HN, then summarize up to SUMMARIES_PER_RUN
 * stories that still need a summary. Designed for free-plan CPU limits:
 * page visits never wait on AI; cron/admin/background refresh do, in small batches.
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
  const lastFrontWrite = { ms: 0 };

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

    // Attach cached summaries (includes putSummary results from prior/partial runs)
    let withSummaries = await mergeSummariesIntoStories(env, stories);

    // Persist frontpage early so visitors see fresh ranks even while AI runs
    let page: FrontPage = {
      updatedAt: Date.now(),
      stories: withSummaries,
      refreshStats: stats,
    };
    await putFrontPagePaced(env, page, lastFrontWrite);

    // Pick stories that need summarization (pending only; skip already ready/unavailable)
    const needWork = withSummaries.filter((s) => s.summaryStatus === "pending");
    const batch = needWork.slice(0, perRun);

    for (const story of batch) {
      try {
        // Double-check cache in case of race
        const existing = await getSummary(env, story.id);
        if (existing && existing.status !== "pending") {
          withSummaries = applySummary(withSummaries, story.id, {
            summary: existing.summary,
            bullets: existing.bullets ?? [],
            summaryStatus: existing.status,
            summarySource: existing.source,
          });
          continue;
        }

        let articleText: string | null = null;
        if (story.url) {
          const fetched = await fetchArticleText(story.url);
          articleText = fetched.text;
        }

        let comments: string[] = [];
        // Only fetch comments if we need a fallback
        const needsFallback =
          (!articleText || articleText.length < 200) &&
          !(story.text && story.text.length >= 80);
        if (needsFallback) {
          const item = byId.get(story.id);
          // Free plan: 50 subrequests/invocation. Keep comment fan-out tiny.
          comments = await fetchTopComments(item?.kids, 3);
        }

        const rec = await summarizeStory(env, story, articleText, comments);
        await putSummary(env, rec);

        if (rec.status === "ready") stats.summarized++;
        else stats.unavailable++;

        // Keep memory in sync; frontpage is written once at the end (KV write-rate safe).
        // putSummary alone is enough for the next refresh to pick up mid-batch progress.
        withSummaries = applySummary(withSummaries, story.id, {
          summary: rec.summary,
          bullets: rec.bullets ?? [],
          summaryStatus: rec.status,
          summarySource: rec.source,
        });
      } catch (err) {
        stats.errors.push(
          `#${story.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        // Only mark unavailable when summarization itself failed — not on frontpage write errors.
        const failRec = {
          id: story.id,
          status: "unavailable" as const,
          summary: null,
          bullets: [] as string[],
          source: "none" as const,
          updatedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        };
        try {
          await putSummary(env, failRec);
        } catch (putErr) {
          stats.errors.push(
            `#${story.id} putSummary: ${putErr instanceof Error ? putErr.message : String(putErr)}`
          );
        }
        withSummaries = applySummary(withSummaries, story.id, {
          summary: null,
          bullets: [],
          summaryStatus: "unavailable",
          summarySource: "none",
        });
        stats.unavailable++;
      }
    }

    // Use in-memory withSummaries (not a fresh KV merge) — Workers KV can return
    // stale reads right after putSummary and would wipe ready digests back to pending.
    stats.pending = withSummaries.filter((s) => s.summaryStatus === "pending").length;
    stats.unavailable = withSummaries.filter((s) => s.summaryStatus === "unavailable").length;

    page = {
      updatedAt: Date.now(),
      stories: withSummaries,
      refreshStats: stats,
    };
    await putFrontPagePaced(env, page, lastFrontWrite);
    return page;
  } finally {
    if (gotLock) await releaseLock(env);
  }
}
