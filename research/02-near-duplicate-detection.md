# 02 - Near-duplicate text detection at scale (prior art)

Scope: shingling, MinHash/LSH, SimHash, b-bit MinHash, Jaccard vs containment, LSH Ensemble, winnowing/MOSS, suffix arrays, content-defined chunking, Bloom prefilters, and how production corpora dedup. Written 2026-10-01. Existing repo code was NOT read.

Convention: every non-trivial claim carries a URL. "UNVERIFIED" = from memory or from a search snippet only, not confirmed against a source I opened.

Fetch caveat: the Stanford winnowing PDF was saved to disk but not read in full, and the LSH Ensemble VLDB PDF failed to load; for those two I rely on search-result excerpts and on the datasketch docs. Treated as "snippet-verified".

---

## 0. The one distinction that matters for this tool

The tool's stated goal is "triage overlap by real content comparison so humans only see genuine disagreements; never lose information when collapsing". That needs three different relations between documents A and B, and the literature separates them cleanly:

| Relation | Definition | Symmetric? | Meaning for the tool |
|---|---|---|---|
| Resemblance (Jaccard) | |S(A) ∩ S(B)| / |S(A) ∪ S(B)| over w-shingle sets | yes | "roughly the same document". Source: Broder 1997, https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf |
| Containment c(A,B) | |S(A) ∩ S(B)| / |S(A)| | no | "A is roughly contained in B". Same source. If A is a contiguous subsequence of B then c(A,B)=1 (Broder, same URL). This is the "B is a superset of A, A can be collapsed into B" case. |
| Ordered containment / ordered overlap | shared shingles AND shared order | no | NOT provided by any set-based method below. See 0.1. |

Broder defines both measures over shingle SETS and shows both are estimated from sampled sketches; resemblance needs a fixed-size sketch, containment needs a sketch that grows with document size (Broder, same URL, section 3).

### 0.1 Sets discard order (failure mode central to the tool)
Broder states it directly: with unlabelled shingling, if shingle size is 1 and resemblance is 100% then B "is an arbitrary permutation of A"; for larger w only certain permutations are possible, e.g. (a,c,a,b,a) resembles (a,b,a,c,a) 100% at size 2 (https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf). Also: larger w is more sensitive to reordering but "possibly over-sensitive to small alterations since the change in one token affects w shingles" (same URL). Also resemblance is not transitive (same URL) - this matters for clustering (see 2.4).

Implication: any shingle/MinHash/SimHash signal is a CANDIDATE and RANKING signal. It cannot certify "A is fully contained in B in the same order". That certification must come from an exact verifier (diff / longest-common-subsequence / exact line-set inclusion) run on the candidates. Every production pipeline below also verifies or accepts known imprecision (see section 7).

---

## 1. Shingling (the feature layer everything else sits on)

