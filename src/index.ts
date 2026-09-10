import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.ts";
import { resolveProjectScope, USER_SCOPE, type Scope } from "./scope.ts";
import { db } from "./store/db.ts";
import { syncScope, upsertFromFile } from "./store/sync.ts";
import {
  writeMemoryFile,
  readMemoryFile,
  ulid,
  type Frontmatter,
} from "./store/markdown.ts";
import { buildContextBlock } from "./retrieve/inject.ts";
import { detectKeywords } from "./capture/keywords.ts";
import { redact } from "./redact.ts";
import { makeTools } from "./tools/memory.ts";

const plugin: Plugin = async ({ worktree, directory }) => {
  const cfg = loadConfig();
  const roots = worktree || directory || process.cwd();
  const scope: Scope = resolveProjectScope(roots);

  // Init DB and one-shot sync of markdown -> index on plugin load.
  try {
    db();
    syncScope(scope.key);
    syncScope(USER_SCOPE.key);
    if (cfg.logLevel === "debug") {
      console.log(`[my-o-memory] loaded. scope=${scope.key}`);
    }
  } catch (err) {
    console.error("[my-o-memory] init failed:", err);
  }

  const tools = makeTools(() => scope, cfg);
  const injectedSessions = new Set<string>();

  return {
    tool: tools,

    async "chat.message"(_input, output) {
      if (!cfg.keywordCaptureEnabled) return;
      const parts = (output.parts ?? []) as Array<{ type: string; text?: string }>;
      const text = parts
        .map((p) => (p?.type === "text" ? p.text ?? "" : ""))
        .filter(Boolean)
        .join("\n");
      if (!text) return;

      const hits = detectKeywords(text, cfg);
      for (const h of hits) {
        const { content, hadSecret } = redact(h.content, cfg.redactPatterns);
        if (hadSecret || content.length === 0) continue;
        const now = Date.now();
        const fm: Frontmatter = {
          id: ulid(),
          scope_key: scope.key,
          scope_kind: scope.kind,
          project_name: scope.projectName,
          type: "note",
          tags: ["keyword"],
          source: "keyword",
          created_at: now,
          updated_at: now,
        };
        try {
          const { filePath } = writeMemoryFile(fm, content);
          const mf = readMemoryFile(filePath);
          if (mf) upsertFromFile(mf);
          if (cfg.logLevel === "debug") {
            console.log(`[my-o-memory] captured keyword memory ${fm.id}`);
          }
        } catch (err) {
          console.error("[my-o-memory] keyword capture failed:", err);
        }
      }
    },

    async "experimental.chat.system.transform"(input, output) {
      if (!cfg.injectOnFirstTurn) return;
      const sid = input.sessionID ?? "";
      if (injectedSessions.has(sid)) return;
      injectedSessions.add(sid);
      try {
        const block = buildContextBlock(scope, cfg);
        if (block) output.system.push(block);
      } catch (err) {
        console.error("[my-o-memory] context injection failed:", err);
      }
    },
  };
};

export default plugin;
