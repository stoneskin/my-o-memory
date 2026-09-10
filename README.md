# my-o-memory

Local-first persistent memory plugin for [opencode](https://opencode.ai).

- **Markdown files** as the source of truth (human-editable, git-friendly)
- **SQLite FTS5** as a rebuildable index (BM25 keyword search, via `better-sqlite3`)
- **Zero cloud**, zero account, zero third-party API
- Loads directly under opencode's embedded Bun runtime; CLI runs under Node — no build step, no Bun install

## Install (dev)

```
cd c:\github\my-o-memory
npm install
```

Then add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///c:/github/my-o-memory/src/index.ts"]
}
```

Restart opencode.

## Tools the plugin exposes to the agent

| Tool | What it does |
|---|---|
| `memory_add`     | Save a fact, preference, decision, note |
| `memory_search`  | Keyword search (BM25) across project + user memories |
| `memory_list`    | List memories in a scope, newest first |
| `memory_forget`  | Delete a memory by id |

## Capture

- **Keyword triggers** in user messages: `remember ...`, `note that ...`, `TIL ...`, `save this: ...`
- **Explicit tool calls** by the agent (via `memory_add`)
- **Redaction**: content inside `<private>...</private>` tags is stripped; content matching secret patterns (API keys, tokens) is refused

## Scopes

- **project** — scoped to the current repo (keyed off the git origin URL hash, or the cwd if no remote). Default for new memories.
- **user** — global across all your projects; use for personal preferences.

## Retrieval

On the first turn of every session, `my-o-memory` injects a `[MY-O-MEMORY]` block into the system prompt containing top-N recent project memories + top-N user preferences. The agent can also call `memory_search` on demand.

## Storage layout

```
%APPDATA%\my-o-memory\               (Windows)
$XDG_DATA_HOME/my-o-memory/          (Linux/macOS)
├── index.db                         # SQLite FTS5 index (rebuildable)
└── memories/
    ├── user/
    │   └── <id>.md
    └── project__<name>__<hash12>/
        └── <id>.md
```

Each `.md` file has YAML frontmatter (`id, scope_key, type, tags, created_at, ...`) followed by the memory content. You can edit them by hand — the plugin re-syncs on startup by comparing file mtimes.

## Config

Optional file at `~/.config/opencode/my-o-memory.jsonc`. See `PLAN.md` for defaults.

## CLI

Runs under Node 22 with the built-in experimental TypeScript loader (no build step).

```
node --experimental-strip-types src/cli.ts where
node --experimental-strip-types src/cli.ts list --scope project
node --experimental-strip-types src/cli.ts search "auth flow"
node --experimental-strip-types src/cli.ts add "This repo uses better-sqlite3" --type project-config
node --experimental-strip-types src/cli.ts forget <id>
node --experimental-strip-types src/cli.ts reindex
node --experimental-strip-types src/cli.ts scopes
node --experimental-strip-types src/cli.ts migrate --from <old-scope-key> [--dry-run]
```

Or via the npm script: `npm run cli -- list --scope project`.
**Note:** flag arguments beyond the first must be passed via direct `node` invocation, not `npm run cli --`, because npm swallows unknown `--flag` args.

## Status

MVP. See `PLAN.md` for the v2 roadmap (local embeddings, auto-capture, compaction hook, etc).

## License

[MIT](./LICENSE)
