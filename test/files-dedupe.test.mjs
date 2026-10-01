import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFilesDedupe } from "../src/pipelines/files-dedupe.mjs";

test("end-to-end: exact dup, containment, and similarity cluster all detected in one corpus", () => {
  const dir = mkdtempSync(join(tmpdir(), "de-dupe-test-"));
  try {
    writeFileSync(join(dir, "original.md"), "the quick brown fox jumps over the lazy dog\n");
    writeFileSync(join(dir, "exact-copy.md"), "the quick brown fox jumps over the lazy dog\n"); // exact dup
    writeFileSync(
      join(dir, "superset.md"),
      "header\nthe quick brown fox jumps over the lazy dog\nfooter\n"
    ); // contains original.md's content
    writeFileSync(
      join(dir, "paraphrase.md"),
      "concurrent sessions racing one shared git branch cause commit bundling races\n"
    );
    writeFileSync(
      join(dir, "paraphrase2.md"),
      "many concurrent sessions on one shared branch produce commit bundling races\n"
    );
    writeFileSync(join(dir, "unrelated.md"), "quarterly financial results exceeded analyst expectations\n");

    const report = runFilesDedupe({ dir, similarityThreshold: 0.5 });

    assert.equal(report.totalFiles, 6);
    assert.equal(report.exactDuplicateGroups.length, 1);
    assert.equal(report.exactDuplicateGroups[0].ids.length, 2);
    assert.equal(report.containmentPairs.length, 1);
    // Either exact-duplicate file can survive as exactDedupe's representative (readdir order
    // isn't guaranteed) -- assert the relationship, not which of the two duplicate ids it is.
    assert.ok(["original.md", "exact-copy.md"].includes(report.containmentPairs[0].subset));
    assert.equal(report.containmentPairs[0].superset, "superset.md");
    // The recorded difference: superset.md's extra lines beyond the subset's content.
    assert.deepEqual(
      report.containmentPairs[0].extra.map((l) => l.text),
      ["header", "footer"]
    );
    assert.equal(report.similarityClusters.length, 1);
    assert.deepEqual(new Set(report.similarityClusters[0].ids), new Set(["paraphrase.md", "paraphrase2.md"]));
    assert.equal(report.similarityClusters[0].pairwiseScores.length, 1);
    assert.ok(report.similarityClusters[0].pairwiseScores[0].score > 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
