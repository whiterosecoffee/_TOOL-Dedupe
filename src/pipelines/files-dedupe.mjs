// Pipeline: given a plain directory of files (no branches, no git history, no shared logical
// key across records), find (1) exact duplicates, (2) containment relationships, and
// (3) semantically-similar clusters among what's left. This is the "gigs of unstructured data"
// use case, as far as this repo currently goes without a real embedding model -- see
// core/similarity.mjs's header for the honest TF-IDF-not-embeddings caveat and upgrade path.
import { loadRecordsFromDirectory } from "../adapters/files.mjs";
import { exactDedupe } from "../core/hash.mjs";
import { classifyContainment } from "../core/containment.mjs";
import { clusterBySimilarity } from "../core/cluster.mjs";

/**
 * @param {{dir: string, extensions?: Set<string>, ignoreDirs?: Set<string>, similarityThreshold?: number}} opts
 */
export function runFilesDedupe(opts) {
  const records = loadRecordsFromDirectory(opts.dir, opts);
  const { groups, unique } = exactDedupe(records);

  const exactDuplicateGroups = [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids }));

  // Containment: pairwise over survivors of exact dedupe. O(n^2) -- fine at hundreds of files,
  // would need the similarity layer's clustering as a pre-filter (only compare within a cluster)
  // before this scales to thousands; not built yet, see README's scale note.
  const containmentPairs = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const verdict = classifyContainment(unique[i].content, unique[j].content);
      if (verdict === "a_subset_of_b") containmentPairs.push({ subset: unique[i].id, superset: unique[j].id });
      else if (verdict === "b_subset_of_a") containmentPairs.push({ subset: unique[j].id, superset: unique[i].id });
      // "identical" can't happen here -- exactDedupe already collapsed those.
    }
  }

  const containedIds = new Set(containmentPairs.map((p) => p.subset));
  const remaining = unique.filter((r) => !containedIds.has(r.id));
  const { clusters, pairSimilarities } = clusterBySimilarity(remaining, opts.similarityThreshold ?? 0.65);

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: records.length,
    afterExactDedupe: unique.length,
    exactDuplicateGroups,
    containmentPairs,
    afterContainment: remaining.length,
    similarityClusters: [...clusters.values()],
    topSimilarPairs: pairSimilarities.slice(0, 20),
  };
}
