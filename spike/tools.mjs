// The four tools scored by the spike. Each takes a corpus directory and returns
// {verdicts: Map<pairKey, verdict>, comparisons}. None sees ground truth.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runFilesDedupe } from "../src/pipelines/files-dedupe.mjs";
import { pairKey } from "./gen-corpus.mjs";
import { paragraph } from "./segment.mjs";

function readAll(dir) {
  return readdirSync(dir).sort().map((id) => ({ id, text: readFileSync(join(dir, id), "utf8") }));
}
function allPairs(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  return out;
}

// ---- Baseline: the earlier implementation in src/, mapped onto per-pair verdicts. ----
export function toolV0(dir, { normalize = false } = {}) {
  const r = runFilesDedupe({ dir, normalize, similarityThreshold: 0.65 });
  const classOf = new Map(r.fileIds.map((id) => [id, [id]]));
  for (const g of r.exactDuplicateGroups) for (const id of g.ids) classOf.set(id, g.ids);
  const verdicts = new Map();
  const set = (a, b, val) => verdicts.set(pairKey(a, b), val);
  for (const g of r.exactDuplicateGroups) for (const [a, b] of allPairs(g.ids)) set(a, b, { v: "collapse" });
  for (const p of r.containmentPairs) {
    for (const x of classOf.get(p.subset)) for (const y of classOf.get(p.superset)) set(x, y, { v: "collapse", subset: x });
  }
  for (const c of r.similarityClusters) {
    const members = c.ids.flatMap((id) => classOf.get(id));
    for (const [a, b] of allPairs(members)) if (!verdicts.has(pairKey(a, b))) set(a, b, { v: "review" });
  }
  const n = r.fileIds.length;
  return { verdicts, comparisons: (n * (n - 1)) / 2 };
}

// ---- Ablation "similarity decides": 5-word shingle containment >= 0.95 triggers collapse. ----
function shingles(text, w = 5) {
  const toks = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const m = new Map();
  for (let i = 0; i + w <= toks.length; i++) {
    const s = toks.slice(i, i + w).join(" ");
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return m;
}
export function toolShingle(dir, { collapseAt = 0.95, reviewAt = 0.5 } = {}) {
  const docs = readAll(dir).map((d) => ({ id: d.id, sh: shingles(d.text) }));
  const total = (m) => [...m.values()].reduce((s, x) => s + x, 0);
  const inter = (a, b) => [...a].reduce((s, [k, v]) => s + Math.min(v, b.get(k) ?? 0), 0);
  const verdicts = new Map();
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const A = docs[i];
      const B = docs[j];
      const x = inter(A.sh, B.sh);
      const cAB = x / total(A.sh);
      const cBA = x / total(B.sh);
      const jac = x / (total(A.sh) + total(B.sh) - x);
      let v = { v: "separate" };
      if (cAB >= collapseAt && cBA >= collapseAt) v = { v: "collapse" };
      else if (cAB >= collapseAt) v = { v: "collapse", subset: A.id };
      else if (cBA >= collapseAt) v = { v: "collapse", subset: B.id };
      else if (jac >= reviewAt) v = { v: "review" };
      verdicts.set(pairKey(A.id, B.id), v);
    }
  }
  return { verdicts, comparisons: (docs.length * (docs.length - 1)) / 2 };
}

// ---- New path: paragraph blocks, exact ordered verification, typed triage. ----
function lcsLen(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}
const counts = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
function tokenJaccard(a, b) {
  const sa = new Set(a.toLowerCase().split(/\W+/));
  const sb = new Set(b.toLowerCase().split(/\W+/));
  let i = 0;
  for (const x of sa) if (sb.has(x)) i++;
  return i / (sa.size + sb.size - i);
}

