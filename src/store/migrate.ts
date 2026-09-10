import fs from "node:fs";
import path from "node:path";
import { memoriesDirFor, memoriesDirPath } from "../paths.ts";
import { db } from "./db.ts";
import {
  iterMemoryFiles,
  readMemoryFile,
  serialize,
  type Frontmatter,
} from "./markdown.ts";
import { syncScope } from "./sync.ts";

export type ConflictStrategy = "newer" | "overwrite" | "skip";

export interface MigrateOptions {
  /** New `project_name` to stamp into each moved memory's frontmatter. If
   *  omitted, keeps the original file's project_name. */
  toProjectName?: string;
  dryRun?: boolean;
  /** How to resolve id collisions in the destination scope. Default: "newer". */
  onConflict?: ConflictStrategy;
  logger?: (msg: string) => void;
}

export interface MigrateStats {
  moved: number;
  skipped: number;
  conflicts: number;
  dryRun: boolean;
}

/** True if this scope has at least one `.md` file on disk. Does not create
 *  the directory if it doesn't already exist. */
export function scopeHasFiles(scopeKey: string): boolean {
  const dir = memoriesDirPath(scopeKey);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith(".md"));
}

/**
 * Move all memories from `fromKey` to `toKey`. Rewrites each file's
 * `scope_key` (and optionally `project_name`) frontmatter. On id collision
 * in the destination, `onConflict` decides:
 *   - "newer"     (default): keep the file with the greater `updated_at`
 *   - "overwrite": always take the source
 *   - "skip":     always keep the destination
 *
 * After moving files, clears any lingering FTS rows for `fromKey` and
 * re-runs `syncScope(toKey)` so the index reflects reality. Removes the
 * empty source directory when possible.
 */
export function migrateScope(
  fromKey: string,
  toKey: string,
  opts: MigrateOptions = {},
): MigrateStats {
  const log = opts.logger ?? (() => {});
  const strategy: ConflictStrategy = opts.onConflict ?? "newer";
  const dryRun = !!opts.dryRun;
  const stats: MigrateStats = { moved: 0, skipped: 0, conflicts: 0, dryRun };

  if (fromKey === toKey) {
    throw new Error("migrate: --from and --to are identical");
  }

  const fromDir = memoriesDirPath(fromKey);
  const toDir = memoriesDirFor(toKey);
  if (!fs.existsSync(fromDir)) {
    log(`no source directory: ${fromDir}`);
    return stats;
  }

  for (const srcPath of iterMemoryFiles(fromKey)) {
    const mf = readMemoryFile(srcPath);
    if (!mf) {
      log(`skip unparseable: ${srcPath}`);
      stats.skipped++;
      continue;
    }
    const dstPath = path.join(toDir, path.basename(srcPath));

    let action: "write" | "skip" = "write";
    if (fs.existsSync(dstPath)) {
      stats.conflicts++;
      const dst = readMemoryFile(dstPath);
      if (!dst) {
        log(`conflict but destination unreadable, overwriting: ${dstPath}`);
      } else if (strategy === "skip") {
        action = "skip";
        log(`conflict: kept destination (--on-conflict=skip): ${dstPath}`);
      } else if (strategy === "overwrite") {
        log(`conflict: overwriting destination (--on-conflict=overwrite): ${dstPath}`);
      } else if (dst.fm.updated_at >= mf.fm.updated_at) {
        action = "skip";
        log(`conflict: kept destination (newer updated_at): ${dstPath}`);
      } else {
        log(`conflict: replaced destination (source newer): ${dstPath}`);
      }
    }

    if (action === "skip") {
      stats.skipped++;
      continue;
    }

    const newFm: Frontmatter = {
      ...mf.fm,
      scope_key: toKey,
      project_name: opts.toProjectName ?? mf.fm.project_name,
    };
    const raw = serialize(newFm, mf.body);
    if (!dryRun) {
      fs.writeFileSync(dstPath, raw, "utf8");
      // Only unlink source if it's a different path (paths differ because
      // scope dir differs; belt-and-suspenders check).
      if (path.resolve(srcPath) !== path.resolve(dstPath)) {
        fs.unlinkSync(srcPath);
      }
    }
    log(`${dryRun ? "would move" : "moved"}: ${srcPath} -> ${dstPath}`);
    stats.moved++;
  }

  if (!dryRun) {
    // Best-effort: remove now-empty source dir.
    try {
      if (fs.existsSync(fromDir) && fs.readdirSync(fromDir).length === 0) {
        fs.rmdirSync(fromDir);
      }
    } catch {
      /* ignore */
    }
    // Drop any remaining FTS/memories rows for the old scope, then rebuild
    // the destination index from disk. `syncScope` also handles removals for
    // the destination scope if a conflict-skip left stale rows behind.
    db().prepare(`DELETE FROM memories WHERE scope_key = ?`).run(fromKey);
    syncScope(toKey);
  }

  return stats;
}
