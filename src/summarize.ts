import { limitSentences } from "./sentences";
import type { Env, SummaryRecord, Story } from "./types";

const UNAVAILABLE = "Summary unavailable";

export function buildPrompt(opts: {
  title: string;
  source: "article" | "comments" | "post";
  body: string;
}): { system: string; user: string } {
  const system =
    "You summarize Hacker News stories. Write a clear, factual summary in at most 6 sentences. " +
    "Do not invent facts. Do not mention that you are an AI. No bullet points or titles — plain paragraphs only.";

  let lead: string;
  if (opts.source === "article") {
    lead = "Summarize the following article for a technical reader.";
  } else if (opts.source === "post") {
    lead = "Summarize this Hacker News post (Ask/Show/text post).";
  } else {
    lead =
      "The full article could not be fetched. Using the title and top comments, write a cautious summary of what the discussion appears to be about. " +
      "If there is not enough information, reply exactly: Summary unavailable";
  }

  const user = `${lead}\n\nTitle: ${opts.title}\n\nContent:\n${opts.body.slice(0, 6000)}`;
  return { system, user };
}

export function normalizeSummary(raw: string): { summary: string | null; status: "ready" | "unavailable" } {
  const text = (raw || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || /^summary unavailable\.?$/i.test(text)) {
    return { summary: null, status: "unavailable" };
  }

  const limited = limitSentences(text, 6);
  if (!limited || limited.length < 12) {
    return { summary: null, status: "unavailable" };
  }
  return { summary: limited, status: "ready" };
}

export async function runModel(env: Env, system: string, user: string): Promise<string> {
  const model = env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const result = (await env.AI.run(model as any, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: 400,
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
      source: "none",
      updatedAt: now,
      error: "No article text, post body, or comments available",
    };
  }

  try {
    const { system, user } = buildPrompt({ title: story.title, source: source as "article" | "comments" | "post", body });
    const raw = await runModel(env, system, user);
    const { summary, status } = normalizeSummary(raw);
    return {
      id: story.id,
      status,
      summary: status === "ready" ? summary : null,
      source,
      updatedAt: now,
      error: status === "unavailable" ? UNAVAILABLE : undefined,
    };
  } catch (err) {
    return {
      id: story.id,
      status: "unavailable",
      summary: null,
      source,
      updatedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
