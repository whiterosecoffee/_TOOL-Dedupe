import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterBySimilarity } from "../src/core/cluster.mjs";

test("clusters near-duplicate records together, leaves unrelated ones as singletons", () => {
  const records = [
    { id: "a1", content: "concurrent sessions racing one shared git branch cause commit bundling races" },
    { id: "a2", content: "many concurrent sessions on one shared branch produce commit bundling races" },
    { id: "b1", content: "the quarterly financial results exceeded analyst expectations significantly" },
  ];
  const { clusters } = clusterBySimilarity(records, 0.5);
  const clusterLists = [...clusters.values()];
  assert.equal(clusterLists.length, 1, "expected exactly one cluster (a1+a2); b1 should be a dropped singleton");
  assert.deepEqual(new Set(clusterLists[0]), new Set(["a1", "a2"]));
});

test("threshold too high finds no clusters at all -- an honest empty result, not a forced match", () => {
  const records = [
    { id: "a1", content: "concurrent sessions racing one shared git branch cause commit bundling races" },
    { id: "a2", content: "many concurrent sessions on one shared branch produce commit bundling races" },
  ];
  const { clusters } = clusterBySimilarity(records, 0.999);
  assert.equal(clusters.size, 0);
});
