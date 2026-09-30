import { test } from "node:test";
import assert from "node:assert/strict";
import { contentHash, exactDedupe } from "../src/core/hash.mjs";

test("same content, same hash, regardless of source", () => {
  assert.equal(contentHash("hello world"), contentHash("hello world"));
});

test("different content, different hash", () => {
  assert.notEqual(contentHash("hello"), contentHash("world"));
});

test("exactDedupe groups identical records and keeps one representative", () => {
  const records = [
    { id: "a", content: "same" },
    { id: "b", content: "same" },
    { id: "c", content: "different" },
  ];
  const { groups, unique } = exactDedupe(records);
  const dupGroup = [...groups.values()].find((ids) => ids.length === 2);
  assert.deepEqual(new Set(dupGroup), new Set(["a", "b"]));
  assert.equal(unique.length, 2); // one "same" representative + "different"
});