// minBlocks and minWords both guard against tiny files being called "subsets" (a lone header).
export function classifyBlocks(A, B, { minBlocks = 3, minWords = 0, nearBlock = 0.8, relatedFraction = 0.3 } = {}) {
  if (A.length === B.length && A.every((x, i) => x === B[i])) return { v: "collapse" };
  const lcs = lcsLen(A, B);
  const aInB = lcs === A.length && A.length < B.length;
  const bInA = lcs === B.length && B.length < A.length;
  if (aInB || bInA) {
    const small = aInB ? A : B;
    if (small.length < minBlocks || small.join(" ").split(" ").length < minWords) return { v: "separate" };
    return { v: "collapse", subsetIsA: aInB };
  }
  const ca = counts(A);
  const cb = counts(B);
  const same = ca.size === cb.size && [...ca].every(([k, v]) => cb.get(k) === v);
  if (same) return { v: "review", type: "reorder", shared: 1 };
  const shared = [...ca].reduce((s, [k, v]) => s + Math.min(v, cb.get(k) ?? 0), 0);
  const sharedFraction = shared / Math.min(A.length, B.length);
  if (sharedFraction < relatedFraction) return { v: "separate" };
  const aOnly = A.filter((x) => !cb.has(x));
  const bOnly = B.filter((x) => !ca.has(x));
  const contested = aOnly.some((x) => bOnly.some((y) => tokenJaccard(x, y) >= nearBlock));
  return { v: "review", type: contested ? "conflict" : "additive", shared: sharedFraction };
}

export function toolBlock(dir, { segment = paragraph, minWords = 0 } = {}) {
  const docs = readAll(dir).map((d) => ({ id: d.id, blocks: segment(d.text) }));
  const index = new Map(); // block -> doc indexes (cheap candidate generation)
  docs.forEach((d, i) => new Set(d.blocks).forEach((b) => index.set(b, [...(index.get(b) ?? []), i])));
  const candidates = new Set();
  for (const list of index.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) candidates.add(`${list[x]}|${list[y]}`);
  const verdicts = new Map();
  for (const c of candidates) {
    const [i, j] = c.split("|").map(Number);
    const r = classifyBlocks(docs[i].blocks, docs[j].blocks, { minWords });
    const v = { v: r.v };
    if (r.type) v.type = r.type;
    if (r.v === "collapse" && r.subsetIsA !== undefined) v.subset = r.subsetIsA ? docs[i].id : docs[j].id;
    verdicts.set(pairKey(docs[i].id, docs[j].id), v);
  }
  return { verdicts, comparisons: candidates.size };
}

/**
 * Multi-segmentation: run the same exact classifier under several segmentations.
 * - collapse if ANY segmentation exactly verifies identity/ordered containment (each check is exact on
 *   its own units, so adding more segmentations can add recall but is not itself a similarity guess);
 *   conflicting directions across segmentations => review instead.
 * - otherwise review only if at least `agree` segmentations send the pair to review; type comes from
 *   the review with the highest shared-unit fraction.
 */
export function toolMulti(dir, { segments, minWords = 60, agree = 2 } = {}) {
  const docs = readAll(dir).map((d) => ({ id: d.id, units: segments.map((seg) => seg(d.text)) }));
  const index = new Map();
  docs.forEach((d, i) => d.units.forEach((u) => u.forEach((b) => (index.get(b) ?? index.set(b, new Set()).get(b)).add(i))));
  const cand = new Set();
  for (const set of index.values()) {
    const list = [...set];
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) cand.add(`${list[x]}|${list[y]}`);
  }
  const verdicts = new Map();
  for (const c of cand) {
    const [i, j] = c.split("|").map(Number);
    const rs = segments.map((_, k) => classifyBlocks(docs[i].units[k], docs[j].units[k], { minWords }));
    const key = pairKey(docs[i].id, docs[j].id);
    const collapses = rs.filter((r) => r.v === "collapse");
    if (collapses.length) {
      const dirs = new Set(collapses.filter((r) => r.subsetIsA !== undefined).map((r) => r.subsetIsA));
      if (dirs.size > 1) verdicts.set(key, { v: "review" });
      else {
        const v = { v: "collapse" };
        if (dirs.size === 1) v.subset = [...dirs][0] ? docs[i].id : docs[j].id;
        verdicts.set(key, v);
      }
      continue;
    }
    const reviews = rs.filter((r) => r.v === "review");
    if (reviews.length >= agree) {
      const best = reviews.reduce((a, b) => (b.shared > a.shared ? b : a));
      verdicts.set(key, { v: "review", type: best.type });
    }
  }
  return { verdicts, comparisons: cand.size };
}
