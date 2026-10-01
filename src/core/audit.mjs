// Independent zero-loss audit: re-derives every claim a files-dedupe report makes about exact
// duplicates and containment, straight from disk, WITHOUT importing any of the pipeline's own
// logic. Everything here is deliberately a separate implementation:
//   - equality is checked by comparing content directly (and a claimed hash is checked with
//     node:crypto called inline), not via core/hash.mjs
//   - containment is proved with a longest-common-subsequence DP, not the pipeline's greedy
//     isSubsequence
//   - the recorded `extra` lines are verified by deleting them from the superset and checking
//     what remains equals the subset, not by re-running extraLines
//   - normalization (when the report used it) is re-implemented here, not imported
// A bug in the pipeline's helpers therefore can't silently reproduce itself here. A test enforces
// that this file imports nothing from the rest of src/core.
//
// It also checks COMPLETENESS, not just the report's own claims: it re-reads every file the
// report says it considered and flags any exact duplicate the report failed to list.
//
// Similarity clusters are not audited for "loss": clustering only groups records, it never drops
// content. The discard-capable claims are exact-dedupe and containment, which are what this proves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

function normalizeIndependent(text) {
  let t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  t = t.split("\r\n").join("\n").split("\r").join("\n");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n");
}

/** Longest common subsequence length of two line arrays, two-row DP over interned line ids. */
function lcsLength(a, b) {
  const ids = new Map();
  const intern = (l) => {
    if (!ids.has(l)) ids.set(l, ids.size);
    return ids.get(l);
  };
  const x = a.map(intern);
  const y = b.map(intern);
  let prev = new Uint32Array(y.length + 1);
  let cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}

/**
 * @param {object} report  output of runFilesDedupe
 * @param {string} dir     the same directory the report was generated from
 * @returns {{pass: boolean, checked: number, completenessChecked: boolean, failures: object[]}}
 */
export function auditZeroLoss(report, dir) {
  const failures = [];
  let checked = 0;
  const normalize = report.options?.normalize ?? false;
  const cache = new Map();
  const read = (id) => {
    if (!cache.has(id)) {
      const raw = readFileSync(join(dir, id), "utf8");
      cache.set(id, normalize ? normalizeIndependent(raw) : raw);
    }
    return cache.get(id);
  };
  const lines = (id) => read(id).split("\n");
  const contained = (subId, superId) => {
    const sub = lines(subId);
    return lcsLength(sub, lines(superId)) === sub.length;
  };

  for (const group of report.exactDuplicateGroups) {
    checked++;
    const first = read(group.ids[0]);
    const allEqual = group.ids.every((id) => read(id) === first);
    const realHash = createHash("sha256").update(first, "utf8").digest("hex");
    if (!allEqual || realHash !== group.hash) {
      failures.push({ type: "exact_duplicate_group", ids: group.ids, claimedHash: group.hash, contentsAllEqual: allEqual, actualHash: realHash });
    }
  }

  for (const pair of report.containmentPairs) {
    checked++;
    if (!contained(pair.subset, pair.superset)) {
      failures.push({ type: "containment_pair", subset: pair.subset, superset: pair.superset, reason: "subset is NOT a subsequence of superset on fresh re-read (LCS check)" });
      continue;
    }
    // The recorded difference is itself a claim: deleting exactly the claimed extra lines from
    // the superset must leave exactly the subset, and each claimed line must really be there.
    const sub = lines(pair.subset);
    const full = lines(pair.superset);
    const claimed = pair.extra ?? [];
    const extraAt = new Map(claimed.map((l) => [l.line, l.text]));
    const textsMatch = claimed.every((l) => full[l.line] === l.text);
    const remainder = full.filter((_, idx) => !extraAt.has(idx));
    const remainderIsSubset = remainder.length === sub.length && remainder.every((l, i) => l === sub[i]);
    if (!textsMatch || !remainderIsSubset) {
      failures.push({ type: "containment_extra_mismatch", subset: pair.subset, superset: pair.superset, claimedExtra: claimed });
    }
    // Chain resolution is a claim too: every final superset must contain the subset (transitively).
    for (const finalId of pair.finalSupersets ?? []) {
      checked++;
      if (!contained(pair.subset, finalId)) {
        failures.push({ type: "containment_final_superset", subset: pair.subset, finalSuperset: finalId });
      }
    }
  }

  // Completeness: any two files the report considered that are in fact identical must appear
  // together in one reported exact-duplicate group; otherwise the report missed a duplicate.
  // Skipped for reports without a file list (older or hand-built ones).
  let completenessChecked = false;
  if (Array.isArray(report.fileIds)) {
    completenessChecked = true;
    const groupOf = new Map();
    report.exactDuplicateGroups.forEach((g, i) => g.ids.forEach((id) => groupOf.set(id, i)));
    const byContent = new Map();
    for (const id of report.fileIds) {
      checked++;
      const key = createHash("sha512").update(read(id), "utf8").digest("hex");
      if (!byContent.has(key)) byContent.set(key, []);
      byContent.get(key).push(id);
    }
    for (const ids of byContent.values()) {
      if (ids.length < 2) continue;
      const g = groupOf.get(ids[0]);
      if (g === undefined || !ids.every((id) => groupOf.get(id) === g)) {
        failures.push({ type: "missed_exact_duplicate", ids });
      }
    }
  }

  return { pass: failures.length === 0, checked, completenessChecked, failures };
}
