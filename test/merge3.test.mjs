import { test } from "node:test";
import assert from "node:assert/strict";
import { tryAutoMerge } from "../src/core/merge3.mjs";

test("disjoint additive edits merge cleanly", () => {
  const base = "line1\nline2\nline3\n";
  const a = "line1\nline2\nline3\nadded-by-a\n";
  const b = "prepended-by-b\nline1\nline2\nline3\n";
  const { clean, merged } = tryAutoMerge(base, a, b);
  assert.equal(clean, true);
  assert.ok(merged.includes("added-by-a"));
  assert.ok(merged.includes("prepended-by-b"));
});

test("same-region conflicting edits do not merge cleanly", () => {
  const base = "line1\nline2\nline3\n";
  const a = "line1\nCHANGED-BY-A\nline3\n";
  const b = "line1\nCHANGED-BY-B\nline3\n";
  const { clean } = tryAutoMerge(base, a, b);
  assert.equal(clean, false);
});
