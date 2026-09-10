# my-o-memory — Design & Roadmap

## Goal

A local-only persistent memory plugin for opencode. No SaaS, no account, no
network calls. Memories live as human-readable markdown files, indexed by
SQLite FTS5 for BM25 keyword search.

## Non-goals (MVP)

- No cloud sync
- No embeddings / vector search (v2)
- No LLM-driven memory extraction (v2)
- No knowledge graph / entity linking
- No multi-user collaboration

## Architecture

```
+-----------------------------+
|         opencode (Bun)      |
|                             |
|  chat.message hook  ------> keyword capture ---+
|  system.transform   ------> context inject <---|--- memory files
|  tool.memory_*      ------> add/search/list/forget    (source of truth)
+-----------------------------+                  |
                                                 v
                                        +----------------+
                                        |  SQLite index  |
                                        | (FTS5, BM25)   |
                                        +----------------+
```

- `memories` — one file per memory. YAML frontmatter + body.
- `index.db` — SQLite (via `better-sqlite3`) with FTS5 virtual table over content/tags/type.
- Loads under opencode's embedded Bun runtime (better-sqlite3 works via N-API compat).
- CLI runs under Node 22+ with `--experimental-strip-types` — no Bun required, no build step.

## Data model

### File on disk

`memories/<scope_key>/<id>.md`

```markdown
---
id: 01HZ...
scope_key: project__my-o-memory__a1b2c3d4e5f6
scope_kind: project
project_name: my-o-memory
type: project-config
tags: [bun, sqlite]
source: tool
created_at: 1770000000000
updated_at: 1770000000000
---

This project runs under Bun and uses bun:sqlite. Do not add better-sqlite3.
```

### SQLite tables

- `memories(id PK, scope_key, scope_kind, project_name, type, tags CSV, content, source, file_path, mtime_ms, created_at, updated_at)`
- `memories_fts` — FTS5 virtual table over `content`, `tags`, `type`, external-content mode pointing at `memories.rowid`.
- Triggers keep `memories_fts` in sync on insert/update/delete.

## Scoping

- **user** scope key: literal `"user"`
- **project** scope key: `project__<sanitized-name>__<12-hex-of-sha256>`
  - Seed: normalized git origin URL if present, else absolute cwd path (lowercased)
  - Same repo across machines -> same key, so memories can be `git`-committed (future)

### Scope-key drift and migration

Because the scope key changes when a repo's git origin appears or changes,
memories captured *before* a remote was added end up orphaned under the
cwd-based key. The plugin logs a one-shot warning at load when it detects
this, and ships two CLI commands to resolve it:

- `cli scopes` — list every project scope directory with a file count.
- `cli migrate --from <old> [--to <current>] [--dry-run] [--on-conflict newer|overwrite|skip]`
  — rewrites `scope_key` in each file's frontmatter, moves the files, and
  reindexes. Default conflict strategy is "keep the newer `updated_at`".

Auto-migration on load is intentionally *not* done: two unrelated repos at
the same cwd would silently merge.

## Capture mechanisms

MVP:
1. **Explicit tool call** — agent calls `memory_add`.
2. **Keyword trigger** — regex against the user message parts. Captured group 1 becomes the memory body. Defaults: `remember`, `note that`, `TIL`, `save this`.

Not in MVP:
3. Auto-capture every N turns via LLM summary.
4. LLM-decided "should I recall?" per turn (supermemory's reasoned-recall).

## Retrieval

MVP: **BM25 via SQLite FTS5.** Query is tokenized, punctuation stripped, each token becomes a prefix match. `bm25(memories_fts)` used as the score. Snippets via `snippet(memories_fts, ...)`.

Not in MVP:
- Local embeddings (Transformers.js `Xenova/bge-small-en-v1.5`) + sqlite-vec.
- Reciprocal Rank Fusion across BM25 + vector lanes.
- Cross-encoder rerank (FastEmbed jina-reranker-tiny).

## Context injection

On the first `experimental.chat.system.transform` for each session, push a
`[MY-O-MEMORY]` block containing:
- User profile / preferences (top N from `user` scope)
- Project knowledge (top N from current project scope, newest first)

Injected once per session per plugin load (in-memory set keyed by sessionID).

## Redaction

Applied to any content on the way in (tool + keyword capture):
1. Strip `<private>...</private>` -> `[REDACTED]`.
2. Match remaining text against secret regex list (OpenAI, GitHub, AWS, Slack...). If any hit -> refuse write, tell agent to redact.

## Config surface

`~/.config/opencode/my-o-memory.jsonc`:

```jsonc
{
  "maxProjectMemories": 8,
  "maxProfileItems": 5,
  "injectOnFirstTurn": true,
  "keywordCaptureEnabled": true,
  "keywordPatterns": ["^\\s*remember...", ...],
  "redactPatterns": ["sk-[A-Za-z0-9]{20,}", ...],
  "logLevel": "info"
}
```

Env overrides:
- `MY_O_MEMORY_HOME` — override storage root
- `MY_O_MEMORY_CONFIG` — override config file path

## v2 roadmap (in rough priority)

1. **Local embeddings** — Xenova/bge-small ONNX via Transformers.js; sqlite-vec table; RRF fuse with BM25.
2. **Auto-capture** every N turns using the host LLM (opt-in).
3. **Preemptive compaction hook** — inject memories into `experimental.session.compacting` context.
4. **Deduplication** on write (hash + fuzzy).
5. **`/memory-init`** slash command — walk the repo, summarize modules, save.
6. **Recall receipts** — return which lane matched (BM25 / vector / recency) for debuggability.
7. **Bitemporal** valid_from/valid_to for facts that supersede each other.
8. **Admission barrier** — reject retrieved memories from being re-ingested, reject assistant self-writes, block prompt-injection in file content.

## v3+

- Ollama detection -> use `nomic-embed-text` when present.
- Cross-encoder rerank.
- Memory decay / consolidation.
- Import/export to markdown archives.
- Optional knowledge-graph layer for entity linking.

## Prior art referenced

- `opencode-supermemory` — plugin lifecycle, capture heuristics
- `doobidoo/mcp-memory-service` — local sqlite-vec + BM25 hybrid, decay
- `memoripy` — RRF, admission barrier, dependency-free hash embeddings
- `basic-memory` — markdown-first store, obsidian-compatible
- Anthropic client-managed memory tool pattern — filesystem primitives
