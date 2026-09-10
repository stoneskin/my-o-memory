#!/usr/bin/env node
// Run with:  node --experimental-strip-types src/cli.ts <command>
import { resolveProjectScope, USER_SCOPE } from "./scope.ts";
import { db, closeDb } from "./store/db.ts";
import { syncScope, upsertFromFile, deleteFromIndex } from "./store/sync.ts";
import { search, list } from "./retrieve/search.ts";
import {
  writeMemoryFile,
  readMemoryFile,
  deleteMemoryFile,
  ulid,
  type Frontmatter,
} from "./store/markdown.ts";
import { loadConfig } from "./config.ts";
import { paths } from "./paths.ts";
import { redact } from "./redact.ts";

function usage(): never {
  console.log(`my-o-memory CLI

Usage:
  node --experimental-strip-types src/cli.ts where
  node --experimental-strip-types src/cli.ts list [--scope project|user] [--type T] [--limit N]
  node --experimental-strip-types src/cli.ts search "query" [--scope project|user|both] [--type T] [--limit N]
  node --experimental-strip-types src/cli.ts add "content" [--scope project|user] [--type T] [--tag t1,t2]
  node --experimental-strip-types src/cli.ts forget <id>
  node --experimental-strip-types src/cli.ts reindex

Scope defaults to \`project\` (derived from cwd's git remote or path).`);
  process.exit(1);
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) usage();

  const cfg = loadConfig();
  const project = resolveProjectScope(process.cwd());
  db();

  if (cmd === "where") {
    const p = paths();
    console.log(`root:      ${p.root}`);
    console.log(`memories:  ${p.memories}`);
    console.log(`index:     ${p.indexDb}`);
    console.log(`project:   ${project.key}`);
    console.log(`user:      ${USER_SCOPE.key}`);
    return;
  }

  if (cmd === "reindex") {
    const a = syncScope(project.key);
    const b = syncScope(USER_SCOPE.key);
    console.log(
      `reindexed. project: +${a.added} ~${a.updated} -${a.removed} (scanned ${a.scanned}), user: +${b.added} ~${b.updated} -${b.removed} (scanned ${b.scanned})`,
    );
    return;
  }

  if (cmd === "list") {
    const flags = parseFlags(rest);
    const s = flags.scope === "user" ? USER_SCOPE : project;
    syncScope(s.key);
    const hits = list(s.key, {
      type: flags.type,
      limit: flags.limit ? Number(flags.limit) : undefined,
    });
    if (hits.length === 0) {
      console.log(`(no memories in ${s.key})`);
      return;
    }
    for (const h of hits) {
      console.log(`[${h.type}] ${h.id}  ${h.snippet.replace(/\s+/g, " ").trim()}`);
    }
    return;
  }

  if (cmd === "search") {
    const query = rest[0];
    if (!query || query.startsWith("--")) usage();
    const flags = parseFlags(rest.slice(1));
    syncScope(project.key);
    syncScope(USER_SCOPE.key);
    const keys =
      flags.scope === "user"
        ? [USER_SCOPE.key]
        : flags.scope === "project"
          ? [project.key]
          : [project.key, USER_SCOPE.key];
    const hits = search(query, {
      scopeKeys: keys,
      limit: flags.limit ? Number(flags.limit) : undefined,
      type: flags.type,
    });
    if (hits.length === 0) {
      console.log("(no matches)");
      return;
    }
    for (const h of hits) {
      const tag = h.scope_key === USER_SCOPE.key ? "user" : "project";
      console.log(`[${tag}/${h.type}] ${h.id}  ${h.snippet.replace(/\s+/g, " ").trim()}`);
    }
    return;
  }

  if (cmd === "add") {
    const content = rest[0];
    if (!content || content.startsWith("--")) usage();
    const flags = parseFlags(rest.slice(1));
    const s = flags.scope === "user" ? USER_SCOPE : project;
    const { content: red, hadSecret, matchedPattern } = redact(content, cfg.redactPatterns);
    if (hadSecret) {
      console.error(`refused: content matched secret pattern (${matchedPattern}).`);
      process.exit(2);
    }
    const now = Date.now();
    const fm: Frontmatter = {
      id: ulid(),
      scope_key: s.key,
      scope_kind: s.kind,
      project_name: s.projectName,
      type: flags.type ?? "note",
      tags: flags.tag
        ? flags.tag
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      source: "cli",
      created_at: now,
      updated_at: now,
    };
    const { filePath } = writeMemoryFile(fm, red);
    const mf = readMemoryFile(filePath);
    if (mf) upsertFromFile(mf);
    console.log(`saved ${fm.id} -> ${filePath}`);
    return;
  }

  if (cmd === "forget") {
    const id = rest[0];
    if (!id) usage();
    const row = db().prepare(`SELECT scope_key FROM memories WHERE id = ?`).get(id) as
      | { scope_key: string }
      | undefined;
    if (!row) {
      console.error("not found");
      process.exit(1);
    }
    deleteMemoryFile(row.scope_key, id);
    deleteFromIndex(id);
    console.log(`deleted ${id}`);
    return;
  }

  usage();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    closeDb();
  });
