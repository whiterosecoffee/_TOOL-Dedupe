# 04 - Diff/Merge, Clustering, Verification: prior art for a text-file dedup tool

Method: fetched primary docs where reachable; WebFetch returns model-summarised text, so statements are paraphrase. Tags: [V] = seen in a page fetched this session; [U] = UNVERIFIED (from memory, or fetch failed; URL given is where to confirm). Repo code was not read.

## (a) DIFF and MERGE

### a1. Diff algorithms
- Git exposes four: myers (default greedy), minimal (slower, smallest), patience, histogram ("extends patience to support low-occurrence common elements"). [V] https://git-scm.com/docs/git-diff
- Myers: O(ND) shortest edit script / LCS, N = total length, D = edit distance. [U - fetch failed] http://www.xmailserver.org/diff2.pdf
- Patience: anchor on lines unique in both files, take LCS of those, recurse between anchors, fall back to Myers when no unique pairs remain. [V via search summary] https://arxiv.org/pdf/1902.02467
- Histogram: from JGit; builds occurrence histogram of side A, picks lowest-occurrence common LCS, recurses, caps chain length to avoid pathological cost, falls back to classic diff. [V] https://github.com/git/git/blob/master/xdiff/xhistogram.c
- Cost: Myers fast when files are similar (D small), slow when dissimilar [U]; patience/histogram cost is hashing + recursion. How often algorithms disagree is studied in https://arxiv.org/pdf/1902.02467 [V title only].
- Failure modes: diffs are not unique. Different algorithms give different, equally valid scripts; output is a readability heuristic, not canonical. Line granularity: re-wrapped paragraphs look 100% changed. Moved blocks appear as delete+add.
- Borrow: (1) Use diff only AFTER cheap candidate generation, as the "real content comparison" stage. (2) Treat the diff as evidence: shared-lines/total-lines on a patience/histogram alignment is the measure; the residual hunks are the "genuine disagreement" payload shown to humans. (3) Run two algorithms (myers + histogram); if they classify differently, flag rather than guess. (4) Normalise (whitespace, line endings, wrap) before diff, but keep raw text to reconstruct.

### a2. Three-way merge and "disjoint vs conflict"
- diff3: given base O and versions A,B, diff O->A and O->B; hunks on disjoint ranges merge automatically, overlapping hunks are conflicts for a human. Khanna/Kunal/Pierce (FSTTCS 2007) formalise it and analyse the intuition that edits to "well-separated" regions never conflict; they find characterising its good properties is "rather delicate". [V abstract via search] https://link.springer.com/doi/10.1007/978-3-540-77050-3_40 ; paper PDF https://www.cis.upenn.edu/~bcpierce/papers/diff3-short.pdf (my fetch summary of the PDF was generic and is NOT relied on [U]).
- Practical classification: change on one side only = clean; identical change both sides = clean; overlapping or adjacent differing changes = conflict. Textual disjointness says nothing about semantic independence (two disjoint edits can contradict each other). [general knowledge, U for formal limits]
- Key limit: diff3 needs a common ancestor. Independent contributors usually have none. Divergent git branches do (git merge-base). Without a base, a 2-way diff cannot say who changed what; every difference is a candidate disagreement.
- Borrow: for git-branch inputs, compute merge-base and apply diff3 classification (hunk touched by one side = auto-resolvable, both sides differently = surface). For baseless files, synthesise a pseudo-base from the cluster (e.g. line-level majority, or intersection) and classify each member's deviation; lines held by only one member are "unique contributions" that must be preserved. Always emit a conflict region rather than choosing a side.
- Failure mode to design against: silent resolution. Keep pre-merge originals regardless.

### a3. git rerere
- Records the conflicted state (preimage) and your resolution (postimage); on recurrence runs a three-way merge of earlier-conflict, earlier-resolution, current-conflict; leaves the index untouched so you still review; gc prunes old records. [V] https://git-scm.com/docs/git-rerere
- Borrow: persistent decision memory keyed by a hash of the normalised conflicting hunk pair. A human resolves a disagreement once; later clusters with the same hunk pair are pre-answered as a suggestion, never silently. Key on content, not path.

