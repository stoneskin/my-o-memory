import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface MyOMemoryConfig {
  maxProjectMemories: number;
  maxProfileItems: number;
  injectOnFirstTurn: boolean;
  keywordCaptureEnabled: boolean;
  keywordPatterns: string[];
  redactPatterns: string[];
  logLevel: "debug" | "info" | "warn" | "error";
}

export const DEFAULT_CONFIG: MyOMemoryConfig = {
  maxProjectMemories: 8,
  maxProfileItems: 5,
  injectOnFirstTurn: true,
  keywordCaptureEnabled: true,
  keywordPatterns: [
    "^\\s*remember(?:\\s+that)?[:,]?\\s+(.+)$",
    "^\\s*(?:please\\s+)?(?:note|don'?t\\s+forget)(?:\\s+that)?[:,]?\\s+(.+)$",
    "^\\s*TIL[:,]?\\s+(.+)$",
    "^\\s*save\\s+(?:this|to\\s+memory)[:,]?\\s+(.+)$",
  ],
  redactPatterns: [
    "sk-[A-Za-z0-9_-]{20,}",
    "sm_[A-Za-z0-9_-]{20,}",
    "ghp_[A-Za-z0-9]{30,}",
    "gho_[A-Za-z0-9]{30,}",
    "github_pat_[A-Za-z0-9_]{40,}",
    "AKIA[0-9A-Z]{16}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "AIza[0-9A-Za-z_-]{30,}",
  ],
  logLevel: "info",
};

function stripJsonComments(raw: string): string {
  // Line comments
  let out = raw.replace(/^\s*\/\/.*$/gm, "");
  // Block comments (non-greedy)
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  // Trailing commas before closing brackets
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return out;
}

export function loadConfig(): MyOMemoryConfig {
  const candidates = [
    process.env.MY_O_MEMORY_CONFIG,
    path.join(os.homedir(), ".config", "opencode", "my-o-memory.jsonc"),
    path.join(os.homedir(), ".config", "opencode", "my-o-memory.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(stripJsonComments(raw)) as Partial<MyOMemoryConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      console.error(`[my-o-memory] failed to parse ${p}:`, err);
    }
  }
  return DEFAULT_CONFIG;
}
