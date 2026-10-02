// Scores any tool's per-pair verdicts against ground truth.
// verdict: {v: "collapse"|"review"|"separate", subset?: id, type?: truth-class}
//   collapse = tool claims one doc is safely redundant (identical, or `subset` is inside the other).
//   review   = tool sends the pair to a human (optionally with a guessed `type`).
//   separate = tool leaves the pair alone.
// Safe collapse means: truth identical (any direction), or truth subset with the SAME direction.
const COLLAPSE_REQUIRED = new Set(["identical", "subset"]);
const NEEDS_REVIEW = new Set(["reorder", "additive", "conflict"]);
const SHOULD_SEPARATE = new Set(["unrelated", "trivial"]);

export function isSafeCollapse(t, v) {
  if (t.cls === "identical") return true;
  if (t.cls === "subset") return v.subset === t.subset;
  return false;
}

export function score(truth, verdicts, comparisons = null) {
  const m = {
    pairs: 0,
    unsafeMerges: 0,
    collapseRequired: 0,
    collapsedSafely: 0,
    needsReview: 0,
    surfaced: 0,
    hiddenByCollapse: 0,
    shouldSeparate: 0,
    falseReview: 0,
    reviewBand: 0,
    typedCount: 0,
    typedCorrect: 0,
    comparisons,
    byTruth: {},
  };
  for (const [key, t] of truth) {
    const v = verdicts.get(key) ?? { v: "separate" };
    m.pairs++;
    (m.byTruth[t.cls] ??= { collapse: 0, review: 0, separate: 0 })[v.v]++;
    if (v.v === "review") m.reviewBand++;
    if (v.v === "collapse" && !isSafeCollapse(t, v)) m.unsafeMerges++;
    if (COLLAPSE_REQUIRED.has(t.cls)) {
      m.collapseRequired++;
      if (v.v === "collapse" && isSafeCollapse(t, v)) m.collapsedSafely++;
    }
    if (NEEDS_REVIEW.has(t.cls)) {
      m.needsReview++;
      if (v.v === "review") m.surfaced++;
      if (v.v === "collapse") m.hiddenByCollapse++;
      if (v.v === "review" && v.type) {
        m.typedCount++;
        if (v.type === t.cls) m.typedCorrect++;
      }
    }
    if (SHOULD_SEPARATE.has(t.cls) && v.v === "review") m.falseReview++;
  }
  return m;
}

export function merge(a, b) {
  const out = { ...a, byTruth: structuredClone(a.byTruth) };
  for (const k of Object.keys(b)) {
    if (k === "byTruth") {
      for (const [cls, row] of Object.entries(b.byTruth)) {
        out.byTruth[cls] ??= { collapse: 0, review: 0, separate: 0 };
        for (const x of Object.keys(row)) out.byTruth[cls][x] += row[x];
      }
    } else if (typeof b[k] === "number") out[k] = (out[k] ?? 0) + b[k];
  }
  return out;
}
