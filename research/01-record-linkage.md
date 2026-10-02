# 01 - Record linkage and blocking: prior art for a text-file dedup/triage tool

Scope: Fellegi-Sunter, Splink, dedupe, recordlinkage, Zingg, blocking strategies, unlabeled threshold calibration, evaluation metrics. Independent research; repo code not consulted.
Convention: every non-trivial claim has a URL. "UNVERIFIED" = from memory/inference, not confirmed in a fetched source. Sources were fetched/search-summarised on 2026-10-01; search summaries are secondary, so claims resting only on them are marked (secondary).

## 1. Fellegi-Sunter (FS)
- What: pairwise model. For each field comparison, m = P(agree | true match), u = P(agree | non-match); the log-ratio gives a match weight, summed across fields. Three outcomes: link, possible link (clerical review), non-link. Two thresholds are set to control the error rates (false link rate mu, false non-link rate lambda) while minimising the possible-link zone. https://cs.cornell.edu/~shmat/courses/cs6434/fellegi-sunter.pdf (secondary: search summary), https://pubs.dbs.uni-leipzig.de/dc/node/742
- Needs: no labels in principle; m/u estimated by EM or supplied. Assumes conditional independence of field comparisons given match status (same sources).
- Failure modes: independence assumption violated by correlated fields (same sources; Splink docs say the same, section 2). Calibration drifts when the match rate is tiny.
- Borrow: the THREE-WAY decision with an explicit middle band is exactly "humans only see genuine disagreements". Auto-collapse above T_hi, auto-keep-separate below T_lo, human queue between. Make the middle band the product surface, and report its size.

## 2. Splink
- What: FS implementation running on SQL engines (DuckDB, Spark, etc.). Blocking rules generate candidate pairs; comparisons score them.
- Blocking guidance: equi-join conditions (a = b) are cheap; similarity-function filters (e.g. Levenshtein) are expensive because every pair must be generated first; AND is efficient, OR within one rule is very inefficient, so supply several separate rules instead. Start strict and loosen iteratively; measure with `count_comparisons_from_blocking_rules()` before running. https://moj-analytical-services.github.io/splink/topic_guides/blocking/performance.html
- Unsupervised training: (1) lambda (prior match probability) from user deterministic rules plus a guessed recall for them; (2) u probabilities from random pairs (almost all random pairs are non-matches); (3) m probabilities by EM on blocked pairs, run over several blocking passes ("round robin"). Caveats: conditional independence rarely holds; blocking biases the sample; wrong recall guess shifts lambda (usually modestly); EM can fail to converge on dirty fields, fixed by pinning m values or cleaning. https://moj-analytical-services.github.io/splink/topic_guides/training/training_rationale.html
- Clustering: `cluster_pairwise_predictions_at_threshold` uses connected components over pairs above a threshold (secondary) https://deepwiki.com/moj-analytical-services/splink/4.5-clustering . Connected components chain: A~B and B~C pulls A and C together even if A and C are dissimilar. That chaining/over-merge risk is generic to transitive closure (inference; also noted for multi-pass closure in section 6 source). Guidance on choosing the threshold without labels: not found in sources, UNVERIFIED.
- Scale: designed for millions of records, comparison count is the limit (same blocking page). Dependency: Python + SQL backend.
- Borrow: (a) u from random pairs is trivially applicable to documents: random document pairs give the "background similarity" distribution for free, no labels. (b) Count candidate pairs BEFORE scoring. (c) Multiple separate blocking passes, union of candidates. (d) Deterministic-rules-as-anchor for the prior.

## 3. dedupe (Python)
- What: supervised/active learning. A human labels pairs the model is most uncertain about; it learns field weights and also learns blocking predicates. Predicates are chosen by greedy set cover (Chvatal) to cover all labeled duplicate pairs while minimising comparisons. https://docs.dedupe.io/en/latest/API-documentation.html (search summary, secondary). The "how it works" page fetched gave no technical detail (https://docs.dedupe.io/en/latest/how-it-works/How-it-works.html), so clustering internals are UNVERIFIED here (my recollection: hierarchical clustering on pair scores, not verified).
- Needs: labels (tens to hundreds, interactive). Library API has Dedupe, RecordLink, Gazetteer classes (same source).
- Failure modes: structured-record oriented (named fields); with few labels the learned blocking can miss true pairs (inference, UNVERIFIED); in-memory scale limits (UNVERIFIED).
- Borrow: active learning that asks the human only about pairs nearest the decision boundary; "learn the blocking to guarantee coverage of known duplicates" = recall check against any confirmed pairs. Cheap form for us: each human verdict becomes a regression test for blocking recall.

## 4. recordlinkage (Python toolkit)
- Indexers: Full (all pairs, quadratic), Block (agree on key), SortedNeighbourhood (agree on sort key and neighbours within a window; suited to data with many spelling errors where plain blocking would exclude true pairs), Random (random pairs, for training unsupervised models). https://recordlinkage.readthedocs.io/en/latest/ref-index.html
- Classifiers incl. unsupervised ECM: not confirmed by the page fetched, UNVERIFIED (I recall it has KMeans and ECM classifiers).
- Needs: pandas; labels optional. Scale: in-memory pandas, so mid-size data (inference).
- Borrow: the index/compare/classify decomposition as clean module boundaries; Random index as an explicit sampler for calibration.

