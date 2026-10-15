import type { Env, FrontPage } from "./types";
import { getFrontPage } from "./cache";
import { refreshFrontPage } from "./refresh";

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
      ...extra,
    },
  });
}

function emptyPage(): FrontPage {
  return { updatedAt: 0, stories: [] };
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/stories" && request.method === "GET") {
    const page = (await getFrontPage(env)) || emptyPage();
    // Never block on AI — if empty, kick off a background refresh once
    if (!page.stories.length) {
      ctx.waitUntil(
        refreshFrontPage(env).catch((e) => console.error("bootstrap refresh", e))
      );
    }
    return json({
      updatedAt: page.updatedAt,
      stories: page.stories,
      count: page.stories.length,
    });
  }

  if (path === "/api/health" && request.method === "GET") {
    const page = await getFrontPage(env);
    return json({
      ok: true,
      updatedAt: page?.updatedAt ?? null,
      stories: page?.stories.length ?? 0,
      ready: page?.stories.filter((s) => s.summaryStatus === "ready").length ?? 0,
      pending: page?.stories.filter((s) => s.summaryStatus === "pending").length ?? 0,
      unavailable: page?.stories.filter((s) => s.summaryStatus === "unavailable").length ?? 0,
    });
  }

  if (path === "/api/refresh" && (request.method === "POST" || request.method === "GET")) {
    const key =
      url.searchParams.get("key") ||
      request.headers.get("x-admin-key") ||
      "";
    if (!env.ADMIN_SECRET || key !== env.ADMIN_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }
    // Run refresh in-request so admin can see results; cron uses scheduled handler
    try {
      const page = await refreshFrontPage(env);
      return json({
        ok: true,
        updatedAt: page.updatedAt,
        stats: page.refreshStats,
        ready: page.stories.filter((s) => s.summaryStatus === "ready").length,
        pending: page.stories.filter((s) => s.summaryStatus === "pending").length,
        unavailable: page.stories.filter((s) => s.summaryStatus === "unavailable").length,
        count: page.stories.length,
      });
    } catch (err) {
      return json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        500
      );
    }
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx);
    }

    // Static UI
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refreshFrontPage(env)
        .then((page) => {
          console.log(
            JSON.stringify({
              msg: "cron refresh",
              count: page.stories.length,
              stats: page.refreshStats,
            })
          );
        })
        .catch((e) => console.error("cron refresh failed", e))
    );
  },
};
