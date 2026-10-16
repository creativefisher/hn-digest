import { limitSentences } from "./sentences";
import type { Env, SummaryRecord, Story } from "./types";

const UNAVAILABLE = "Summary unavailable";
const MAX_BULLETS = 2;
const MIN_TAKEAWAY_LEN = 12;
const MAX_TAKEAWAY_WORDS = 40;

export function buildPrompt(opts: {
  title: string;
  source: "article" | "comments" | "post";
  body: string;
}): { system: string; user: string } {
  const system =
    "You write glanceable digests of Hacker News stories for busy technical readers. " +
    "Output EXACTLY this shape, nothing else:\n" +
    "1) First line: one sentence that states the core message or insight (what a colleague needs to know). " +
    "Lead with the insight, not background. Roughly 15–25 words.\n" +
    "2) Then 1–2 lines, each starting with '- ', each a short supporting fact (not fluff, not 'the article discusses…').\n" +
    "Do not invent facts. Do not mention that you are an AI. No titles, headings, or numbered lists.";

  let lead: string;
  if (opts.source === "article") {
    lead = "Digest the following article.";
  } else if (opts.source === "post") {
    lead = "Digest this Hacker News post (Ask/Show/text post).";
  } else {
    lead =
      "The full article could not be fetched. Using the title and top comments, write a cautious digest of what the discussion appears to be about. " +
      "If there is not enough information, reply exactly: Summary unavailable";
  }

  const user = `${lead}\n\nTitle: ${opts.title}\n\nContent:\n${opts.body.slice(0, 6000)}`;
  return { system, user };
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^\s*[-*•]\s+/, "").trim();
}

function isBulletLine(line: string): boolean {
  return /^\s*[-*•]\s+\S/.test(line);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Parse model output into a one-line takeaway + up to 2 supporting bullets.
 */
export function normalizeSummary(raw: string): {
  summary: string | null;
  bullets: string[];
  status: "ready" | "unavailable";
} {
  const trimmed = (raw || "").trim();
  if (!trimmed || /^summary unavailable\.?$/i.test(trimmed)) {
    return { summary: null, bullets: [], status: "unavailable" };
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.replace(/^#{1,6}\s+/, "").trim())
    .filter(Boolean);

  let takeaway = "";
  const bullets: string[] = [];

  for (const line of lines) {
    if (isBulletLine(line)) {
      if (bullets.length < MAX_BULLETS) {
        const b = stripBulletPrefix(line).replace(/\s+/g, " ").trim();
        if (b) bullets.push(b);
      }
      continue;
    }
    if (!takeaway) {
      const candidate = line.replace(/\s+/g, " ").trim();
      // Skip leftover heading fragments / noise; first substantial prose is the takeaway
      if (candidate.length >= MIN_TAKEAWAY_LEN) takeaway = candidate;
    }
  }

  // Fallback: model returned a single paragraph with no newlines
  if (!takeaway && lines.length === 1) {
    takeaway = lines[0].replace(/\s+/g, " ").trim();
  }

  takeaway = limitSentences(takeaway, 1);
  if (wordCount(takeaway) > MAX_TAKEAWAY_WORDS) {
    takeaway = takeaway.split(/\s+/).slice(0, MAX_TAKEAWAY_WORDS).join(" ");
    if (!/[.!?]$/.test(takeaway)) takeaway += ".";
  }

  if (!takeaway || takeaway.length < MIN_TAKEAWAY_LEN) {
    return { summary: null, bullets: [], status: "unavailable" };
  }

  return { summary: takeaway, bullets, status: "ready" };
}

export async function runModel(env: Env, system: string, user: string): Promise<string> {
  const model = env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const result = (await env.AI.run(model as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 180,
    temperature: 0.2,
  })) as { response?: string };

  return (result?.response || "").trim();
}

export async function summarizeStory(
  env: Env,
  story: Story,
  articleText: string | null,
  comments: string[]
): Promise<SummaryRecord> {
  const now = Date.now();

  let source: SummaryRecord["source"] = "none";
  let body = "";

  if (articleText && articleText.length >= 200) {
    source = "article";
    body = articleText;
  } else if (story.text && story.text.length >= 80) {
    source = "post";
    body = story.text;
  } else if (comments.length > 0) {
    source = "comments";
    body = `Title: ${story.title}\n\nTop comments:\n` + comments.map((c, i) => `${i + 1}. ${c}`).join("\n\n");
  } else {
    return {
      id: story.id,
      status: "unavailable",
      summary: null,
      bullets: [],
      source: "none",
      updatedAt: now,
      error: "No article text, post body, or comments available",
    };
  }

  try {
    const { system, user } = buildPrompt({ title: story.title, source: source as "article" | "comments" | "post", body });
    const raw = await runModel(env, system, user);
    const { summary, bullets, status } = normalizeSummary(raw);
    return {
      id: story.id,
      status,
      summary: status === "ready" ? summary : null,
      bullets: status === "ready" ? bullets : [],
      source,
      updatedAt: now,
      error: status === "unavailable" ? UNAVAILABLE : undefined,
    };
  } catch (err) {
    return {
      id: story.id,
      status: "unavailable",
      summary: null,
      bullets: [],
      source,
      updatedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
