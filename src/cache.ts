import type { Env, FrontPage, SummaryRecord, Story } from "./types";

const FRONT_KEY = "frontpage";
const META_KEY = "meta";
const LOCK_KEY = "refresh_lock";

export function summaryKey(id: number): string {
  return `summary:v2:${id}`;
}

export async function getFrontPage(env: Env): Promise<FrontPage | null> {
  const raw = await env.CACHE.get(FRONT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FrontPage;
  } catch {
    return null;
  }
}

export async function putFrontPage(env: Env, page: FrontPage): Promise<void> {
  await env.CACHE.put(FRONT_KEY, JSON.stringify(page));
  await env.CACHE.put(META_KEY, JSON.stringify({ updatedAt: page.updatedAt }));
}

export async function getSummary(env: Env, id: number): Promise<SummaryRecord | null> {
  const raw = await env.CACHE.get(summaryKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SummaryRecord;
  } catch {
    return null;
  }
}

export async function putSummary(env: Env, rec: SummaryRecord): Promise<void> {
  // Cache indefinitely; frontpage refresh will overwrite when story falls off
  await env.CACHE.put(summaryKey(rec.id), JSON.stringify(rec));
}

export async function mergeSummariesIntoStories(
  env: Env,
  stories: Story[]
): Promise<Story[]> {
  return Promise.all(
    stories.map(async (s) => {
      const rec = await getSummary(env, s.id);
      if (!rec) return { ...s, summary: null, bullets: [], summaryStatus: "pending" as const };
      return {
        ...s,
        summary: rec.summary,
        bullets: rec.bullets ?? [],
        summaryStatus: rec.status,
        summarySource: rec.source,
      };
    })
  );
}

/** Soft lock so overlapping cron/admin refreshes don't stampede. */
export async function tryAcquireLock(env: Env, ttlSeconds = 90): Promise<boolean> {
  const existing = await env.CACHE.get(LOCK_KEY);
  if (existing) {
    const ts = Number(existing);
    if (Number.isFinite(ts) && Date.now() - ts < ttlSeconds * 1000) return false;
  }
  await env.CACHE.put(LOCK_KEY, String(Date.now()), { expirationTtl: ttlSeconds });
  return true;
}

export async function releaseLock(env: Env): Promise<void> {
  await env.CACHE.delete(LOCK_KEY);
}
