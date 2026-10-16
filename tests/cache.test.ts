import { describe, it, expect } from "vitest";
import {
  summaryKey,
  frontPageContentKey,
  frontPageUnchanged,
} from "../src/cache";
import type { FrontPage, Story } from "../src/types";

function stubStory(partial: Partial<Story> & Pick<Story, "id" | "points" | "summaryStatus">): Story {
  return {
    rank: 1,
    title: "t",
    url: null,
    domain: null,
    commentCount: 0,
    author: "a",
    time: 0,
    type: "story",
    text: null,
    summary: null,
    bullets: [],
    ...partial,
  };
}

describe("cache keys", () => {
  it("builds summary key", () => {
    expect(summaryKey(12345)).toBe("summary:v2:12345");
  });
});

describe("frontPageContentKey / unchanged", () => {
  it("fingerprints id, points, and summaryStatus in order", () => {
    const stories = [
      stubStory({ id: 1, points: 10, summaryStatus: "ready" }),
      stubStory({ id: 2, points: 5, summaryStatus: "pending" }),
    ];
    expect(frontPageContentKey(stories)).toBe("1:10:ready|2:5:pending");
  });

  it("detects unchanged frontpage content", () => {
    const stories = [
      stubStory({ id: 1, points: 10, summaryStatus: "ready" }),
      stubStory({ id: 2, points: 5, summaryStatus: "pending" }),
    ];
    const prev: FrontPage = { updatedAt: 1, stories };
    expect(frontPageUnchanged(prev, stories)).toBe(true);
  });

  it("detects score or status changes", () => {
    const prev: FrontPage = {
      updatedAt: 1,
      stories: [stubStory({ id: 1, points: 10, summaryStatus: "pending" })],
    };
    expect(
      frontPageUnchanged(prev, [stubStory({ id: 1, points: 11, summaryStatus: "pending" })])
    ).toBe(false);
    expect(
      frontPageUnchanged(prev, [stubStory({ id: 1, points: 10, summaryStatus: "ready" })])
    ).toBe(false);
  });

  it("treats empty/missing prev as changed", () => {
    const next = [stubStory({ id: 1, points: 1, summaryStatus: "pending" })];
    expect(frontPageUnchanged(null, next)).toBe(false);
    expect(frontPageUnchanged({ updatedAt: 0, stories: [] }, next)).toBe(false);
  });
});
