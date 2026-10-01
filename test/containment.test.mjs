import { test } from "node:test";
import assert from "node:assert/strict";
import { isSubsequence, classifyContainment, extraLines } from "../src/core/containment.mjs";

test("isSubsequence: order-preserving, not just line-set membership", () => {
  assert.equal(isSubsequence(["a", "b"], ["a", "x", "b"]), true);
  assert.equal(isSubsequence(["b", "a"], ["a", "b"]), false); // wrong order -- not a real subsequence
});

test("classifyContainment: identical content", () => {
  assert.equal(classifyContainment("x\ny", "x\ny"), "identical");
});

test("classifyContainment: real containment (superset has extra lines, same order)", () => {
  const a = "line1\nline2";
  const b = "header\nline1\nline2\nfooter";
  assert.equal(classifyContainment(a, b), "a_subset_of_b");
});

test("extraLines: names exactly what the fuller side has beyond the subset, nothing more", () => {
  const sub = "line1\nline2";
  const full = "header\nline1\nline2\nfooter";
  const extra = extraLines(sub, full);
  assert.deepEqual(extra.map((l) => l.text), ["header", "footer"]);
});

test("extraLines: on identical content, records zero difference -- correctly, not by omission", () => {
  const text = "same\ncontent";
  assert.deepEqual(extraLines(text, text), []);
});

test("classifyContainment: shared boilerplate lines out of order is NOT containment", () => {
  // This is the false-positive mode a naive line-set membership check would get wrong:
  // both share "header" and "footer" but their own unique content differs -- neither
  // actually contains the other's structure.
  const a = "header\nunique-to-a\nfooter";
  const b = "header\nunique-to-b\nfooter";
  assert.equal(classifyContainment(a, b), "neither");
});
