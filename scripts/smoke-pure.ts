// Quick smoke test — runs the pure-logic modules (no bun:sqlite dependency).
// Usage:  node --experimental-strip-types scripts\smoke-pure.ts
import { parse, serialize, ulid, type Frontmatter } from "../src/store/markdown.ts";
import { redact, findSecret } from "../src/redact.ts";
import { detectKeywords } from "../src/capture/keywords.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { resolveProjectScope, USER_SCOPE } from "../src/scope.ts";

let fails = 0;
function ok(name: string, cond: boolean, info?: unknown) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    console.log(`  FAIL ${name}`, info ?? "");
    fails++;
  }
}

console.log("== ulid ==");
const a = ulid();
const b = ulid();
ok("length is 26", a.length === 26);
ok("two calls differ", a !== b);
ok("sortable", a < b || a === b);

console.log("== markdown round-trip ==");
const fm: Frontmatter = {
  id: a,
  scope_key: "project__test__abcdef123456",
  scope_kind: "project",
  project_name: "test",
  type: "note",
  tags: ["hello", "world"],
  source: "test",
  created_at: 1000,
  updated_at: 2000,
};
const body = "hello\n\nworld";
const raw = serialize(fm, body);
ok("has frontmatter fence", raw.startsWith("---\n"));
const parsed = parse(raw);
ok("parses", parsed !== null);
ok("id survives", parsed?.fm.id === a);
ok("tags survive", JSON.stringify(parsed?.fm.tags) === '["hello","world"]');
ok("body survives", parsed?.body.trim() === body);

console.log("== redact ==");
const r1 = redact("api key is <private>sk-supersecretkey</private> ok", DEFAULT_CONFIG.redactPatterns);
ok("private stripped", !r1.content.includes("sk-supersecretkey"));
ok("no secret after strip", !r1.hadSecret);

const r2 = redact("sk-1234567890abcdefghij1234", DEFAULT_CONFIG.redactPatterns);
ok("bare secret detected", r2.hadSecret === true);

const r3 = redact("ghp_" + "a".repeat(36), DEFAULT_CONFIG.redactPatterns);
ok("github PAT detected", r3.hadSecret === true);

console.log("== keywords ==");
const hits1 = detectKeywords("remember that this repo uses Bun, not Node", DEFAULT_CONFIG);
ok("basic remember matched", hits1.length === 1);
ok("body captured", hits1[0]?.content === "this repo uses Bun, not Node");

const hits2 = detectKeywords("TIL: sqlite bm25 returns lower=better", DEFAULT_CONFIG);
ok("TIL matched", hits2.length === 1);

const hits3 = detectKeywords("hello world", DEFAULT_CONFIG);
ok("no false positive", hits3.length === 0);

const hits4 = detectKeywords("Please note that FTS5 needs prefix matches", DEFAULT_CONFIG);
ok("please-note matched", hits4.length === 1);

console.log("== scope ==");
const s = resolveProjectScope(process.cwd());
ok("kind=project", s.kind === "project");
ok("key starts with project__", s.key.startsWith("project__"));
ok("hash length 12", /__[a-f0-9]{12}$/.test(s.key));
console.log("     scope.key =", s.key);
console.log("     user.key  =", USER_SCOPE.key);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
