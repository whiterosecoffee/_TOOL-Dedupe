// Pipeline: for every file touched by 2+ branches, triage it into redundant / auto_mergeable /
// needs_variant. This is the branch-contention use case: many concurrent-session branches on
// one repo, need to know what's genuine disagreement (preserve as a variant) vs. everything else
// (dedupe or merge automatically, never touched by hand).
import { scanGitBranches, readBlob, pairMergeBase } from "../adapters/git-branches.mjs";
import { classifyContainment, extraLines } from "../core/containment.mjs";
import { tryAutoMerge } from "../core/merge3.mjs";

function classifyFile(repoRoot, path, entries, baseRef) {
  const live = entries.filter((e) => e.status !== "deleted");
  if (live.length < 2) return { verdict: "redundant", reason: "at most one branch retains content", pairwise: [] };

  const textCache = new Map();
  function textFor(e) {
    if (!textCache.has(e.branch)) textCache.set(e.branch, readBlob(repoRoot, e.branch, path));
    return textCache.get(e.branch);
  }

  const pairwise = [];
  let anyConflict = false;
  let allRedundant = true;

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i];
      const B = live[j];

      if (A.blob && B.blob && A.blob === B.blob) {
        pairwise.push({ a: A.branch, b: B.branch, verdict: "identical", via: "blob_sha" });
        continue;
      }

      const aText = textFor(A);
      const bText = textFor(B);
      if (aText === null || bText === null) {
        allRedundant = false;
        continue;
      }

      const containment = classifyContainment(aText, bText);
      if (containment === "identical") {
        pairwise.push({ a: A.branch, b: B.branch, verdict: "identical", via: "content_read" });
        continue;
      }
      if (containment === "a_subset_of_b") {
        // Recorded difference, not just the relationship: exactly what B's branch has that A's
        // doesn't. A's content isn't discarded from the record -- both branch names stay
        // pointed-to in `pairwise` -- only its extra-vs-B delta is what gets named here (empty).
        pairwise.push({ a: A.branch, b: B.branch, verdict: "a_subset_of_b", fuller: B.branch, extra: extraLines(aText, bText) });
        continue;
      }
      if (containment === "b_subset_of_a") {
        pairwise.push({ a: A.branch, b: B.branch, verdict: "b_subset_of_a", fuller: A.branch, extra: extraLines(bText, aText) });
        continue;
      }

      allRedundant = false;
      const baseText = readBlob(repoRoot, pairMergeBase(repoRoot, A.branch, B.branch, baseRef), path) ?? "";
      const { clean } = tryAutoMerge(baseText, aText, bText);
      if (clean) {
        pairwise.push({ a: A.branch, b: B.branch, verdict: "auto_mergeable" });
      } else {
        pairwise.push({ a: A.branch, b: B.branch, verdict: "conflict" });
        anyConflict = true;
      }
    }
  }

  const verdict = anyConflict ? "needs_variant" : allRedundant ? "redundant" : "auto_mergeable";
  return { verdict, pairwise };
}

/**
 * @param {{repoRoot: string, remote?: string, base?: string, branches?: string[], exclude?: string[]}} opts
 */
export function runGitDedupe(opts) {
  const scan = scanGitBranches(opts);
  const contended = [...scan.files.entries()].filter(([, entries]) => entries.length > 1);

  const report = {
    generatedAt: new Date().toISOString(),
    baseRef: scan.baseRef,
    baseCommit: scan.baseCommit,
    branchesScanned: scan.branchesScanned,
    branchesSkipped: scan.branchesSkipped,
    totalFilesTouched: scan.files.size,
    totalContended: contended.length,
    files: {},
    summary: { redundant: 0, auto_mergeable: 0, needs_variant: 0 },
  };

  for (const [path, entries] of contended) {
    const result = classifyFile(opts.repoRoot, path, entries, scan.baseRef);
    report.files[path] = { branches: entries.map((e) => e.branch), verdict: result.verdict, pairwise: result.pairwise, reason: result.reason };
    report.summary[result.verdict]++;
  }

  return report;
}
