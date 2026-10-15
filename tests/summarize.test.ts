import { describe, it, expect } from "vitest";
import { normalizeSummary, buildPrompt } from "../src/summarize";
import { limitSentences } from "../src/sentences";

describe("normalizeSummary", () => {
  it("marks unavailable phrases", () => {
    expect(normalizeSummary("Summary unavailable").status).toBe("unavailable");
    expect(normalizeSummary("").status).toBe("unavailable");
  });

  it("limits to 6 sentences", () => {
    const raw =
      "Alpha is first. Bravo is second. Charlie is third. Delta is fourth. Echo is fifth. Foxtrot is sixth. Golf is seventh. Hotel is eighth.";
    const { summary, status } = normalizeSummary(raw);
    expect(status).toBe("ready");
    expect(summary).toBe(limitSentences(raw, 6));
    expect(summary!.endsWith("sixth.")).toBe(true);
  });

  it("strips markdown headings and bullets", () => {
    const { summary, status } = normalizeSummary("# Title\n- point one is long enough here. Point two continues.");
    expect(status).toBe("ready");
    expect(summary).not.toMatch(/^#/);
    expect(summary!.length).toBeGreaterThan(20);
  });
});

describe("buildPrompt", () => {
  it("varies lead by source", () => {
    expect(buildPrompt({ title: "T", source: "article", body: "x" }).user).toContain("article");
    expect(buildPrompt({ title: "T", source: "comments", body: "x" }).user).toContain("comments");
    expect(buildPrompt({ title: "T", source: "post", body: "x" }).user).toContain("post");
  });
});
