// Adapter: turn "N branches of one git repo, compared against a base ref" into the registry
// shape the core pipeline needs. This is the generalized, repo-agnostic successor of
// tools/branch-contention-dedupe (built in the Prompts repo during the session this project
// grew out of) -- ported here as the reusable home for it, with one real fix: containment now
// uses core/containment.mjs's order-preserving subsequence check instead of a naive line-set
// membership check (see that file's header for the false-positive mode this fixes).
import { execFileSync } from "node:child_process";

function git(repoRoot, args, { quiet = false } = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "ignore"] : undefined,
  }).trim();
}

export function resolveDefaultBase(repoRoot, remote) {
  try {
    return git(repoRoot, ["rev-parse", "--abbrev-ref", `${remote}/HEAD`], { quiet: true });
  } catch {
    return `${remote}/main`;
  }
}

function discoverBranches(repoRoot, base, remote, exclude) {
  const raw = git(repoRoot, ["branch", "-r"]).split("\n").map((l) => l.trim()).filter(Boolean);
  const excludeSet = new Set([base, `${remote}/master`, `${remote}/main`, ...exclude]);
  return raw.filter((b) => !b.includes("->")).filter((b) => b.startsWith(`${remote}/`)).filter((b) => !excludeSet.has(b));
}

function changedFiles(repoRoot, base, branch) {
  let mergeBase;
  try {
    mergeBase = git(repoRoot, ["merge-base", base, branch], { quiet: true });
  } catch {
    return null; // disconnected history
  }
  const diffOut = git(repoRoot, ["diff", "--name-status", "-z", `${mergeBase}...${branch}`]);
  if (!diffOut) return { mergeBase, files: [] };
  const parts = diffOut.split("\u0000").filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++][0];
    if (status === "R" || status === "C") {
      const from = parts[i++];
      const to = parts[i++];
      files.push({ path: to, status: status === "R" ? "renamed" : "copied", from });
    } else {
      const path = parts[i++];
      files.push({ path, status: status === "A" ? "added" : status === "D" ? "deleted" : "modified" });
    }
  }
  return { mergeBase, files };
}

function blobSha(repoRoot, ref, path) {
  try {
    return git(repoRoot, ["rev-parse", `${ref}:${path}`], { quiet: true });
  } catch {
    return null;
  }
}

export function readBlob(repoRoot, ref, path) {
  try {
    return git(repoRoot, ["show", `${ref}:${path}`], { quiet: true });
  } catch {
    return null;
  }
}

export function pairMergeBase(repoRoot, branchA, branchB, fallback) {
  try {
    return git(repoRoot, ["merge-base", branchA, branchB], { quiet: true });
  } catch {
    return fallback;
  }
}

/**
 * @param {{repoRoot: string, remote?: string, base?: string, branches?: string[], exclude?: string[]}} opts
 * @returns {{baseRef: string, baseCommit: string, branchesScanned: object[], branchesSkipped: string[], files: Map<string, object[]>}}
 */
export function scanGitBranches(opts) {
  const remote = opts.remote ?? "origin";
  git(opts.repoRoot, ["fetch", remote, "--prune"]);
  const baseRef = opts.base ?? resolveDefaultBase(opts.repoRoot, remote);
  const baseCommit = git(opts.repoRoot, ["rev-parse", baseRef]);
  const branches = opts.branches ?? discoverBranches(opts.repoRoot, baseRef, remote, opts.exclude ?? []);

  const branchesScanned = [];
  const branchesSkipped = [];
  const files = new Map();

  for (const branch of branches) {
    const result = changedFiles(opts.repoRoot, baseRef, branch);
    if (result === null) {
      branchesSkipped.push(branch);
      continue;
    }
    if (result.files.length === 0) continue;
    branchesScanned.push({ branch, forkPoint: result.mergeBase, filesTouched: result.files.length });
    for (const f of result.files) {
      if (!files.has(f.path)) files.set(f.path, []);
      files.get(f.path).push({
        branch,
        status: f.status,
        blob: f.status === "deleted" ? null : blobSha(opts.repoRoot, branch, f.path),
        ...(f.from ? { renamedFrom: f.from } : {}),
      });
    }
  }

  return { baseRef, baseCommit, branchesScanned, branchesSkipped, files };
}