### a4. CRDT / OT
- CRDTs ensure replicas modified independently can always be merged to a consistent state automatically, without a central server. [V] https://crdt.tech/ (op-based vs state-based and text CRDTs not covered by that page [U]; see https://www.inkandswitch.com/peritext/)
- Why it mostly does not fit: convergence requires edits captured as operations with identities from the start. Dedup receives finished files with no edit history. Convergence also is not "no disagreement"; CRDTs merge concurrent edits by deterministic rule, which may interleave or pick a winner, i.e. exactly the silent resolution this tool must avoid. OT likewise needs a live operation stream [U general knowledge].
- Borrow (conceptual): make the cluster-merge operator commutative, associative and idempotent so results do not depend on processing order, and test it as a property (c4). Also the multi-value-register pattern: for a genuine conflict store both values tagged with origin; do not choose.

### a5. Semantic / structured merge
- Mergiraf: Git merge driver using syntax trees; fast line merge first, tree analysis only when needed; deliberately conservative, keeps conflict markers on suspicious cases and urges review; declarative per-language config. [V] https://mergiraf.org/
- Others [U, not fetched]: GumTree tree differencing https://github.com/GumTreeDiff/gumtree ; SemanticMerge (Plastic SCM).
- Fuzzy/structured diff for documents: line diff is poor for prose. Options: block (paragraph/heading) hash sequence diff first, word-level diff only inside non-identical blocks; Markdown-AST blocks. Moved paragraphs detected by block-hash match regardless of position, as in content-defined chunking (c1). [design inference, no single source]
- Borrow: two-level diff, "cheap first, structural only if needed" ordering, and Mergiraf's stance: when unsure, stay conflicted.

## (b) CLUSTERING / COMMUNITY DETECTION on a similarity graph

### b1. Connected components / union-find
- Gives: near-linear transitive closure; trivial to implement and explain.
- Failure: chaining. A~B and B~C merges A and C even if dissimilar; one spurious bridge merges two true groups. This is single linkage at a threshold. sklearn: agglomerative clustering has "rich get richer" behaviour; single linkage is the worst for uneven cluster sizes and "most brittle". [V] https://scikit-learn.org/stable/modules/clustering.html
- Over-merge is the dangerous direction here (collapsing distinct docs); a false split only costs reviewer time.

### b2. Linkage variants
- Single (closest pair), average (mean pairwise), complete (max pairwise); average/complete are more robust to chaining. [V] same sklearn page.
- Complete linkage = every pair in a cluster is within threshold (a clique), the right safety invariant for a lossless collapse. Cost: O(n^2) memory if dense; prune pairs with candidate generation (MinHash/LSH, outside this note).
- Borrow: two tiers. Tier 1 auto-collapse only clique-like groups (all pairs verified by real diff). Tier 2 review for components that are connected but not cliques.

### b3. Louvain / Leiden
- Louvain can yield arbitrarily badly connected communities; the paper measured up to 25% badly connected and up to 16% disconnected. Leiden guarantees connected communities, local optimality when iterated, and is faster. [V] https://arxiv.org/abs/1810.08473
- Modularity has a resolution limit [U] https://www.pnas.org/doi/10.1073/pnas.0605965104 . Randomised; fix seeds for an auditable tool (leidenalg/igraph [U]).
- Borrow: Leiden with CPM quality function (threshold = minimum internal density) as a splitter of union-find components at weak bridges, not as the primary grouping.

