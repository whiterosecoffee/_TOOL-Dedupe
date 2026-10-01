import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFilesDedupe } from "../src/pipelines/files-dedupe.mjs";
import { auditZeroLoss } from "../src/core/audit.mjs";

test("audit passes on a genuine report, straight from fresh disk reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "de-dupe-audit-"));
  try {
    writeFileSync(join(dir, "a.md"), "same content\n");
    writeFileSync(join(dir, "b.md"), "same content\n");
    writeFileSync(join(dir, "c.md"), "header\nsame content\nfooter\n");
    const report = runFilesDedupe({ dir, minSubsetLines: 1 });
    const result = auditZeroLoss(report, dir);
    assert.equal(result.pass, true);
    assert.ok(result.checked >= 2); // 1 exact-dup group + 1 containment pair
    assert.equal(result.failures.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit catches a tampered report -- a wrong hash claim does not silently pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "de-dupe-audit-tamper-"));
  try {
    writeFileSync(join(dir, "a.md"), "content-a\n");
    writeFileSync(join(dir, "b.md"), "content-b\n");
    // A deliberately false claim: report says these two are an exact-duplicate group, but
    // they aren't. This is what the audit exists to catch -- a report that lies (or a pipeline
    // bug that produces a wrong verdict) should fail loudly, not pass because it says so.
    const fakeReport = { exactDuplicateGroups: [{ hash: "not-the-real-hash", ids: ["a.md", "b.md"] }], containmentPairs: [] };
    const result = auditZeroLoss(fakeReport, dir);
    assert.equal(result.pass, false);
    assert.equal(result.failures[0].type, "exact_duplicate_group");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
