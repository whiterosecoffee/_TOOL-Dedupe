import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFilesDedupe } from "../src/pipelines/files-dedupe.mjs";
import { auditZeroLoss } from "../src/core/audit.mjs";
import { classifyContainment } from "../src/core/containment.mjs";
import { normalizeText } from "../src/core/normalize.mjs";

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "de-dupe-p1-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const nlines = (n, p = "line") => Array.from({ length: n }, (_, i) => `${p}${i}`).join("\n") + "\n";

test("1.1 audit.mjs imports nothing from the pipeline's own core modules (independence)", () => {
  const src = readFileSync(new URL("../src/core/audit.mjs", import.meta.url), "utf8");
  assert.equal(/from\s+["']\.\/(hash|containment|normalize|cluster|similarity)\.mjs["']/.test(src), false);
});

test("1.1 audit flags a duplicate the report MISSED (completeness)", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "a.md"), "same\n");
    writeFileSync(join(dir, "b.md"), "same\n");
    const report = { exactDuplicateGroups: [], containmentPairs: [], fileIds: ["a.md", "b.md"] };
    const r = auditZeroLoss(report, dir);
    assert.equal(r.pass, false);
    assert.equal(r.failures[0].type, "missed_exact_duplicate");
  });
});

test("1.1 audit catches a false containment claim and a wrong `extra` list", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "sub.md"), "a\nb\nc\n");
    writeFileSync(join(dir, "full.md"), "x\na\nb\nc\ny\n");
    writeFileSync(join(dir, "other.md"), "c\nb\na\n");
    const bad = auditZeroLoss({ exactDuplicateGroups: [], containmentPairs: [{ subset: "sub.md", superset: "other.md", extra: [] }] }, dir);
    assert.equal(bad.failures[0].type, "containment_pair");
    const wrongExtra = auditZeroLoss({ exactDuplicateGroups: [], containmentPairs: [{ subset: "sub.md", superset: "full.md", extra: [{ line: 0, text: "x" }] }] }, dir);
    assert.equal(wrongExtra.failures[0].type, "containment_extra_mismatch");
  });
});

test("1.2 tiny files are not reported as subsets under default guards", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "tiny.md"), "}\n");
    writeFileSync(join(dir, "big.md"), nlines(10) + "}\n");
    const report = runFilesDedupe({ dir });
    assert.equal(report.containmentPairs.length, 0);
    const loose = runFilesDedupe({ dir, minSubsetLines: 1 });
    assert.equal(loose.containmentPairs.length, 1);
  });
});

test("1.2 maxSizeRatio rejects a subset dwarfed by its superset", () => {
  const small = nlines(5);
  const huge = nlines(5) + nlines(200, "more");
  assert.equal(classifyContainment(small, huge, { maxSizeRatio: 10 }), "neither");
  assert.equal(classifyContainment(small, huge, { maxSizeRatio: 100 }), "a_subset_of_b");
});

test("1.3 containment chains resolve to the final surviving superset", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "a.md"), nlines(5));
    writeFileSync(join(dir, "b.md"), nlines(5) + nlines(2, "b"));
    writeFileSync(join(dir, "c.md"), nlines(5) + nlines(2, "b") + nlines(2, "c"));
    const report = runFilesDedupe({ dir });
    const aPair = report.containmentPairs.find((p) => p.subset === "a.md" && p.superset === "b.md");
    assert.ok(aPair);
    assert.deepEqual(aPair.finalSupersets, ["c.md"]);
    assert.equal(report.afterContainment, 1);
    assert.equal(auditZeroLoss(report, dir).pass, true);
  });
});

test("1.4 normalizeText handles CRLF, BOM, trailing whitespace", () => {
  assert.equal(normalizeText("\uFEFFa  \r\nb\t\r\nc"), "a\nb\nc");
});

test("1.4 CRLF and LF copies group as duplicates only with --normalize, and are flagged", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "lf.md"), "one\ntwo\nthree\n");
    writeFileSync(join(dir, "crlf.md"), "one\r\ntwo\r\nthree\r\n");
    assert.equal(runFilesDedupe({ dir }).exactDuplicateGroups.length, 0);
    const report = runFilesDedupe({ dir, normalize: true });
    assert.equal(report.exactDuplicateGroups.length, 1);
    assert.equal(report.exactDuplicateGroups[0].normalizedMatch, true);
    assert.equal(report.options.normalize, true);
    assert.equal(auditZeroLoss(report, dir).pass, true);
  });
});