### b4. HDBSCAN
- Single linkage over mutual-reachability distance (max of both core distances and the raw distance), condensed tree by min cluster size, stability-based selection; unselected points are noise. A single outlier can bridge clusters in plain single linkage; mutual reachability reduces that. [V] https://hdbscan.readthedocs.io/en/latest/how_hdbscan_works.html
- Gives: explicit "noise" = singleton (never forced into a group, the safe default). Cost: needs a distance (Jaccard distance works), O(n^2) unless sparse. Failure: dedup cares about groups of size 2, where density estimation is weakest; many exact copies distort core distances [design inference, U].
- Borrow: the mutual-reachability idea, i.e. penalise bridge documents linked to many dissimilar docs.

### b5. Correlation clustering
- Given +/- pair labels, partition to minimise disagreements (similar pairs split + dissimilar pairs joined); no K needed; NP-hard, constant-factor approximations (Bansal, Blum, Chawla, Machine Learning 2004). [U - my fetches failed] https://link.springer.com/article/10.1023/B:MACH.0000033116.57574.95 ; pivot heuristic Ailon-Charikar-Newman https://dl.acm.org/doi/10.1145/1411509.1411513 [U].
- Why useful: uses negative evidence too, so one false bridge cannot merge groups opposed by many negative edges. Cost: needs the negative (dissimilar) pairs, i.e. more comparisons.
- Borrow: inside each component test all pairs, not only linked edges; treat low-similarity pairs as explicit negatives.

