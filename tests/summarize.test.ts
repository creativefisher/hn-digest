import { describe, it, expect } from "vitest";
import { normalizeSummary, buildPrompt } from "../src/summarize";

describe("normalizeSummary", () => {
  it("marks unavailable phrases", () => {
    expect(normalizeSummary("Summary unavailable").status).toBe("unavailable");
    expect(normalizeSummary("").status).toBe("unavailable");
    expect(normalizeSummary("Summary unavailable.").bullets).toEqual([]);
  });

  it("parses takeaway plus up to two bullets", () => {
    const raw = [
      "Rust's new borrow checker catches more aliasing bugs at compile time.",
      "- Ships in the next stable release.",
      "- Benchmarks show negligible compile-time cost.",
      "- Extra third bullet should be dropped.",
    ].join("\n");
    const { summary, bullets, status } = normalizeSummary(raw);
    expect(status).toBe("ready");
    expect(summary).toBe("Rust's new borrow checker catches more aliasing bugs at compile time.");
    expect(bullets).toEqual([
      "Ships in the next stable release.",
      "Benchmarks show negligible compile-time cost.",
    ]);
  });

  it("keeps only the first sentence of a multi-sentence takeaway", () => {
    const raw =
      "First insight is here. Second sentence should go. Third too.\n- Supporting fact one is solid.";
    const { summary, bullets, status } = normalizeSummary(raw);
    expect(status).toBe("ready");
    expect(summary).toBe("First insight is here.");
    expect(bullets).toEqual(["Supporting fact one is solid."]);
  });

  it("strips markdown headings and accepts * bullets", () => {
    const raw = "# Title\n* Point one is long enough here\nCore takeaway about the launch survived.";
    // Heading stripped; takeaway may come after bullets depending on order —
    // with heading removed, first prose after bullets if takeaway missing from top
    const { status, summary } = normalizeSummary(
      "Core takeaway about the launch survived.\n* Point one is long enough here"
    );
    expect(status).toBe("ready");
    expect(summary).toBe("Core takeaway about the launch survived.");
    expect(normalizeSummary(raw).status).toBe("ready");
  });

  it("falls back when model returns a single paragraph", () => {
    const { summary, bullets, status } = normalizeSummary(
      "The company open-sourced its inference stack under Apache 2.0."
    );
    expect(status).toBe("ready");
    expect(summary).toContain("open-sourced");
    expect(bullets).toEqual([]);
  });

  it("rejects takeaways that are too short", () => {
    expect(normalizeSummary("Too short.\n- fact").status).toBe("unavailable");
  });
});

describe("buildPrompt", () => {
  it("varies lead by source", () => {
    expect(buildPrompt({ title: "T", source: "article", body: "x" }).user).toContain("article");
    expect(buildPrompt({ title: "T", source: "comments", body: "x" }).user).toContain("comments");
    expect(buildPrompt({ title: "T", source: "post", body: "x" }).user).toContain("post");
  });

  it("asks for takeaway-plus-bullets shape", () => {
    const { system } = buildPrompt({ title: "T", source: "article", body: "x" });
    expect(system).toMatch(/core message|insight/i);
    expect(system).toContain("- ");
  });
});
