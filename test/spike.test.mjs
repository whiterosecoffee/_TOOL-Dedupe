import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCorpus, classifyTruth } from "../spike/gen-corpus.mjs";
import { score } from "../spike/eval.mjs";
import { classifyBlocks } from "../spike/tools.mjs";

const atoms = new Map([
  ["a", { text: "", root: "a", boiler: false }],
  ["b", { text: "", root: "b", boiler: false }],
  ["c", { text: "", root: "c", boiler: false }],
  ["d", { text: "", root: "d", boiler: false }],
  ["e", { text: "", root: "e", boiler: false }],
  ["f", { text: "", root: "f", boiler: false }],
  ["g", { text: "", root: "g", boiler: false }],
  ["b2", { text: "", root: "b", boiler: false }],
  ["h", { text: "", root: "h", boiler: true }],
]);

test("truth oracle: identical, subset, reorder, conflict, additive, unrelated, trivial", () => {
  const base = ["a", "b", "c", "d", "e"];
  assert.equal(classifyTruth(base, [...base], atoms).cls, "identical");
  assert.deepEqual(classifyTruth(base, [...base, "f"], atoms), { cls: "subset", subset: "a" });
  assert.equal(classifyTruth(base, ["e", "d", "c", "b", "a"], atoms).cls, "reorder");
  assert.equal(classifyTruth(base, ["a", "b2", "c", "d", "e"], atoms).cls, "conflict");
  assert.equal(classifyTruth([...base, "f"], [...base, "g"], atoms).cls, "additive");
  assert.equal(classifyTruth(base, ["f", "g", "h"], atoms).cls, "unrelated");
  assert.equal(classifyTruth(["h"], ["h", ...base], atoms).cls, "trivial");
});

test("generator is deterministic per seed and differs across seeds", () => {
  const a = generateCorpus(7, { families: 2 });
  const b = generateCorpus(7, { families: 2 });
  const c = generateCorpus(8, { families: 2 });
  assert.deepEqual(a.docs.map((d) => d.text), b.docs.map((d) => d.text));
  assert.notDeepEqual(a.docs.map((d) => d.text), c.docs.map((d) => d.text));
});

test("eval: a wrong-direction collapse and a collapse of a conflict both count as unsafe", () => {
  const truth = new Map([
    ["x|y", { cls: "subset", subset: "x" }],
    ["x|z", { cls: "conflict" }],
  ]);
  const verdicts = new Map([
    ["x|y", { v: "collapse", subset: "y" }],
    ["x|z", { v: "collapse", subset: "x" }],
  ]);
  const m = score(truth, verdicts);
  assert.equal(m.unsafeMerges, 2);
  assert.equal(m.hiddenByCollapse, 1);
});

test("block classifier: reorder never collapses, an edited block is a conflict", () => {
  const A = ["p1", "p2", "p3", "p4"];
  assert.equal(classifyBlocks(A, ["p4", "p3", "p2", "p1"]).type, "reorder");
  assert.equal(classifyBlocks(A, [...A, "p5"]).v, "collapse");
  const long = (w) => Array.from({ length: 30 }, (_, i) => (i === 15 ? w : `w${i}`)).join(" ");
  const r = classifyBlocks([long("alpha"), "x1", "x2", "x3"], [long("beta"), "x1", "x2", "x3"]);
  assert.equal(r.type, "conflict");
});
