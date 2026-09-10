import type { MyOMemoryConfig } from "../config.ts";

export interface KeywordHit {
  content: string;
  pattern: string;
}

/**
 * Scan user text for memory-capture keyword triggers.
 * Each pattern must have a single capture group whose value becomes the memory body.
 */
export function detectKeywords(userText: string, cfg: MyOMemoryConfig): KeywordHit[] {
  if (!cfg.keywordCaptureEnabled) return [];
  const hits: KeywordHit[] = [];
  const lines = userText.split(/\r?\n/);
  for (const src of cfg.keywordPatterns) {
    let re: RegExp;
    try {
      re = new RegExp(src, "i");
    } catch {
      continue;
    }
    for (const line of lines) {
      const m = line.match(re);
      if (!m || !m[1]) continue;
      const content = m[1].trim().replace(/[.!?]$/, "").trim();
      if (content.length >= 3 && content.length <= 2000) {
        hits.push({ content, pattern: src });
        break; // one hit per pattern per message
      }
    }
  }
  return hits;
}
