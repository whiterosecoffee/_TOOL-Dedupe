// Pipeline: given a plain directory of files (no branches, no git history, no shared logical
// key across records), find (1) exact duplicates, (2) containment relationships, and
// (3) semantically-similar clusters among what's left. This is the "gigs of unstructured data"
// use case, as far as this repo currently goes without a real embedding model -- see
// core/similarity.mjs's header for the honest TF-IDF-not-embeddings caveat and upgrade path.
import { loadRecordsFromDirectory } from "../adapters/files.mjs";
import { exactDedupe } from "../core/hash.mjs";
import { classifyContainment, extraLines } from "../core/containment.mjs";
import { clusterBySimilarity } from "../core/cluster.mjs";
import { normalizeText } from "../core/normalize.mjs";

const DEFAULT_MIN_SUBSET_LINES = 5;
const DEFAULT_MAX_SIZE_RATIO = 20;

/**
 * @param {{dir: string, extensions?: Set<string>, ignoreDirs?: Set<string>, similarityThreshold?: number,
 *          normalize?: boolean, minSubsetLines?: number, maxSizeRatio?: number}} opts
 *   normalize: compare after normalizing line endings/BOM/trailing whitespace (opt-in; recorded in the report).
 *   minSubsetLines / maxSizeRatio: containment guards against tiny-file false positives (see core/containment.mjs).
 */
export function runFilesDedupe(opts) {
  const timings = {};
  const funnel = [];
  const t0 = performance.now();

  const normalize = opts.normalize ?? false;
  const minSubsetLines = opts.minSubsetLines ?? DEFAULT_MIN_SUBSET_LINES;
  const maxSizeRatio = opts.maxSizeRatio ?? DEFAULT_MAX_SIZE_RATIO;
  const rawRecords = loadRecordsFromDirectory(opts.dir, opts);
  const rawById = new Map(rawRecords.map((r) => [r.id, r.content]));
  const records = normalize ? rawRecords.map((r) => ({ id: r.id, content: normalizeText(r.content) })) : rawRecords;
  timings.load_ms = Math.round(performance.now() - t0);
  funnel.push({ stage: "load", records_in: null, records_out: records.length });

  const t1 = performance.now();
  const { groups, unique } = exactDedupe(records);
  timings.exact_hash_ms = Math.round(performance.now() - t1);
  funnel.push({ stage: "exact_hash", records_in: records.length, records_out: unique.length });

  const exactDuplicateGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => {
      const group = { hash, ids };
      // Flag groups that are only identical AFTER normalization, so a reviewer can tell a
      // byte-identical duplicate from a "same except line endings/whitespace" one.
      if (normalize && new Set(ids.map((id) => rawById.get(id))).size > 1) group.normalizedMatch = true;
      return group;
    });

  // Containment: pairwise over survivors of exact dedupe. O(n^2) -- fine at hundreds of files,
  // would need the similarity layer's clustering as a pre-filter (only compare within a cluster)
  // before this scales to thousands; not built yet, see README's scale note.
  const t2 = performance.now();
  const containmentPairs = [];
  let containmentComparisons = 0;
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      containmentComparisons++;
      const verdict = classifyContainment(unique[i].content, unique[j].content, { minSubsetLines, maxSizeRatio });
      if (verdict === "a_subset_of_b") {
        containmentPairs.push({
          subset: unique[i].id,
          superset: unique[j].id,
          // The recorded difference: exactly what the superset has that the subset doesn't.
          // Nothing about the subset's content is discarded silently -- it's fully represented
          // by the superset (that's what containment means), and this names the delta on top.
          extra: extraLines(unique[i].content, unique[j].content),
        });
      } else if (verdict === "b_subset_of_a") {
        containmentPairs.push({ subset: unique[j].id, superset: unique[i].id, extra: extraLines(unique[j].content, unique[i].content) });
      }
      // "identical" can't happen here -- exactDedupe already collapsed those.
    }
  }
  timings.containment_ms = Math.round(performance.now() - t2);

  // Resolve chains: if A is in B and B is in C, A's real surviving superset is C, not B (B is
  // itself discarded). Containment is transitive and acyclic here (mutual containment would mean
  // identical text, already collapsed), so following supersets always terminates.
  const supersetsOf = new Map();
  for (const p of containmentPairs) {
    if (!supersetsOf.has(p.subset)) supersetsOf.set(p.subset, []);
    supersetsOf.get(p.subset).push(p.superset);
  }
  const finalSupersetsOf = (id, seen = new Set()) => {
    const direct = supersetsOf.get(id);
    if (!direct) return [id];
    const out = new Set();
    for (const s of direct) {
      if (seen.has(s)) continue;
      seen.add(s);
      for (const f of finalSupersetsOf(s, seen)) out.add(f);
    }
    return [...out];
  };
  for (const p of containmentPairs) p.finalSupersets = finalSupersetsOf(p.superset);

  const containedIds = new Set(containmentPairs.map((p) => p.subset));
  const remaining = unique.filter((r) => !containedIds.has(r.id));
  funnel.push({ stage: "containment", records_in: unique.length, records_out: remaining.length, comparisons: containmentComparisons });

  const t3 = performance.now();
  const { clusters, pairSimilarities } = clusterBySimilarity(remaining, opts.similarityThreshold ?? 0.65);
  timings.similarity_cluster_ms = Math.round(performance.now() - t3);
  const clusteredIds = new Set([...clusters.values()].flat());
  funnel.push({
    stage: "similarity_cluster",
    records_in: remaining.length,
    records_out: remaining.length - clusteredIds.size + clusters.size, // singletons + one representative per cluster
    comparisons: (remaining.length * (remaining.length - 1)) / 2,
  });
  timings.total_ms = Math.round(performance.now() - t0);

  // Clustering only groups records -- it never discards one in favor of another the way exact
  // dedupe and containment do (nothing above the threshold gets thrown away). What's worth
  // recording per cluster isn't a difference to prove nothing was lost (nothing was), but the
  // actual pairwise scores that justified grouping them -- so a reviewer sees exactly how related
  // each member is to the others, not just an opaque bag of ids.
  const similarityById = new Map(pairSimilarities.map((p) => [`${p.a}|${p.b}`, p.score]));
  const similarityClusters = [...clusters.values()].map((ids) => {
    const internalPairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const score = similarityById.get(`${ids[i]}|${ids[j]}`) ?? similarityById.get(`${ids[j]}|${ids[i]}`);
        internalPairs.push({ a: ids[i], b: ids[j], score });
      }
    }
    return { ids, pairwiseScores: internalPairs };
  });

  return {
    generatedAt: new Date().toISOString(),
    options: { normalize, minSubsetLines, maxSizeRatio },
    fileIds: records.map((r) => r.id), // every file considered, so the audit can check for MISSED duplicates
    totalFiles: records.length,
    afterExactDedupe: unique.length,
    exactDuplicateGroups,
    containmentPairs,
    afterContainment: remaining.length,
    similarityClusters,
    topSimilarPairs: pairSimilarities.slice(0, 20),
    timings,
    funnel,
  };
}