## 5. Zingg
- What: Spark-based ML entity resolution. Learns a blocking model (clusters near-similar records) plus a similarity classifier applied only inside blocks; claims comparisons reduced to ~0.05-1% of total; active-learning labeling from small samples; millions of records. https://github.com/zinggAI/zingg
- Needs: Spark, labels (interactive). Claims are vendor-stated, not independently verified.
- Borrow: little directly (Spark heavy); confirms the two-stage "learned blocker then classifier" pattern and the practice of reporting reduction ratio.

## 6. Blocking / indexing strategies
- Standard blocking: pairs must agree on a key. Cheap; one typo in the key loses the pair. (recordlinkage page above)
- Sorted neighbourhood / merge-purge (Hernandez and Stolfo 1995): sort by a key, compare within a sliding window; run multiple passes with different keys and take the transitive closure of results; multi-pass beats single-pass in time and accuracy. https://www.vldb.org/conf/1990/P347.PDF is NOT the paper (search hit was a different VLDB item); see summary at https://patents.justia.com/patent/5717915 and bibliographic mention https://bibsonomy.org/bibtex/0a652ac2235b30b76ed6e94af6648dd8 (secondary). Window size trades recall vs cost.
- Canopy clustering (McCallum, Nigam, Ungar 2000): cheap approximate distance builds overlapping canopies; exact distance only within a shared canopy; reported >10x speedup and 25% error reduction on citation matching. https://pubs.dbs.uni-leipzig.de/dc/files/McCallum2000Efficientclusteringofhighdimensionaldatasetswith.pdf ; https://en.wikipedia.org/wiki/Canopy_clustering_algorithm
- LSH / MinHash blocking: shingle each document (word k-shingles, typically k=3-10), MinHash signature estimates Jaccard, bands x rows control an S-curve: few bands/many rows = only very similar pairs collide; many bands/few rows = lower similarity collides. Shorter shingles = looser, more false positives. https://skeptric.com/minhash-lsh ; https://skeptric.com/minhash (secondary). One source claims datasketch's automatic threshold-to-parameters computation is "deeply flawed" (opinion, same skeptric pages); validate empirically.
- Survey: Papadakis et al., blocking vs filtering (filtering = quickly finding pairs satisfying a similarity threshold), meta-blocking prunes candidate pairs by weighting co-occurrence in blocks. https://arxiv.org/pdf/1905.06167
- Failure modes common to all: candidates missed by blocking are invisible to every later stage (recall ceiling); block-size skew (a huge block, e.g. boilerplate shared by thousands of files) blows up pair count; chain closure over-merges.
- Borrow for text files: size/hash/normalised-text key (exact tier), MinHash-LSH on shingles (near tier), sorted neighbourhood on content-derived keys as a complementary pass, union of passes, cap/skip oversize blocks but LOG them as unexamined (never silently drop).

## 7. Threshold calibration without labels
- EM on FS (Splink): see section 2. Works on mixtures where match/non-match score distributions are separable.
- Random-pair sampling for the non-match distribution (Splink u; recordlinkage Random index).
- Prior from deterministic anchor rules + assumed recall (Splink).
- Active learning with a handful of human verdicts near the boundary (dedupe/Zingg).
- Mixture-model idea for a similarity score histogram (bimodal fit, pick valley or set error-rate-targeted cutoffs): standard FS error-control framing, but concrete text-dedup recipes not found in sources, UNVERIFIED.
- Caveat: unsupervised calibration is only as good as its independence assumptions; treat thresholds as proposals to be audited, not truth.

## 8. Evaluation metrics
- Pairwise precision/recall/F1 over co-clustered pairs: simple, but dominated by large clusters (inference, UNVERIFIED in sources).
- B-cubed: per-element precision/recall averaged, then F1; reported as the only metric satisfying all four Amigo et al. clustering-quality constraints; ARI violates some. https://arxiv.org/pdf/1510.01714 ; https://pypi.org/project/bcubed ; https://e.humanities.uva.nl/publications/2022/heus_bcub22.pdf (secondary summaries).
- Cluster purity: fraction of each cluster in its majority class; ignores over-splitting (inference, UNVERIFIED).
- ER-blocking metrics: pair completeness (recall of blocking), reduction ratio, pairs quality; see survey https://arxiv.org/pdf/1905.06167 (names recalled from the field, UNVERIFIED on that page specifically).
- Borrow: report blocking recall (pair completeness) separately from classification quality; use B-cubed plus an "unsafe merge" count (merged groups containing any pair judged different) because for a never-lose-information tool precision of collapsing matters far more than recall.

## 9. Cross-cutting lessons for a text-file dedup tool
1. Three-way outcome with a human-review band (FS).
2. Count and bound candidate pairs before scoring; separate cheap blocking passes unioned (Splink, merge-purge).
3. Random document pairs give a free null distribution for calibration (Splink u).
4. Never trust connected components blindly; require cluster-level checks (e.g. min within-cluster similarity, diameter) before collapse, otherwise route to review. (Chaining risk: inference from the closure approach.)
5. Blocking recall is a hard ceiling; log skipped/oversized blocks.
6. Human verdicts double as labels for audit of blocking and thresholds (dedupe).
7. Collapse should be reversible: keep a record of every member and the evidence for each merge (no source; design requirement from the brief).

## 10. Not verified / gaps
- dedupe clustering algorithm and scale limits; recordlinkage ECM; text-specific unsupervised threshold recipes; exact Hernandez-Stolfo paper PDF (only secondary summaries read).
