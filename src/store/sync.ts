import fs from "node:fs";
import { db } from "./db.ts";
import { iterMemoryFiles, readMemoryFile, type MemoryFile } from "./markdown.ts";

const UPSERT_SQL = `
  INSERT INTO memories (id, scope_key, scope_kind, project_name, type, tags, content, source, file_path, mtime_ms, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    scope_key    = excluded.scope_key,
    scope_kind   = excluded.scope_kind,
    project_name = excluded.project_name,
    type         = excluded.type,
    tags         = excluded.tags,
    content      = excluded.content,
    source       = excluded.source,
    file_path    = excluded.file_path,
    mtime_ms     = excluded.mtime_ms,
    updated_at   = excluded.updated_at
`;

export function upsertFromFile(mf: MemoryFile): void {
  const { fm, body, filePath, mtimeMs } = mf;
  db().prepare(UPSERT_SQL).run(
    fm.id,
    fm.scope_key,
    fm.scope_kind,
    fm.project_name,
    fm.type,
    (fm.tags ?? []).join(","),
    body,
    fm.source ?? "",
    filePath,
    mtimeMs,
    fm.created_at,
    fm.updated_at,
  );
}

export function deleteFromIndex(id: string): void {
  db().prepare(`DELETE FROM memories WHERE id = ?`).run(id);
}

export interface SyncStats {
  added: number;
  updated: number;
  removed: number;
  scanned: number;
}

export function syncScope(scopeKey: string): SyncStats {
  const d = db();
  const stats: SyncStats = { added: 0, updated: 0, removed: 0, scanned: 0 };

  const existing = d
    .prepare(`SELECT id, file_path, mtime_ms FROM memories WHERE scope_key = ?`)
    .all(scopeKey) as Array<{ id: string; file_path: string; mtime_ms: number }>;
  const existingById = new Map(existing.map((r) => [r.id, r]));
  const seen = new Set<string>();

  for (const fp of iterMemoryFiles(scopeKey)) {
    const mf = readMemoryFile(fp);
    if (!mf) continue;
    stats.scanned++;
    seen.add(mf.fm.id);
    const prev = existingById.get(mf.fm.id);
    if (!prev) {
      upsertFromFile(mf);
      stats.added++;
    } else if (prev.mtime_ms !== mf.mtimeMs || prev.file_path !== mf.filePath) {
      upsertFromFile(mf);
      stats.updated++;
    }
  }

  for (const row of existing) {
    if (!seen.has(row.id) || !fs.existsSync(row.file_path)) {
      deleteFromIndex(row.id);
      stats.removed++;
    }
  }

  return stats;
}
