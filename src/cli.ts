#!/usr/bin/env node
// Run with:  node --experimental-strip-types src/cli.ts <command>
import { resolveProjectScope, resolveCwdScope, USER_SCOPE } from "./scope.ts";
import { db, closeDb } from "./store/db.ts";
import { syncScope, upsertFromFile, deleteFromIndex } from "./store/sync.ts";
import { migrateScope, scopeHasFiles, type ConflictStrategy } from "./store/migrate.ts";
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
import fs from "node:fs";

function usage(): never {
  console.log(`my-o-memory CLI

Usage:
  node --experimental-strip-types src/cli.ts where
  node --experimental-strip-types src/cli.ts list [--scope project|user] [--type T] [--limit N]
  node --experimental-strip-types src/cli.ts search "query" [--scope project|user|both] [--type T] [--limit N]
  node --experimental-strip-types src/cli.ts add "content" [--scope project|user] [--type T] [--tag t1,t2]
  node --experimental-strip-types src/cli.ts forget <id>
  node --experimental-strip-types src/cli.ts reindex
  node --experimental-strip-types src/cli.ts scopes
  node --experimental-strip-types src/cli.ts migrate [--from <key>] [--to <key>]
                                          [--dry-run] [--on-conflict newer|overwrite|skip]

Scope defaults to \`project\` (derived from cwd's git remote or path).
\`scopes\` lists every project scope dir with its file count — use it to find
the \`--from\` key when migrating.
\`migrate\` moves memories between scope keys — useful when a repo gains a
git remote after memories were already stored under the cwd-based key.`);
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

  if (cmd === "scopes") {
    const { memories } = paths();
    if (!fs.existsSync(memories)) {
      console.log("(no memories dir yet)");
      return;
    }
    const entries: Array<{ key: string; files: number; marker: string }> = [];
    for (const name of fs.readdirSync(memories)) {
      const dir = `${memories}/${name}`;
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length;
      const marker =
        name === project.key ? " <- current project"
        : name === USER_SCOPE.key ? " <- user"
        : "";
      entries.push({ key: name, files, marker });
    }
    entries.sort((a, b) => b.files - a.files);
    for (const e of entries) {
      console.log(`  ${e.files.toString().padStart(4)}  ${e.key}${e.marker}`);
    }
    return;
  }

  if (cmd === "migrate") {
    const flags = parseFlags(rest);
    const toKey = flags.to ?? project.key;

    let fromKey = flags.from;
    if (!fromKey) {
      // Auto-detect: the "legacy" scope is what the key WOULD be if we
      // ignored the git remote (pure cwd hash). Only offer it if it differs
      // from the current project scope AND has files on disk.
      const cwd = resolveCwdScope(process.cwd());
      if (cwd.key !== project.key && scopeHasFiles(cwd.key)) {
        fromKey = cwd.key;
        console.log(`(auto-detected legacy scope: ${fromKey})`);
      } else {
        console.error(
          `no --from given and no legacy cwd-based scope with files detected.\n` +
            `current project scope: ${project.key}\n` +
            `cwd-only scope:        ${cwd.key}`,
        );
        process.exit(2);
      }
    }

    if (fromKey === toKey) {
      console.error(`--from and --to are identical (${fromKey}); nothing to do.`);
      process.exit(2);
    }

    const dryRun = flags["dry-run"] === "true";
    const onConflict = flags["on-conflict"] as ConflictStrategy | undefined;
    if (onConflict && !["newer", "overwrite", "skip"].includes(onConflict)) {
      console.error(`invalid --on-conflict: ${onConflict}`);
      process.exit(2);
    }

    const stats = migrateScope(fromKey, toKey, {
      toProjectName: project.projectName,
      dryRun,
      onConflict,
      logger: (m) => console.log(m),
    });
    console.log(
      `${dryRun ? "DRY RUN: " : ""}moved ${stats.moved}, skipped ${stats.skipped}, conflicts ${stats.conflicts}`,
    );
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
