// A declared manifest of every pass this tool runs, in order, so "cheapest and most certain
// first" is an inspectable fact (`dedupe passes`), not just a claim in the README that can drift
// out of sync with what the code actually does. Each entry names what it strips, what technique
// it uses, and its measured cost tier -- grounded in real runs (see README's "Measured results"),
// not estimated. This file does not implement anything itself; it documents the real pipeline
// code in src/core/* and src/pipelines/* in one place that's easy to check against reality.
export const PASSES = [
  {
    id: "scope",
    depth: 0,
    label: "Scope (directory/file selection)",
    costTier: "free",
    strips: "whole directories that aren't project content, before reading a single byte",
    technique: "filesystem metadata only: .gitignore bare-directory-name matching, extension filter, --max-files safety cap",
    certainty: "exact (a directory the repo owner already excluded is excluded)",
    implementedIn: "src/adapters/files.mjs (readGitignoreDirs, countRecordsInDirectory), `dedupe scan`",
    measured: "422-file real repo: 402ms, zero content reads, found a >99.75% scope reduction (170k-file archive excluded) that a prior run without this pass hung past 2 minutes trying to walk",
  },
  {
    id: "exact_hash",
    depth: 1,
    label: "Exact hash",
    costTier: "near-free",
    strips: "byte-identical duplicates",
    technique: "SHA-256 content hash per record",
    certainty: "exact (a hash collision at this length is not a real-world concern)",
    implementedIn: "src/core/hash.mjs",
    measured: "422 files: 150ms total",
  },
  {
    id: "containment",
    depth: 2,
    label: "Order-preserving containment",
    costTier: "expensive (O(n^2) pairs, but still exact)",
    strips: "records that are a strict ordered subsequence of another survivor",
    technique: "single-pass greedy subsequence match per pair, plus extraLines() to record the actual delta the fuller side carries",
    certainty: "exact (a real containment proof, not a similarity guess) -- the most expensive layer that is still zero-ambiguity",
    implementedIn: "src/core/containment.mjs",
    measured: "measured as 54-63% of total pipeline runtime across two real runs (228 and 422 files) -- the single biggest cost in the pipeline today",
  },
  {
    id: "merge3",
    depth: "2b",
    label: "3-way-merge mergeability (git pipeline only)",
    costTier: "moderate, bounded by construction",
    strips: "nothing new -- reclassifies a divergent pair as auto_mergeable instead of needs_variant",
    technique: "git merge-file against the pair's own true common ancestor",
    certainty: "exact (git's own merge resolution, not a guess)",
    implementedIn: "src/core/merge3.mjs, src/pipelines/git-dedupe.mjs",
    measured: "only ever runs on pairs that already survived containment -- bounded by every pass above it, not separately measured at scale yet",
  },
  {
    id: "similarity",
    depth: 3,
    label: "TF-IDF similarity",
    costTier: "expensive (O(n^2) pairs), approximate",
    strips: "nothing -- the first pass to leave exact certainty behind, correctly placed last among the discard-capable passes",
    technique: "zero-dependency vocabulary-overlap cosine similarity (not a real embedding model -- see src/core/similarity.mjs header for the upgrade path)",
    certainty: "approximate -- catches restated/templated content well (0.998-0.9999 scores in real testing), misses a deep paraphrase sharing little vocabulary",
    implementedIn: "src/core/similarity.mjs",
    measured: "measured as 29-36% of total pipeline runtime (reported together with clustering, which reuses the same pairwise computation)",
  },
  {
    id: "cluster",
    depth: 4,
    label: "Clustering",
    costTier: "included in similarity's O(n^2) pass",
    strips: "nothing -- grouping is not deletion; every id stays addressable in similarityClusters",
    technique: "union-find over the similarity graph from the pass above (a documented stand-in for real community detection / Leiden)",
    certainty: "approximate, inherits similarity's approximation plus its own transitive-merge risk (A~B~C~D doesn't mean A~D) -- not yet observed as a real problem at tested scale",
    implementedIn: "src/core/cluster.mjs",
    measured: "no runaway mega-cluster observed in either real run (406 -> 259 at the larger scale)",
  },
];

/** The one pass this manifest documents but doesn't implement yet -- named so the next
 * concrete step is explicit, not just implied by a README paragraph. */
export const PLANNED_NEXT_PASS = {
  id: "similarity_prefilter",
  depth: "1.5 (between exact_hash and containment)",
  label: "Cheap similarity pre-filter (MinHash/SimHash bucketing)",
  rationale:
    "Containment currently runs on every post-exact-hash pair, including pairs with nothing in common. Measured as the single most expensive pass (54-63% of runtime). A cheap signature-bucket pre-filter would cut its comparison count from 'all pairs' to 'pairs that already look similar' before paying for the real O(n+m) subsequence check -- the biggest remaining efficiency win identified, not yet built.",
};
