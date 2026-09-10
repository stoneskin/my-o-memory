import { createRequire } from "node:module";
import { paths } from "../paths.ts";

// Runtime-agnostic SQLite:
//   - Inside opencode (Bun runtime): bun:sqlite (built-in, no native module load)
//   - Under Node CLI: better-sqlite3
// Both expose the same shape: new Database(path), .exec(sql), .prepare(sql).{run,all,get}, .close()
const require = createRequire(import.meta.url);
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabase = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabaseCtor = new (path: string) => AnyDatabase;

function loadDatabase(): AnyDatabaseCtor {
  if (isBun) {
    // bun:sqlite is a built-in module; only resolvable under the Bun runtime.
    return require("bun:sqlite").Database as AnyDatabaseCtor;
  }
  return require("better-sqlite3") as AnyDatabaseCtor;
}

let _db: AnyDatabase | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id           TEXT PRIMARY KEY,
  scope_key    TEXT NOT NULL,
  scope_kind   TEXT NOT NULL,
  project_name TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'note',
  tags         TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT '',
  file_path    TEXT NOT NULL,
  mtime_ms     INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_scope_updated
  ON memories(scope_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  type,
  scope_key UNINDEXED,
  content='memories',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags, type, scope_key)
  VALUES (new.rowid, new.content, new.tags, new.type, new.scope_key);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, type, scope_key)
  VALUES ('delete', old.rowid, old.content, old.tags, old.type, old.scope_key);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, type, scope_key)
  VALUES ('delete', old.rowid, old.content, old.tags, old.type, old.scope_key);
  INSERT INTO memories_fts(rowid, content, tags, type, scope_key)
  VALUES (new.rowid, new.content, new.tags, new.type, new.scope_key);
END;
`;

export function db(): AnyDatabase {
  if (_db) return _db;
  const { indexDb } = paths();
  const Database = loadDatabase();
  const d = new Database(indexDb);
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA synchronous = NORMAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec(SCHEMA);
  _db = d;
  return d;
}

/** Close the DB. Only used by tests / CLI teardown. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/** Which backend this process is using. Useful for diagnostics. */
export function backendName(): "bun:sqlite" | "better-sqlite3" {
  return isBun ? "bun:sqlite" : "better-sqlite3";
}