- What: turn a document into a set (or bag) of contiguous w-token subsequences. Tokens can be letters, words or lines; need a canonicaliser that erases formatting/punctuation/case differences you choose to ignore (Broder, https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf, section 2).
- Option A (labelled shingles, keep occurrence counts, so repeated shingles are distinct) vs Option B (plain set). Option A keeps more information; B is faster in practice (Broder, same URL, sections 2 and 4.3). For a "never lose information" tool, Option A (multiset) is the safer default because a document that repeats a paragraph is not equal to one that has it once.
- Shingle size matters empirically: BigCode found unigram shingles create many false positives and that moving to 5-grams cut them significantly (https://huggingface.co/blog/dedup). The Stack used 5-gram word shingles (256 permutations, 0.7 threshold) (same URL table).
- Hash width: Broder maps each shingle to an l-bit id first; l must be much larger than log n or collisions degrade the estimate (same Broder URL, 4.1). Rabin fingerprints chosen because collision probability is well understood and they roll over sliding windows (same URL, 4.1 and 4.3).
- Failure modes: boilerplate (headers, licenses, nav) creates large shared shingle mass between unrelated docs; one edit perturbs w shingles; tokenisation differences (whitespace, markdown vs plain, CRLF) change features silently. UNVERIFIED as a general statement but the Broder "canonical sequence" requirement is the sourced part.
- Library: Python (datasketch, text-dedup, datatrove). JS: no mature shingler-specific library found; trivial to hand-roll (word split + sliding join + hash). UNVERIFIED that none exists.

---

## 2. MinHash (resemblance sketch) and LSH banding

### 2.1 What it detects
Unbiased estimate of Jaccard resemblance from a fixed-size sketch (Broder Thm 1, https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf). Does not detect containment efficiently (a small doc inside a big doc has tiny Jaccard; see section 4). Does not see order (section 0.1).

### 2.2 Cost
- Signature: O(N*M*K) for N docs, M shingles each, K permutations (https://huggingface.co/blog/dedup).
- Brute-force comparison of signatures is O(n) per query; LSH makes query sub-linear (https://ekzhu.com/datasketch/lsh.html).
- Broder: 100 samples "seems reasonable", 200 "more than enough"; sketches 300-800 bytes; probability that a pair under 50% resemblance is estimated above 90% is under 0.1% (https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf, 4.2). His 1997 web experiment: 30M docs, 150 GB, 50% resemblance, 3.6M clusters (same URL, intro).

### 2.3 LSH banding math
Split K hashes into b bands of r rows; a pair becomes a candidate if it matches on ALL r values in at least one band; collision probability P(s) = 1-(1-s^r)^b, an S-curve (https://ekzhu.com/datasketch/lsh.html). The curve is soft: pairs slightly below the threshold are sometimes returned and pairs slightly above are sometimes missed (same URL). datasketch's own examples of (b,r) chosen for 128 permutations: threshold 0.3 -> (37,3); 0.5 -> (25,5); 0.7 -> (14,9); 0.9 -> (5,25) (same URL).

Production parameters (all from sources I opened):
- FineWeb: 5-grams, 112 hashes, 14 buckets of 8, target about 75% similarity; match probability for s = 0.7/0.75/0.8/0.85 = 56%/77%/92%/98.8% (https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1).
- The Stack: (256 perms, 0.7 threshold, 5-gram); CodeParrot: (256, 0.8, 1-gram) (https://huggingface.co/blog/dedup).
- RefinedWeb: 9,000 hashes over 5-grams. NOTE A SOURCE CONFLICT: the RefinedWeb paper snippet says "20 buckets of 450 hashes" (https://arxiv.org/pdf/2306.1116 search excerpt), while FineWeb says RefinedWeb used "450 buckets of 20 hashes" (https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1), and the BigCode table lists (9000, 0.8, 5, 20, 450) with column order P,T,K,B,R i.e. 20 bands x 450 rows (https://huggingface.co/blog/dedup). I did not resolve which is right; UNVERIFIED. (450 rows per band would be an extremely strict match, so the FineWeb reading looks more plausible, but I did not confirm.)

### 2.4 Failure modes (sourced)
- Candidates only: query returns unranked collisions, so exact verification is needed to enforce the threshold (https://ekzhu.com/datasketch/lsh.html).
- Behaviour depends on the corpus: on a near-duplicate-shaped corpus (pairs far from the threshold) precision/recall were 0.92-1.0; on a clustering-shaped corpus with heavy mass at the threshold they dropped to 0.69-0.77 precision and 0.69-0.84 recall, and did not improve monotonically with num_perm (https://ekzhu.com/datasketch/lsh.html, benchmarks). A pile of independent contributors' overlapping documents is more like the clustering shape, so expect borderline pairs.
- threshold and num_perm are fixed at index creation (same URL).
- Non-transitivity: A~B and B~C does not imply A~C (Broder URL; BigCode blog). BigCode compared two policies: verify true Jaccard within each cluster, or treat all LSH collisions as duplicates and take connected components; they found the second improved downstream models and gradually moved to it (https://huggingface.co/blog/dedup). For a lossless tool, the second policy (transitive closure without verification) is the WRONG one: it can chain unrelated documents together. Use connected components only on VERIFIED edges, or use cluster-then-verify-to-representative.
- Collapsing aggressiveness trade-off: BigCode lowered the threshold, raised shingle size and dropped false-positive checking to be more aggressive (same URL). A tool that must not lose information wants the opposite stance: recall-oriented candidate generation, precision from exact verification.

### 2.5 Scale evidence
BigCode: 1.4 TB deduplicated in under 4 hours on a Spark cluster at about $15/hour; connected components done via union-find for medium data or Spark star-contraction for large data (https://huggingface.co/blog/dedup). That is overkill for a text-file tool; the useful idea is union-find over verified edges.

### 2.6 Libraries
- Python: datasketch (MinHash, MinHashLSH, LSH Forest, LSH Ensemble; Redis/Cassandra/Mongo storage) - https://ekzhu.com/datasketch/lsh.html . text-dedup (MinHash+LSH, SimHash, suffix-array, Bloom filter; TOML configured; 762 stars as of fetch) - https://github.com/ChenghaoMou/text-dedup .
- JS/Node: minhash-node-rs, a Rust native addon exposing PermGen/MinHash/LshIndex with jaccard() and query(); 15 stars; last commit July 2023; used in production by WhereTo.com per its README (https://github.com/wherefortravel/minhash-node-rs). Native addon means a build/binary dependency. simhash-ts 0.2.0 (SimHash plus a b-bit one-permutation MinHash "equality fingerprint"; MIT; very low usage, about 30 jsDelivr hits in the last month at fetch) (https://www.jsdelivr.com/package/npm/simhash-ts). No datasketch-class pure-JS library with LSH Ensemble found. UNVERIFIED that none exists; I only saw search-result hits. Practical conclusion: a pure-JS MinHash is about 30-50 lines and is the safer route than a thin, low-adoption dependency.

---

## 3. b-bit MinHash (storage compression)

- What: keep only the lowest b bits of each minwise hash (b=1 or 2) and use a corrected unbiased resemblance estimator. Claimed storage reduction of at least 21.3x vs 64-bit (10.7x vs 32-bit) in the least favourable case, for resemblance > 0.5 (Li & Konig, https://arxiv.org/abs/0910.3349).
- Relevance: pure storage/memory optimisation. A text-file tool with thousands to low millions of files has no storage problem; skip unless an index is persisted at huge scale. Note the estimator is for resemblance only (same URL); it does not give containment.
- Library: simhash-ts ships a b-bit one-permutation MinHash used as an exact-equality fingerprint (https://www.jsdelivr.com/package/npm/simhash-ts). Python: UNVERIFIED which libs implement the Li-Konig estimator.

---

## 4. Containment: Jaccard is biased for "A inside B"

### 4.1 Why Jaccard is the wrong score for superset/subset collapse
Jaccard penalises large sets: two pairs with the same intersection can have very different Jaccard because the union differs; containment = |Q ∩ X| / |Q| is the normalised intersection (https://ekzhu.com/datasketch/lshensemble.html). A short note fully contained in a long document has near-zero Jaccard, so a pure-Jaccard pipeline will never propose collapsing it. Broder introduced containment alongside resemblance for exactly this (https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf).

### 4.2 Containment estimation options
1. Broder's L(D) = MOD_m sampling: keep shingle hashes that are 0 mod m. |L(A)∩L(B)|/|L(A)| is an unbiased containment estimate; sketch grows with doc size; scale modulus with size class (docs of size 100*2^i to 100*2^(i+1) use mod 2^i, expected 50-100 samples). Weakness: containment of a very short doc in a much larger one is "rather error prone due to the paucity of samples" (Broder URL, section 3). This is conceptually "sample hashes by value, not by rank", and it is easy to implement and CORRECT for the subset case.
2. Derive containment from Jaccard + set sizes: C(A,B) = J*(|A|+|B|) / (|A|*(1+J)); this is what datasketch's linear-scan baseline does ("converts the MinHash Jaccard estimate of every indexed set to a containment estimate") (https://ekzhu.com/datasketch/lshensemble.html). The algebraic identity is standard; the datasketch page confirms the practice, but the closed form is mine - treat the formula as UNVERIFIED against a source. Caveat from the same page: containment of a small query in a much larger set is a tiny Jaccard, which MinHash estimates with large relative noise, so heavy size skew is "intrinsically hard" for sketches (same URL).
3. Containment MinHash (Koslicki & Zabeti): estimate containment directly with a truncated sketch; reported to need fewer hashes than classic MinHash for the same relative error (table in snippet: e.g. 10^4 vs 10^3 at the tightest error) (https://par.nsf.gov/servlets/purl/10096144). Metagenomics context; the table was read from a snippet only. UNVERIFIED for text.
4. Exact containment is cheap when documents are small: with hashed shingle sets of a few thousand entries per file, exact |S(A)∩S(B)|/|S(A)| on candidate pairs is milliseconds. For a text-file tool, use sketches only to generate candidates and compute containment exactly on the full hashed shingle set. (Reasoning, not a sourced claim.)

### 4.3 LSH Ensemble (containment search at scale)
- What: LSH index for containment threshold queries; partitions indexed sets by size and tunes (b,r) per partition (Zhu et al., VLDB 2016, http://www.vldb.org/pvldb/vol9/p1185-zhu.pdf as cited by https://ekzhu.com/datasketch/lshensemble.html).
- Benefit depends on size skew: constant sizes - flat (no help); log-uniform 100-10,000 tokens - precision about 0.12 to 0.34 from 1 to 32 partitions; Zipfian - precision 0.15 to 0.69 (https://ekzhu.com/datasketch/lshensemble.html). Returns candidates; verify afterwards (same URL).
- Libraries: datasketch (Python, simplified) and a full Go implementation, github.com/ekzhu/lshensemble (both named at https://ekzhu.com/datasketch/lshensemble.html). No JS port found. UNVERIFIED.
- Verdict for this tool: only worth it if there are very many documents with heavy length skew. Otherwise exact containment on candidates is simpler.

---

## 5. SimHash

- What: Charikar sign-of-random-projection fingerprint compared by Hamming distance; approximates cosine similarity (https://www.jsdelivr.com/package/npm/simhash-ts description). Manku/Jain/Das Sarma (Google, WWW 2007): for an 8B-page repository, 64-bit fingerprints with k=3 bit differences were "reasonable"; naive probing of a sorted table needs C(64,3)=41,664 probes, so they use a few permuted/duplicated sorted tables (https://dl.acm.org/doc/pdf/10.1145/1242572.1242592 form of the paper; excerpts at https://archives.iw3c2.org/www2007/papers/paper215.pdf).
- Detects: near-identical documents (small edits). Cannot detect containment or large-scale partial overlap; changes a lot when a big chunk is added.
- Evidence it is weaker than MinHash for text: in text-dedup's benchmark on pinecone/core-2020-05-10-deduplication, MinHash macro-F1 0.9518 (11.09 s) vs SimHash 0.8515 (626 s); on NEWS-COPY ARI 0.7293 (3.01 s) vs 0.6463 (140 s) (https://github.com/ChenghaoMou/text-dedup). Timing there is implementation-specific, not intrinsic.
- Production use: BigScience ROOTS used SimHash with 6-grams and Hamming distance 4 at document level (https://huggingface.co/blog/dedup, table). A Stack Overflow answer says SimHash is faster and smaller but only detects very close matches (https://stackoverflow.com/questions/36647315/what-more-advantageous-minhash-over-simhash; snippet only, UNVERIFIED).
- JS: `simhash` (npm, "node module to calculate the simhash", https://www.npmjs.com/package/simhash, snippet only) and simhash-ts. 
- Verdict: not suitable as the primary signal for this tool (no containment, no order, weak on partial edits). Could serve as a cheap exact-ish fingerprint of normalised text. Better: use a plain content hash for that.

---

## 6. Local fingerprinting: winnowing / MOSS

- What: Schleimer, Wilkerson, Aiken (SIGMOD 2003). Hash all k-grams, slide a window of w consecutive hashes, select the minimum of each window (rightmost on ties); guarantees that any shared substring of length at least t = w + k - 1 is detected, and no match shorter than k is detected; density about 2/(w+1) (https://theory.stanford.edu/~aiken/publications/papers/sigmod03.pdf; guarantee confirmed from search excerpt, density figure and 33%-of-lower-bound claim from the researchgate snippet: "within 33% of the lower bound", https://www.researchgate.net/publication/2840981_Winnowing_Local_Algorithms_for_Document_Fingerprinting). The density formula is from memory - UNVERIFIED.
- Detects: shared contiguous passages of a guaranteed minimum length, i.e. position-aware local matches. Stronger than MinHash for "same passage appears in both" because the guarantee is deterministic, not probabilistic. Fingerprints keep positions, so they can be extended into maximal matched regions (match blocks), which gives something close to ORDERED overlap evidence.
- Cost: linear, one pass; fingerprint count about 2/(w+1) of the text; the index is an inverted index fingerprint -> (doc, position).
- Failure modes: matches shorter than t invisible; tuned for plagiarism-style passage reuse, not "same facts, rewritten"; heavy reformatting breaks k-grams unless canonicalised first. Reordered paragraphs still match locally (that is a feature here: you can see that blocks moved).
- Libraries: MOSS is a hosted service for source-code similarity (UNVERIFIED current availability); winnowing is simple to implement (about 40 lines). JS packages: not searched. UNVERIFIED.
- Verdict: the best-sourced candidate for a "which regions overlap, and in what order" step between the cheap sketch and the exact diff.

---

## 7. Exact substring methods (suffix arrays, rolling hashes)

- Suffix array exact-substring dedup (Lee et al. 2021/ACL 2022): finds repeated substrings of at least 50 tokens (the paper's choice, justified in an appendix; 100 bytes if tokenised) across a corpus (https://aclanthology.org/2022.acl-long.577.pdf and https://github.com/google-research/deduplicate-text-datasets). Finds all repeats including inside a single doc and across docs; memory-heavy (the Google repo is Rust; text-dedup wraps it as `suffix_array`, https://github.com/ChenghaoMou/text-dedup). C4 results: 3.04% to 7.18% of train examples removed by near-dup/substring methods (https://huggingface.co/blog/dedup, table).
- Used alongside MinHash at scale: RefinedWeb "exact substring deduplication ... using a suffix array" per a secondary source (https://www.emergentmind.com/topics/refinedweb-dataset, snippet only; UNVERIFIED); BigScience ROOTS: SimHash (document) + suffix array 50-token (substring) (https://huggingface.co/blog/dedup).
- Caveat on benefit: BigCode notes Geiping 2022 found substring dedup did not improve their model (https://huggingface.co/blog/dedup). That is a model-quality finding and is irrelevant to the correctness question here.
- Suffix automaton / suffix tree: computes longest common substrings and all shared substrings between two documents in linear time. Not covered by any source I opened - UNVERIFIED; standard textbook material. For two candidate files, a plain LCS/line diff is simpler and gives order.
- Rolling hash / Rabin-Karp: used as the shingle hash itself; Broder specifically recommends Rabin fingerprints for slide-able window hashing (https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf, 4.1/4.3).
- Verdict: exact substring methods are the "verification" tier, not the candidate-generation tier.

---

## 8. Content-defined chunking (FastCDC, rsync, borg, restic)

- What it is: split a byte stream at content-determined boundaries so an insertion shifts only nearby chunk boundaries; hash each chunk; identical chunks are stored once. FastCDC (Xia et al., USENIX ATC 2016) uses a Gear rolling hash, cut-point skipping below a minimum chunk size and "normalized chunking" (different mask bit counts before/after the expected size, e.g. levels (14,12), (15,11), (16,10) around an 8 KB target) to keep the chunk-size distribution near the target (https://www.usenix.org/system/files/conference/atc16/atc16-paper-xia.pdf).
- What it detects: EXACT shared byte runs (chunk equality). It is dedup, not similarity: a chunk that differs by one character is a completely different chunk. It survives insertions/deletions in the middle of a file, which fixed-offset blocking does not. Gives you a lossless "store once, reference many" mechanism, which maps well to the tool's "never lose information when collapsing" requirement: a chunk store lets you reconstruct every original.
- Granularity problem for text: standard chunk sizes (4-8 KB average) are large relative to small text files; most small documents are one or two chunks, so it only catches identical or large shared regions. For text dedup you would choose line- or paragraph-level "chunks" (a CDC variant over lines) or much smaller chunk targets. UNVERIFIED design suggestion, not from a source.
- Libraries: JS - node-fastcdc, Node bindings for fastcdc-rs (https://github.com/mikolalysenko/node-fastcdc); PyPI `fastcdc` with optional cython (https://pypi.org/project/fastcdc/); Rust crate `fastcdc` (https://docs.rs/fastcdc). restic and borg use their own CDC (Rabin-fingerprint-based chunker in restic; buzhash in borg) - I did not open their docs, so UNVERIFIED. rsync's rolling checksum + strong hash is a delta algorithm between two known versions, not a corpus dedup method (UNVERIFIED, standard knowledge).
- Verdict: borrow the architecture (content-addressed store + manifest of references), not the byte-level chunker.

---

## 9. Bloom filter / hash prefilters

- Exact-duplicate fast path: hash the normalised document (SHA-256/MD5) and compare; AlphaCode ignored whitespace before exact match, CodeGen used SHA256, InCoder used alphanumeric tokens + MD5 with a Bloom filter (https://huggingface.co/blog/dedup, code table). CC100-XL did paragraph-level exact dedup with SHA-1 (same table).
- Bloom filter: probabilistic set membership, false positives but no false negatives. text-dedup ships `bloom_filter` exact dedup with `error_rate` and `expected_elements` parameters (https://github.com/ChenghaoMou/text-dedup). Warning for this tool: a Bloom false positive means "this looks seen before" for something that is NOT a duplicate - dropping on that signal would LOSE information. For lossless collapsing, a Bloom filter may only gate whether to run an exact check, never decide a collapse. At text-file scale a plain Map/Set of hashes is exact and cheap, so no Bloom filter is needed. (Reasoning; the false-positive property is textbook.)
- Verdict: use exact hashes of normalised text (and of normalised lines/paragraphs) as tier 0. This is the cheapest and fully safe step.

---

## 10. How production pipelines combine these

| Pipeline | Doc-level | Sub-doc | Source |
|---|---|---|---|
| RefinedWeb (Falcon) | MinHash 9,000 hashes, 5-grams | exact substring via suffix array (secondary source) | https://arxiv.org/pdf/2306.1116 (excerpt); https://www.emergentmind.com/topics/refinedweb-dataset |
| FineWeb | MinHash 112 hashes, 5-grams, per-dump; global dedup across all dumps made models worse | line/3-line dedup also worse | https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1 |
| BigCode / The Stack | MinHash+LSH (256 perms, 0.7, 5-gram), union-find/Spark connected components | - | https://huggingface.co/blog/dedup |
| C4 (Lee et al.) | MinHash (9000, 0.8, 5, 20, 450) | suffix array 50-token | https://huggingface.co/blog/dedup |
| BigScience ROOTS | SimHash 6-gram, Hamming 4 | suffix array 50-token | https://huggingface.co/blog/dedup |
| CCNet | paragraph-level exact dedup by hash - UNVERIFIED, not opened | | - |

Lessons directly relevant here:
1. FineWeb: deduplicating more aggressively and globally removed 90%+ of data from old crawls and, on the one dump they inspected, the kept 10% was worse (more ads, keyword lists) than the 90% removed; the hypothesised gain comes from removing very large duplicate clusters, and further dedup of small clusters can hurt (https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1). Interpretation for this tool: these pipelines optimise model quality and happily discard information; that objective is the OPPOSITE of "never lose information". Their candidate-generation machinery transfers; their collapse policies do not.
2. FineWeb also found line-level dedup (keep one random occurrence of each duplicated line) was consistently worse (same URL). For a lossless tool, line-level collapsing is only safe when the removed lines remain recoverable via a reference.
3. MinHash+LSH pipelines are bulk and batch; interactive per-pair diff UX is not covered by any of them.

---

## 11. What a text-file dedup tool should borrow (ranked by value / fit)

1. Tiered pipeline (cheap -> exact), with every tier able to say "unsure, escalate":
   - T0 exact hash of canonicalised content -> byte-identical / whitespace-identical (sound, no information loss if originals are kept or referenced).
   - T1 shingle-set sketch (MinHash, 5-word shingles, multiset/labelled shingles) + LSH banding to generate candidate pairs, tuned recall-heavy (low threshold, e.g. around 0.3-0.5 Jaccard; BigCode found lowering threshold increased recall in the high-similarity segment, https://huggingface.co/blog/dedup).
   - T2 exact containment and resemblance on the full hashed shingle sets of candidate pairs (cheap at file scale).
   - T3 ordered verification: line/paragraph diff or LCS to decide "A is an ordered subsequence of B", "same content reordered", or "genuinely differs"; winnowing fingerprints with positions to localise the matching blocks.
   - Humans only see pairs where T3 reports non-subsumed differences.
2. Report containment direction, not just similarity. c(A,B) and c(B,A) separately: (1.0, <1) means A can collapse into B; (<1, <1) with high Jaccard means a genuine disagreement for a human; both near 1 with different order means reordering. Based on Broder's asymmetric definition (https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf).
3. Verified edges only into union-find clusters; never transitive closure of raw LSH hits (https://huggingface.co/blog/dedup shows both approaches, I recommend the verified-edge one for lossless use). Add a "chain" warning when A~B, B~C but A and C fail verification (non-transitivity: Broder URL).
4. Content-addressed store of normalised paragraphs/lines with a manifest per original file (CDC idea, https://www.usenix.org/system/files/conference/atc16/atc16-paper-xia.pdf, applied at paragraph level): collapsing becomes "point both files at the same block", fully reversible.
5. Canonicalisation as an explicit, recorded step (Broder's "parser" that reduces to a canonical token sequence, same URL), with the normalisation rules stored in the report, so a reviewer can see what two files were considered equal under.
6. Report probabilities honestly: show the sketch estimate's uncertainty and the S-curve miss chance for borderline pairs (datasketch benchmark shows precision/recall of 0.69-0.84 near the threshold, https://ekzhu.com/datasketch/lsh.html). If a pair's candidate status could be a false negative, say so; for small corpora skip LSH and do all-pairs on sketches or even all-pairs exact (n^2 is fine for a few thousand files).
7. Small-corpus shortcut: below roughly 10^4 files, LSH is unnecessary; all-pairs sketch comparison is O(n^2) on 128-int vectors. (Reasoning; Broder gives O(r^2 s) for all pairs, https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf, 4.4.)

## 12. JS/Node vs Python availability summary

| Method | Python | JS/Node |
|---|---|---|
| MinHash + LSH | datasketch, text-dedup, datatrove | minhash-node-rs (Rust addon, last commit 2023); simhash-ts (b-bit MinHash fingerprint); hand-rolled is easy |
| LSH Ensemble (containment) | datasketch | none found (UNVERIFIED); Go original (ekzhu/lshensemble) |
| SimHash | text-dedup, simhash-py | simhash (npm), simhash-ts |
| Winnowing/MOSS | various, UNVERIFIED | none checked |
| Suffix array exact dedup | google-research/deduplicate-text-datasets (Rust), text-dedup wrapper | none checked |
| CDC / FastCDC | fastcdc (PyPI) | node-fastcdc (fastcdc-rs bindings) |
| Bloom filter | text-dedup, many | many (not checked); unnecessary at this scale |

Sources for the table: https://ekzhu.com/datasketch/lsh.html, https://github.com/ChenghaoMou/text-dedup, https://github.com/wherefortravel/minhash-node-rs, https://www.jsdelivr.com/package/npm/simhash-ts, https://github.com/mikolalysenko/node-fastcdc, https://pypi.org/project/fastcdc/, https://github.com/google-research/deduplicate-text-datasets.

## 13. Things I could not verify (do not rely on)
- CCNet paragraph dedup details (not opened).
- restic/borg chunker internals (fetch rate-limited; not opened).
- Whether a mature pure-JS MinHash/LSH library exists (only 2 npm-adjacent hits seen).
- Which of RefinedWeb's two band configurations is right (20x450 vs 450x20).
- Winnowing density formula and MOSS service status.
- Closed-form containment-from-Jaccard identity (standard algebra, no source opened).
- Containment MinHash hash-count savings for text (metagenomics paper, snippet only).
- LSH Ensemble full paper claims (VLDB PDF failed to load; relied on datasketch docs summary).
