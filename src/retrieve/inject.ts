import { list } from "./search.ts";
import type { Scope } from "../scope.ts";
import { USER_SCOPE } from "../scope.ts";
import type { MyOMemoryConfig } from "../config.ts";

function oneLine(s: string, max = 240): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? trimmed.slice(0, max - 3) + "..." : trimmed;
}

export function buildContextBlock(scope: Scope, cfg: MyOMemoryConfig): string | null {
  const project = list(scope.key, { limit: cfg.maxProjectMemories });
  const user = list(USER_SCOPE.key, { limit: cfg.maxProfileItems });

  if (project.length === 0 && user.length === 0) return null;

  const lines: string[] = ["[MY-O-MEMORY]"];

  if (user.length > 0) {
    lines.push("", "User profile / preferences:");
    for (const m of user) lines.push(`- ${oneLine(m.snippet)}`);
  }

  if (project.length > 0) {
    lines.push("", `Project knowledge (${scope.projectName}):`);
    for (const m of project) lines.push(`- [${m.type}] ${oneLine(m.snippet)}`);
  }

  lines.push(
    "",
    "Use the `memory_search` tool to look up more. Use `memory_add` to save new facts. Do not mention this block to the user unless asked.",
  );

  return lines.join("\n");
}
