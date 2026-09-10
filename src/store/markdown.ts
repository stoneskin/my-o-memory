import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import yaml from "js-yaml";
import { memoriesDirFor, memoriesDirPath } from "../paths.ts";

export interface Frontmatter {
  id: string;
  scope_key: string;
  scope_kind: "user" | "project";
  project_name: string;
  type: string;
  tags: string[];
  source: string;
  created_at: number;
  updated_at: number;
}

export interface MemoryFile {
  fm: Frontmatter;
  body: string;
  filePath: string;
  mtimeMs: number;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID-ish: 10 chars of base32 timestamp + 16 chars of base32 randomness. */
export function ulid(): string {
  let ts = "";
  let n = Date.now();
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[n % 32]! + ts;
    n = Math.floor(n / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b % 32]!;
  return ts + rand;
}

export function serialize(fm: Frontmatter, body: string): string {
  const yml = yaml.dump(fm, { lineWidth: -1, quotingType: '"' });
  return `---\n${yml}---\n\n${body.trimEnd()}\n`;
}

export function parse(raw: string): { fm: Frontmatter; body: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  try {
    const fm = yaml.load(m[1]!) as Frontmatter;
    if (!fm || typeof fm !== "object" || !fm.id) return null;
    // Normalize
    fm.tags = Array.isArray(fm.tags) ? fm.tags : [];
    fm.type = fm.type ?? "note";
    fm.source = fm.source ?? "";
    const body = (m[2] ?? "").replace(/^\n+/, "");
    return { fm, body };
  } catch {
    return null;
  }
}

export function writeMemoryFile(
  fm: Frontmatter,
  body: string,
): { filePath: string; mtimeMs: number } {
  const dir = memoriesDirFor(fm.scope_key);
  const filePath = path.join(dir, `${fm.id}.md`);
  fs.writeFileSync(filePath, serialize(fm, body), "utf8");
  const st = fs.statSync(filePath);
  return { filePath, mtimeMs: st.mtimeMs };
}

export function deleteMemoryFile(scopeKey: string, id: string): boolean {
  const dir = memoriesDirPath(scopeKey);
  const filePath = path.join(dir, `${id}.md`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export function readMemoryFile(filePath: string): MemoryFile | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parse(raw);
  if (!parsed) return null;
  const st = fs.statSync(filePath);
  return { fm: parsed.fm, body: parsed.body, filePath, mtimeMs: st.mtimeMs };
}

export function* iterMemoryFiles(scopeKey: string): Generator<string> {
  const dir = memoriesDirPath(scopeKey);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".md")) yield path.join(dir, name);
  }
}
