// Independent zero-loss audit: re-derives every claim a files-dedupe report makes about
// exact duplicates and containment, straight from disk, without reusing any of the pipeline's
// own in-memory state. This is deliberately NOT the pipeline grading its own homework -- it
// re-reads files fresh and re-runs the same checks from scratch, so a bug that produced a wrong
// verdict in the pipeline would have to reproduce identically here to go undetected, which a
// genuine logic bug generally won't.
//
// Similarity clusters are NOT audited here for "loss": clustering only groups records, it never
// drops content the way exact-dedupe and containment do. The actual information-loss risk is
// specifically: (1) exact-dedupe keeps one representative per hash and discards the rest, and
// (2) containment keeps the superset and discards the subset. Those are the two claims this
// audit exists to independently re-prove before either discard is trusted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash } from "./hash.mjs";
import { isSubsequence, extraLines } from "./containment.mjs";

function readFresh(dir, id) {
  return readFileSync(join(dir, id), "utf8");
}

/**
 * @param {object} report  output of runFilesDedupe
 * @param {string} dir     the same directory the report was generated from
 * @returns {{pass: boolean, checked: number, failures: object[]}}
 */
export function auditZeroLoss(report, dir) {
  const failures = [];
  let checked = 0;

  for (const group of report.exactDuplicateGroups) {
    checked++;
    const hashes = group.ids.map((id) => contentHash(readFresh(dir, id)));
    const allSame = hashes.every((h) => h === hashes[0]);
    if (!allSame || hashes[0] !== group.hash) {
      failures.push({ type: "exact_duplicate_group", ids: group.ids, claimedHash: group.hash, actualHashes: hashes });
    }
  }

  for (const pair of report.containmentPairs) {
    checked++;
    const subsetText = readFresh(dir, pair.subset);
    const supersetText = readFresh(dir, pair.superset);
    const reallyContained = isSubsequence(subsetText.split("\n"), supersetText.split("\n"));
    if (!reallyContained) {
      failures.push({ type: "containment_pair", subset: pair.subset, superset: pair.superset, reason: "subset is NOT actually a subsequence of superset on fresh re-read" });
      continue;
    }
    // The recorded difference is itself a claim -- re-derive it independently too, not just the
    // yes/no containment relationship. A wrong `extra` would mean the report understates what
    // the superset actually carries beyond the subset, which is its own form of loss.
    const actualExtra = extraLines(subsetText, supersetText);
    const claimedExtra = pair.extra ?? [];
    const matches = actualExtra.length === claimedExtra.length && actualExtra.every((l, i) => l.line === claimedExtra[i].line && l.text === claimedExtra[i].text);
    if (!matches) {
      failures.push({ type: "containment_extra_mismatch", subset: pair.subset, superset: pair.superset, claimedExtra, actualExtra });
    }
  }

  return { pass: failures.length === 0, checked, failures };
}
