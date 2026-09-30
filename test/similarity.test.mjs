import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTfidfEmbedder, cosineSimilarity } from "../src/core/similarity.mjs";

test("cosineSimilarity: identical vectors score 1", () => {
  const corpus = ["the quick brown fox jumps over the lazy dog"];
  const embed = buildTfidfEmbedder(corpus);
  const v = embed(corpus[0]);
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
});

test("high vocabulary overlap scores higher than unrelated text", () => {
  const corpus = [
    "concurrent sessions racing one shared git branch cause commit bundling races",
    "many concurrent sessions on one shared branch produce commit bundling races",
    "the quarterly financial results exceeded analyst expectations significantly",
  ];
  const embed = buildTfidfEmbedder(corpus);
  const [a, b, c] = corpus.map(embed);
  const related = cosineSimilarity(a, b);
  const unrelated = cosineSimilarity(a, c);
  assert.ok(related > unrelated, `expected related (${related}) > unrelated (${unrelated})`);
  assert.ok(related > 0.5, `expected substantial overlap, got ${related}`);
});

test("empty text produces zero similarity, not a crash", () => {
  const embed = buildTfidfEmbedder(["something", ""]);
  assert.equal(cosineSimilarity(embed(""), embed("")), 0);
});