### b6. Detecting over-merged clusters (checks to implement)
Splink documents cluster graph metrics (density, bridges, betweenness) for this [U - docs page 404 on fetch; start at https://moj-analytical-services.github.io/splink/ ]. Generic checks:
1. Density = edges / (n(n-1)/2); true duplicate cluster is near 1.0; chained component is sparse.
2. Minimum pairwise similarity (weakest link) and hop-diameter (>1 means some pair never directly verified).
3. Bridges / articulation points: removing one splits the component.
4. Giant-component warning vs expected size (the sklearn "rich get richer" effect).
5. Threshold-sweep stability: cluster fractures when threshold nudged up = held by weak edges.
6. Diff every member against the cluster medoid, not just its neighbour.
Pitfall: do not use the same signal (e.g. MinHash score) to both link and check; verify with an independent measure (real diff).

## (c) VERIFICATION OF LOSSLESSNESS

### c1. Content-addressable storage
- restic: blob ID = SHA-256 of content; content-defined chunking (Rabin, 64-byte window, 512 KiB-8 MiB blobs, ~1 MiB avg) so inserts do not shift every chunk; verify by rehashing. [V] https://restic.readthedocs.io/en/stable/100_references.html
- borg: chunk id = id_hash(plaintext) (HMAC when keyed), reference counts, checksummed index files; `borg check` verifies repository and archive reference integrity; `--verify-data` rereads/decrypts/decompresses every chunk (slow); `--repair` is flagged potentially dangerous and replaces lost chunks with zero-filled placeholders. [V] https://borgbackup.readthedocs.io/en/stable/internals/data-structures.html , https://borgbackup.readthedocs.io/en/stable/usage/check.html
- ZFS: `dedup=verify` (= sha256,verify) does a byte-to-byte comparison when two blocks have the same signature, so a hash collision cannot corrupt data; verify is mandatory for edonr; docs say not to enable dedup unless necessary, and recommend ~1.25 GiB RAM per TiB. [V] https://openzfs.github.io/openzfs-docs/man/master/7/zfsprops.7.html , https://openzfs.github.io/openzfs-docs/man/master/7/zfsconcepts.7.html
- Borrow: (1) exact-duplicate stage = SHA-256 plus byte-compare before collapse (ZFS verify) so correctness never rests on hash strength. (2) Separate "reference" from "delete": object store keyed by hash, every original path a manifest entry pointing at it, nothing removed. (3) Refcounts: delete a blob only when no manifest references it.

### c2. Fixity and manifests
- BagIt (RFC 8493): payload manifest lists every file with a checksum; every payload file must appear in a manifest; a bag is valid only when every checksum verifies against file contents. [V] https://www.rfc-editor.org/rfc/rfc8493
- Borrow: pre-run inventory manifest (path, size, sha256) and post-run manifest; invariant "every input hash is accounted for": present unchanged, or exact dup of a retained blob, or reconstructible from a stored delta. Run the verifier as a separate code path that re-reads from disk.

### c3. Lossless proof for NON-identical collapses (the hard part)
Backup tools only dedup identical chunks; none solves "merge near-duplicates". Closest prior art is delta storage (git packfiles store objects as deltas against a base [U]; VCDIFF RFC 3284 https://www.rfc-editor.org/rfc/rfc3284 [U]). Borrow: store canonical text + per-variant delta. Verification = apply delta to canonical, hash, compare to the original's recorded hash (round trip). This turns "no information lost" into a machine-checked fact per file.

### c4. Property-based testing of dedup
- Hypothesis: property tests with generated data; rule-based stateful tests chaining operations via bundles. [V] https://hypothesis.readthedocs.io/en/latest/stateful.html (shrinking to minimal failing case is a known feature but not confirmed by my fetch [U]).
- Properties to assert:
  a. Round trip: reconstruct(store, manifest, path) == original bytes for every input.
  b. Conservation: every distinct line/paragraph hash in inputs appears in retained canonical or deltas.
  c. Order independence: shuffled input order yields the same retained content (CRDT-style commutativity/idempotence).
  d. Idempotence: running on its own output changes nothing.
  e. Monotonic safety: adding an unrelated file never changes existing clusters; adding a bridge doc never auto-collapses a previously reviewed group.
  f. Metamorphic: inserting one unique sentence into one member must surface as a hunk (no silent absorption).
  g. Differential: compare against a slow all-pairs-diff oracle on small random corpora.
  h. Generators: mutate a base text (insert/delete/move/whitespace/CRLF/BOM/encoding) to build overlap families with known ground truth; include adversarial near-identical pairs (negation, changed number).
- Pitfall: tests generated using the code's own normalisation share its blind spots.

## Cost / failure summary
| Technique | Gives | Cost | Main failure |
|---|---|---|---|
| Myers/patience/histogram | line alignment, hunks | ~O(ND), fine at doc size | non-canonical, line granularity, moves |
| diff3 | auto vs conflict classification | needs base | adjacent edits conflict; semantic conflicts invisible |
| rerere | remembered decisions | tiny | key choice; stale decisions |
| CRDT/OT | order-independent merge | needs op history | not for snapshots; auto-picks winners |
| Union-find | transitive groups | ~linear | chaining over-merge |
| Complete/avg linkage | clique-like guarantee | O(n^2) | splits real families with gradual drift |
| Leiden | splits weakly connected groups | near-linear | resolution limit, randomness |
| HDBSCAN | noise = singleton | O(n^2) distances | group size 2 regime |
| Correlation clustering | uses negative evidence | more comparisons | NP-hard, heuristics |
| CAS + verify compare | exact lossless for identical | hash + read | identical content only |
| Delta + round-trip hash | lossless for near-dups | store deltas | complexity |
| Property tests | ordering/edge bugs | dev time | shared blind spots |

## Three most promising ideas
1. Delta-with-round-trip: collapse near-duplicates into canonical + per-variant diff hunks; make "lossless" machine-checked (apply delta, compare SHA-256 to recorded original hash; ZFS-style byte compare for exact dups; BagIt-style pre/post manifests checked by a separate code path).
2. Two-tier clustering: union-find only proposes components; clique/density checks (all-pairs real diff, min pairwise similarity, bridge detection, Leiden-CPM split) decide auto-collapse vs human review. Anything not a verified clique is never auto-collapsed.
3. diff3-style disagreement classification with a pseudo-base (or git merge-base for branches) so only hunks differently touched by two contributors reach a human, plus a rerere-style memory keyed by hunk-pair hash so each disagreement is decided once; never auto-pick a winner (Mergiraf stance).
