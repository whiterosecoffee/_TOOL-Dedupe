// Layer 3: for two records that diverge (not identical, not a containment relationship) but
// share a real common ancestor, does a proper 3-way merge resolve cleanly? If so, they're
// disjoint/additive edits, not a genuine disagreement -- merge them, don't preserve as variants.
// Ported from tools/branch-contention-dedupe (the Prompts repo's git-specific version); this
// copy is source-agnostic -- it takes raw text, not git refs, so it works for any adapter.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * @param {string} baseText  common-ancestor content (use "" if genuinely no ancestor exists --
 *                           git merge-file still works with an empty base, it just means every
 *                           line in either side counts as "added", so anything non-conflicting
 *                           still merges; a real disagreement still surfaces as a conflict)
 * @returns {{clean: boolean, merged: string|null}}
 */
export function tryAutoMerge(baseText, aText, bText) {
  const dir = mkdtempSync(join(tmpdir(), "de-dupe-merge3-"));
  const baseFile = join(dir, "base");
  const aFile = join(dir, "a");
  const bFile = join(dir, "b");
  writeFileSync(baseFile, baseText ?? "");
  writeFileSync(aFile, aText ?? "");
  writeFileSync(bFile, bText ?? "");
  let clean = false;
  let merged = null;
  try {
    merged = execFileSync("git", ["merge-file", "-p", aFile, baseFile, bFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    clean = true;
  } catch (err) {
    clean = false;
    merged = err.stdout ? err.stdout.toString() : null; // conflict-marked merge, if useful to inspect
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { clean, merged };
}
