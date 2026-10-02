# Synthesis and plan (v1 draft)

Status: draft for the owner's review. Built from the four research files in this folder
(01 record linkage, 02 near-duplicate detection, 03 semantic/idea-level, 04 diff/merge/clustering/
verification). Their claims are tagged unverified where the researchers could not confirm them;
this document inherits those caveats. The earlier implementation in this repo (`src/`, `test/`,
`experiments/`) is treated as a **baseline to beat**, and the old handoff/plan files as archive.
None of the old task list is a requirement here.

## 1. The problem (stated fresh)
Many independent contributors produce overlapping text. Most overlap is redundant; some is a real
disagreement. Output wanted: a small set of things a human must look at, and a **provable**
account that everything else was safely collapsed. The hard constraint is no information loss, so
the measure of success is not "how much did we remove" but "how many unsafe merges, and how big is
the human-review band".

## 2. What the research converges on
Four independent surveys point at the same shape:

1. **Similarity only proposes; something exact decides.** MinHash/LSH/SimHash/embeddings are
   candidate generators (02: shingles discard order, a reordering can score 100%; 03: embeddings
   score negations/antonyms high). Deciding a collapse needs an exact step (diff/LCS, hash).
2. **Three outcomes, not two.** Fellegi-Sunter's link / possible-link / non-link (01), and the
   identical / equivalent-with-guards / needs-human split (03). The size of the middle band is the
   tool's main output.
3. **Containment is directional; Jaccard is the wrong score for subset collapse** (02). Report
   c(A,B) and c(B,A) separately.
4. **Union-find over similarity chains** (01, 02, 04: BigCode's connected-components collapse and
   sklearn's single-linkage warning). Clusters must be built from *verified* edges and checked for
   density / bridges before auto-collapse.
5. **Collapse must be reversible and checkable**: canonical content + per-variant delta, verified
   by round-trip hash (04); content-addressed blocks with manifests (02); never delete on a
   similarity or LLM signal alone (03).
6. **Calibrate without labels by sampling random pairs** (01, Splink's u-probability idea), and treat
   resulting thresholds as proposals to audit.
7. **Evidence gap, important:** no source measures paragraph-level vs whole-file comparison for
   dedup (03). That is a design inference, so this project should measure it itself.

## 3. Where the baseline (v0) differs
v0 is exact hash, line-subsequence containment, TF-IDF cosine, union-find. Against the research it
(a) compares whole files only, (b) uses a symmetric similarity score with a hand-set 0.65 cut,
(c) chains clusters with no density check, (d) has no random-pair calibration, (e) has no delta
representation (it records `extra` lines for containment only), (f) was never scored against
ground truth. Its audit is a good idea worth keeping in spirit (independent re-derivation).

## 4. Proposed design (to be tested, not assumed)
Tiers from cheap and certain to expensive:

- **T0 canonicalize + exact hash.** Normalization rules are recorded in the report.
- **T1 candidates.** For small corpora (< ~10^4 files, per 02) compare all pairs on sketches; above
  that add banded MinHash on multiset 5-word shingles. Union several cheap passes. Count candidate
  pairs before scoring and log anything skipped.
- **T2 exact directional containment** on candidate pairs, at **paragraph/block level** as well as
  whole-file, giving c(A,B), c(B,A) and the matching block spans.
- **T3 ordered diff** (two algorithms; disagreement is flagged) to classify each pair: identical,
  A⊂B, reorder, disjoint-edit, contested. Contested hunks, with a base from merge-base or a cluster
  pseudo-base, are what humans see.
- **Optional guards** (numbers, negation, entities) and an off-by-default LLM judge on the shortlist
  only, never able to delete.
- **Clustering from verified edges only**, then clique/density/bridge/threshold-sweep checks decide
  auto-collapse vs human review.
- **Output is non-destructive**: canonical text + per-variant delta, round-trip SHA-256 verified,
  with the independent audit re-deriving claims from disk.

## 5. How we will know it is better (evaluation)
Metrics, from 01 and 04: unsafe-merge count (primary), B-cubed precision/recall, blocking recall
reported separately, human-review band size, comparisons per stage, and property tests (round trip,
conservation of unique content, order independence, idempotence, an injected unique sentence must
surface). Everything is scored against ground truth, which we generate (see spike).

## 6. First spike (proposed; nothing built yet)
Question: does comparing at paragraph/block level beat whole-file comparison on unsafe merges and
review-band size, and how does baseline v0 score at all?

1. Build a **ground-truth fixture generator**: synthesize a corpus with planted relationships (exact
   copies, CRLF variants, subsets, reorderings, additive edits, genuine conflicting edits, negated
   sentences, boilerplate-only overlap, unrelated text), recording the true label for every pair.
2. Build a small **evaluation harness** computing the section 5 metrics from any tool's output.
3. Run **baseline v0** through it (first honest score for the old attempt).
4. Implement the minimal new path (T0, T2 whole-file vs block level, T3 classification) and compare.
Success: a table of v0 vs whole-file vs block-level on the metrics above; a written conclusion
either way. Zero new dependencies for the spike.

## 7. Decisions needed from the owner
- Language/runtime for the new work: keep Node (zero-dependency baseline exists) or move to Python
  (datasketch, Hypothesis, Splink available)? The research libraries are mostly Python.
- Scope of the corpus: text/markdown files only, or also git branch variants?
- Whether any LLM-based component is acceptable at all (cost, privacy, offline requirement).

## 8. Known weak points in the research
- Several fetches failed or were paraphrased (Myers paper, diff3 PDF, correlation clustering, Splink
  docs, LSH Ensemble PDF); those claims are tagged unverified in files 01-04.
- RefinedWeb banding numbers conflict between sources (20x450 vs 450x20) and were not resolved.
- No source covers numeric/date sensitivity of embedding dedup.
- Vendor claims (Zingg scale) are unverified.
