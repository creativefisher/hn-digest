/**
 * Cheap article text extraction via HTMLRewriter streaming.
 * Avoids DOMParser / cheerio which blow Workers CPU on free plan.
 */

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "button",
]);

export class TextCollector {
  private chunks: string[] = [];
  private skipping = 0;
  private maxChars: number;
  truncated = false;

  constructor(maxChars = 8000) {
    this.maxChars = maxChars;
  }

  get length(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0);
  }

  push(text: string): void {
    if (this.skipping > 0 || this.truncated) return;
    const t = text.replace(/\s+/g, " ");
    if (!t.trim()) return;
    const room = this.maxChars - this.length;
    if (room <= 0) {
      this.truncated = true;
      return;
    }
    if (t.length > room) {
      this.chunks.push(t.slice(0, room));
      this.truncated = true;
    } else {
      this.chunks.push(t);
    }
  }

  enterSkip(): void {
    this.skipping++;
  }

  leaveSkip(): void {
    if (this.skipping > 0) this.skipping--;
  }

  toString(): string {
    return this.chunks.join(" ").replace(/\s+/g, " ").trim();
  }
}

/**
 * Extract readable text from an HTML Response using HTMLRewriter.
 * Returns empty string on failure / non-HTML.
 */
export async function extractTextFromHtml(
  response: Response,
  maxChars = 8000
): Promise<string> {
  const ctype = response.headers.get("content-type") || "";
  if (ctype && !/html|text\/plain|xml/i.test(ctype) && !ctype.includes("charset")) {
    // likely binary
    if (/pdf|image|octet|zip|video|audio/i.test(ctype)) return "";
  }

  const collector = new TextCollector(maxChars);

  // Track skip tags with nested counter using element handlers that remove content
  const rewriter = new HTMLRewriter();
  let depth = 0;

  const skipHandler = {
    element(el: Element) {
      depth++;
      el.onEndTag(() => {
        depth--;
      });
      el.remove();
    },
  };
  for (const tag of SKIP_TAGS) {
    rewriter.on(tag, skipHandler);
  }

  rewriter.on("p, h1, h2, h3, h4, li, blockquote, td, th, figcaption, article, main", {
    text(t) {
      if (depth === 0) collector.push(t.text);
    },
  });

  // Consume the stream through the rewriter
  const transformed = rewriter.transform(response);
  // Drain body so handlers run
  await transformed.arrayBuffer();

  return collector.toString();
}

/** Pure helper for unit tests: strip tags with a regex (not used in Worker). */
export function stripTagsRough(html: string, maxChars = 8000): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return withoutNoise.slice(0, maxChars);
}
