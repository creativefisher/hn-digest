/**
 * Split text into sentences and keep at most `max` of them.
 * Handles common abbreviations so we don't cut too early.
 */
const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|U\.S|U\.K|Inc|Ltd|Corp)\.$/i;

export function limitSentences(text: string, max = 6): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .trim();
  if (!cleaned) return "";

  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    buf += ch;
    if (/[.!?]/.test(ch)) {
      const next = cleaned[i + 1];
      if (next && /[a-z0-9]/.test(next)) continue; // 3.14 or e.g. mid-token
      if (ABBREV.test(buf.trim())) continue;
      if (next && next !== " " && next !== '"' && next !== "'") continue;
      parts.push(buf.trim());
      buf = "";
      if (parts.length >= max) break;
    }
  }
  if (parts.length < max && buf.trim()) parts.push(buf.trim());
  return parts.slice(0, max).join(" ").trim();
}

export function countSentences(text: string): number {
  if (!text.trim()) return 0;
  return limitSentences(text, 100).split(/(?<=[.!?])\s+/).filter(Boolean).length;
}
