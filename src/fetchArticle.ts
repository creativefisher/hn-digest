import { extractTextFromHtml } from "./extract";

const UA =
  "HNDigestBot/1.0 (+https://hn-digest.ramanduke.workers.dev; personal reader summaries)";

export interface FetchArticleResult {
  text: string | null;
  reason?: string;
}

export async function fetchArticleText(url: string): Promise<FetchArticleResult> {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) {
      return { text: null, reason: "non-http url" };
    }
    // Skip obvious non-article targets
    if (/\.(pdf|zip|png|jpe?g|gif|webp|mp4|mp3)(\?|$)/i.test(u.pathname)) {
      return { text: null, reason: "binary resource" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), 8000);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return { text: null, reason: `http ${res.status}` };
    }

    const ctype = res.headers.get("content-type") || "";
    if (/pdf|octet-stream|image|video|audio|zip/i.test(ctype)) {
      return { text: null, reason: `content-type ${ctype}` };
    }

    // Cap download size by only reading first ~150KB via a tee + cancel
    const reader = res.body?.getReader();
    if (!reader) return { text: null, reason: "empty body" };

    const chunks: Uint8Array[] = [];
    let total = 0;
    const MAX = 150_000;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total >= MAX) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const html = new TextDecoder("utf-8").decode(merged);
    // Build a fake Response for HTMLRewriter
    const fake = new Response(html, {
      headers: { "content-type": ctype || "text/html; charset=utf-8" },
    });
    const text = await extractTextFromHtml(fake, 8000);
    if (!text || text.length < 200) {
      return { text: null, reason: "insufficient extractable text" };
    }
    return { text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: null, reason: msg };
  }
}
