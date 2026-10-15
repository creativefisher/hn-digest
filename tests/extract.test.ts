import { describe, it, expect } from "vitest";
import { stripTagsRough, TextCollector } from "../src/extract";

describe("stripTagsRough", () => {
  it("removes scripts and tags", () => {
    const html = `<html><script>evil()</script><style>.x{}</style><p>Hello <b>world</b></p>`;
    const text = stripTagsRough(html);
    expect(text).toContain("Hello world");
    expect(text).not.toContain("evil");
    expect(text).not.toContain(".x");
  });

  it("truncates to maxChars", () => {
    const html = `<p>${"a".repeat(5000)}</p>`;
    expect(stripTagsRough(html, 100).length).toBe(100);
  });
});

describe("TextCollector", () => {
  it("stops after max chars", () => {
    const c = new TextCollector(20);
    c.push("abcdefghijklmnopqrstuvwxyz");
    expect(c.toString().length).toBe(20);
    expect(c.truncated).toBe(true);
  });

  it("ignores while skipping", () => {
    const c = new TextCollector(100);
    c.enterSkip();
    c.push("secret");
    c.leaveSkip();
    c.push("ok");
    expect(c.toString()).toBe("ok");
  });
});
