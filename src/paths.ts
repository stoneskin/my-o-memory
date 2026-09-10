import path from "node:path";
import fs from "node:fs";
import os from "node:os";

function dataRoot(): string {
  if (process.env.MY_O_MEMORY_HOME) return path.resolve(process.env.MY_O_MEMORY_HOME);
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "my-o-memory");
  }
  const xdg = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdg, "my-o-memory");
}

export interface Paths {
  root: string;
  memories: string;
  indexDb: string;
}

let _cached: Paths | null = null;

export function paths(): Paths {
  if (_cached) return _cached;
  const root = dataRoot();
  const memories = path.join(root, "memories");
  const indexDb = path.join(root, "index.db");
  fs.mkdirSync(memories, { recursive: true });
  _cached = { root, memories, indexDb };
  return _cached;
}

export function memoriesDirFor(scopeKey: string): string {
  const { memories } = paths();
  const dir = path.join(memories, scopeKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Same as `memoriesDirFor` but never creates the directory. For read-only
 *  callers (iteration, existence checks) that must not pollute storage. */
export function memoriesDirPath(scopeKey: string): string {
  const { memories } = paths();
  return path.join(memories, scopeKey);
}
