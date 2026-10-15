import { describe, it, expect } from "vitest";
import { limitSentences, countSentences } from "../src/sentences";

describe("limitSentences", () => {
  it("keeps at most 6 sentences", () => {
    const input =
      "One. Two. Three. Four. Five. Six. Seven. Eight.";
    const out = limitSentences(input, 6);
    expect(out).toBe("One. Two. Three. Four. Five. Six.");
    expect(countSentences(out)).toBe(6);
  });

  it("returns shorter text unchanged", () => {
    expect(limitSentences("Just one sentence.", 6)).toBe("Just one sentence.");
  });

  it("handles abbreviations without early splits", () => {
    const out = limitSentences("Dr. Smith met Mr. Jones in the U.S. today. They talked.", 6);
    expect(out).toContain("Dr. Smith");
    expect(out).toContain("They talked.");
  });

  it("collapses whitespace", () => {
    expect(limitSentences("Hello   world.  Next.", 6)).toBe("Hello world. Next.");
  });

  it("returns empty for blank input", () => {
    expect(limitSentences("   ", 6)).toBe("");
  });
});
