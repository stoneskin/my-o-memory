# AGENTS.md

Local-first memory plugin for opencode. See `README.md` and `PLAN.md` for user-facing docs and the roadmap. This file lists only the non-obvious things an agent needs to work in this repo.

## Runtime model — read before touching anything

Two runtimes execute the same TypeScript source, with **no build step**:

- **opencode host** loads `src/index.ts` under embedded **Bun**. SQLite here is `bun:sqlite` (built-in).
- **CLI** (`src/cli.ts`) and smoke test run under **Node 22+** with `--experimental-strip-types`. SQLite here is `better-sqlite3` (native module).

`src/store/db.ts` picks the backend at runtime by sniffing `globalThis.Bun`. Both backends share the same surface (`new Database(path)`, `.exec`, `.prepare().run/all/get`, `.close`). Any DB code you write must stay on that common subset — do not import `better-sqlite3` or `bun:sqlite` directly outside `db.ts`.

Consequences:
- Imports **must** use explicit `.ts` extensions (`allowImportingTsExtensions: true`, `moduleResolution: "Bundler"`).
- No transpile / bundle output. Do not add one; opencode loads the `.ts` file directly.
- Adding a native dep means it must work under both Bun's N-API compat and Node.

## Commands

```
npm install                                          # once
npm run typecheck                                    # tsc --noEmit — the only lint/type gate
npm run cli -- where | list | search "q" | add ... | forget <id> | reindex
node --experimental-strip-types scripts\smoke-pure.ts   # runs pure-logic checks (no sqlite)
```

There is **no `npm test`** and no CI. Verification loop is: `npm run typecheck` + `smoke-pure.ts` + (if touching sqlite) `npm run cli -- reindex` against a scratch `MY_O_MEMORY_HOME`.

To load the plugin in opencode locally, `~/.config/opencode/opencode.jsonc` must have:
```
"plugin": ["file:///c:/github/my-o-memory/src/index.ts"]
```
Restart opencode after any change — the plugin is not hot-reloaded.

## Data lives outside the repo

Storage root:
- Windows: `%APPDATA%\my-o-memory\`
- Linux/macOS: `$XDG_DATA_HOME/my-o-memory/` (fallback `~/.local/share/my-o-memory/`)
- Override with `MY_O_MEMORY_HOME` (use this for tests to avoid clobbering real data).

Layout: `memories/<scope_key>/<id>.md` (YAML frontmatter + body) + `index.db` (SQLite FTS5).

**Markdown files are the source of truth; `index.db` is rebuildable.** `syncScope()` (in `src/store/sync.ts`) reconciles the two by mtime on plugin load and before every CLI read. When adding new frontmatter fields, update `Frontmatter` in `src/store/markdown.ts`, the `memories` table in `src/store/db.ts`, and `upsertFromFile` in `src/store/sync.ts` together, and bump the reindex path.

## Scope keys

- `user` scope key is literal `"user"`.
- `project` scope key: `project__<sanitized-name>__<12-hex-sha256>`, seeded from normalized git origin URL, else lowercased cwd. See `src/scope.ts`. Same repo across machines → same key (intentional; enables future git-commit of memories).
- The scope key **changes** when a repo gains/loses a git origin. `src/index.ts` logs a one-shot warning on load if it finds files under the legacy cwd-only key (`resolveCwdScope`). Use `cli scopes` to enumerate all scope dirs and `cli migrate --from <old>` to reconcile — see `src/store/migrate.ts`. No auto-migration; two unrelated repos at the same cwd would silently merge.
- Read-only callers must use `memoriesDirPath` (in `src/paths.ts`), never `memoriesDirFor`. The latter `mkdir -p`s the directory as a side effect and will pollute storage with empty scope dirs.

## Capture / write path invariants

Every write path (tool, keyword hook, CLI `add`) must:
1. Call `redact(content, cfg.redactPatterns)`.
2. If `hadSecret` → refuse the write (do not save `[REDACTED]` unless the user wrapped it in `<private>…</private>`).
3. `writeMemoryFile` first, then `readMemoryFile` + `upsertFromFile` to keep FTS in sync.

Keyword capture fires from `chat.message` on the assistant's `output.parts` text. Patterns live in `src/capture/keywords.ts` / config `keywordPatterns`; regex group 1 is the memory body.

Context injection happens exactly once per session in `experimental.chat.system.transform`, guarded by an in-memory `Set<sessionID>` in `src/index.ts`. It is not persisted — restarting opencode re-injects on the next first turn.

## Design constraints from PLAN.md worth honoring

MVP is intentionally: no cloud, no embeddings/vector search, no LLM-driven extraction, no knowledge graph. Do not add these without updating `PLAN.md`. Items 1–8 in the v2 roadmap have a rough priority order; prefer extending existing modules over new top-level concepts.

## Style notes

- `strict: true`, `verbatimModuleSyntax: false`. Prefer `import type` for types anyway.
- Log prefix is `[my-o-memory]`. Gate verbose logs behind `cfg.logLevel === "debug"`.
- Windows is a first-class target (this workspace is Windows). Use `node:path` and never hardcode `/`.
