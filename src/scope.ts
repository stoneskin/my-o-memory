import { execSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

export interface Scope {
  key: string;
  kind: "user" | "project";
  projectName: string;
}

export const USER_SCOPE: Scope = { key: "user", kind: "user", projectName: "user" };

function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .toLowerCase();
}

function tryGitRemote(cwd: string): string | null {
  try {
    const url = execSync("git config --get remote.origin.url", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

function sanitize(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "project";
}

export function resolveProjectScope(worktree: string): Scope {
  const target = worktree && worktree.length > 0 ? worktree : ".";
  const remote = tryGitRemote(target);
  let seed: string;
  let projectName: string;
  if (remote) {
    const norm = normalizeRemote(remote);
    seed = norm;
    const m = norm.match(/\/([^/]+)$/);
    projectName = m?.[1] ?? "workspace";
  } else {
    const resolved = path.resolve(target);
    seed = resolved.toLowerCase();
    // basename can return "" on Windows drive roots (e.g. "C:\\"); walk the path
    // segments and pick the last non-empty, non-drive-letter component.
    const parts = resolved
      .split(/[\\/]+/)
      .filter((p) => p && !/^[A-Za-z]:$/.test(p));
    projectName = parts[parts.length - 1] ?? path.basename(resolved) ?? "workspace";
    if (!projectName) projectName = "workspace";
  }
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return {
    key: `project__${sanitize(projectName)}__${hash}`,
    kind: "project",
    projectName,
  };
}
