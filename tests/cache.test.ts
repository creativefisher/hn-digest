import { describe, it, expect } from "vitest";
import { summaryKey } from "../src/cache";

describe("cache keys", () => {
  it("builds summary key", () => {
    expect(summaryKey(12345)).toBe("summary:v2:12345");
  });
});
