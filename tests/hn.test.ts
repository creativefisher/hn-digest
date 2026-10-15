import { describe, it, expect } from "vitest";
import { domainFromUrl, decodeHtmlEntities, itemToStory } from "../src/hn";

describe("domainFromUrl", () => {
  it("strips www and returns host", () => {
    expect(domainFromUrl("https://www.example.com/path")).toBe("example.com");
  });

  it("returns null for missing or invalid", () => {
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl("not a url")).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes entities and strips tags", () => {
    expect(decodeHtmlEntities("Hello &amp; <i>world</i>&#39;s")).toBe("Hello & world's");
  });
});

describe("itemToStory", () => {
  it("maps HN item fields", () => {
    const story = itemToStory(
      {
        id: 42,
        title: "Hello",
        url: "https://news.ycombinator.com",
        score: 10,
        descendants: 3,
        by: "pg",
        time: 1000,
        type: "story",
      },
      1
    );
    expect(story).toMatchObject({
      id: 42,
      rank: 1,
      title: "Hello",
      domain: "news.ycombinator.com",
      points: 10,
      commentCount: 3,
      author: "pg",
      summaryStatus: "pending",
    });
  });

  it("handles text-only posts", () => {
    const story = itemToStory(
      { id: 1, title: "Ask HN: Tips?", text: "What do you use?", by: "a", time: 1, type: "story" },
      5
    );
    expect(story.url).toBeNull();
    expect(story.domain).toBeNull();
    expect(story.text).toContain("What do you use?");
    expect(story.rank).toBe(5);
  });
});
