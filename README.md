# de-dupe

Layered deduplication for the case that keeps recurring: many independent contributors (concurrent agent sessions, forked branches, scattered documents) produce a lot of content that overlaps, and most of that overlap is redundant, not a real disagreement — but you can't tell which is which without actually looking, and looking at everything by hand doesn't scale.

Grew out of a concrete incident: 27+ concurrent Claude Code sessions sharing one git repo produced heavily overlapping branches. The first fix (materializing every branch's full diff into a review folder) worked but didn't scale — most of what looked like "contention" turned out to be exact duplication or a trivial merge, and copying it all just moved the noise into a different file. This repo is the generalized, reusable version of the fix that actually worked: **triage every overlap by real content comparison before deciding it needs human attention at all.**

## Zero loss, by construction and by independent audit

Every layer that discards something keeps a pointer to what it discarded and records *why*, never a bare "redundant, gone":

- **Exact duplicates** are never deleted from the result — `exactDuplicateGroups` lists every id that shares a hash. One is kept as the working representative; the rest are still named, not forgotten.
- **Containment** keeps both ids too (`subset`/`superset`), plus `extra`: the exact lines the superset carries beyond the subset. The claim "nothing is lost by keeping only the superset" isn't asserted, it's shown.
- **Similarity clusters** don't discard anything at all — grouping isn't deletion — and each cluster now carries its own internal pairwise scores, not just an opaque bag of ids.

That's necessary but not sufficient — a pipeline can compute a wrong verdict and still present it with total confidence. So there's a fourth, independent layer that doesn't trust any of the above: **`dedupe audit`** re-reads every file named in a report straight from disk and re-derives each exact-duplicate and containment claim from scratch, with genuinely separate code (direct content comparison, an LCS-based containment proof, its own normalizer; a test enforces it imports nothing from the other core modules). It also checks completeness: any identical files the report failed to group are flagged as `missed_exact_duplicate`. Run it after every real run; see **Measured results** below for a real pass.

## The five computation layers

Each layer only ever sees what survived the one before it — cheapest and most certain first, so expensive/approximate layers run on the smallest possible remainder.

1. **Exact hash** (`src/core/hash.mjs`) — SHA-256 over raw content. Two records with the same hash are byte-identical, provably, for free. No two records ever need a full comparison if they already match here.
2. **Order-preserving containment** (`src/core/containment.mjs`) — is A a subsequence of B (everything A has, in the same order, plus more)? Deliberately *not* a naive "shared lines" check — that has a real false-positive mode (two files sharing common boilerplate get called "subset" of each other even with no actual structural relationship). O(n) per pair, but still O(n²) pairs — the most expensive layer in practice, see **Measured results**.
3. **3-way-merge mergeability** (`src/core/merge3.mjs`) — for content that diverges but shares a real common ancestor, does `git merge-file` resolve it with zero conflicts? If so, it's disjoint/additive edits, not a genuine disagreement.
4. **TF-IDF similarity** (`src/core/similarity.mjs`) — "same idea, different words," approximated with zero dependencies and zero cost: vocabulary-overlap cosine similarity, not a real embedding model. Catches restated/templated content well (validated: 0.998–0.9999 scores on genuinely near-duplicate content in real testing); will miss a deep paraphrase that shares little vocabulary. The upgrade path to a real embedding model is a one-function swap — see that file's header.
5. **Clustering** (`src/core/cluster.mjs`) — union-find grouping over the similarity graph from layer 4. A simple, honest stand-in for real community detection (e.g. Leiden) — correct for small-to-medium corpora, but can transitively over-merge (A~B~C~D doesn't mean A and D are related) at real scale. Upgrade when that failure is actually observed, not before.

**What never happens automatically:** a genuine disagreement (layer 3 finds real conflicting edits) is never auto-resolved by picking a side. That's the one case worth a human looking at — everything else is redundant or safely mergeable and shouldn't cost anyone's attention.

## The cheapest layer of all: don't scan what doesn't belong

Before any of the five layers run, there's a zero-cost one: **know your corpus before you pay to read it.** `files` mode now respects the target directory's own `.gitignore` for bare top-level directory names (a real, standard, already-authoritative signal that content isn't part of the project — e.g. a personal backup archive), and `dedupe scan` does a content-free dry run (file count, total bytes, extension breakdown) before you commit to a real pass. This isn't a nice-to-have: a real run against this repo's own root directory, before `.gitignore` was wired in, silently walked into a `_Archives/` folder documented elsewhere in that repo as ~170k personal backup files and had to be killed after exceeding a 2-minute timeout with zero output. The fix: `dedupe scan` on the same directory, with `.gitignore` respected, completes in 402ms and correctly reports 422 real project files — a >99.75% reduction in scan scope, found for free, before any of the five expensive layers ever ran. A `--max-files` safety cap (default 5000) is also now in place so a future unknown-shape directory fails loudly and fast instead of running unbounded.

## Adapters

- **`git`** (`src/adapters/git-branches.mjs`) — compares every branch of a git repo against a base ref, per contended file. The branch-consolidation use case this project started from.
- **`files`** (`src/adapters/files.mjs`) — walks a plain directory of text files. No git required; works on any corpus (documents, exported conversations, a scattered idea dump).

Adding a new source is writing a new adapter that produces `{id: string, content: string}[]` records — every core layer and pipeline is source-agnostic.

## Usage

```bash
npm test                                                             # 27 tests: all core layers, audit, end-to-end, Phase 1 guards

node src/cli.mjs scan --dir <path> [--ignore-dirs a,b]                                        # free dry run, always do this first
node src/cli.mjs git --repo <path> --base <ref> [--remote origin] [--exclude a,b] [--out report.json]
node src/cli.mjs files --dir <path> [--threshold 0.65] [--ignore-dirs a,b] [--no-gitignore] [--max-files <n>|false] [--normalize] [--min-subset-lines <n>] [--max-size-ratio <n>] [--out report.json]
node src/cli.mjs audit --report <path> --dir <path>                                           # independent re-verification, always do this after
```

`--help` on either subcommand or the bare CLI prints the full flag list.

**Always pass `--base` explicitly for `git` mode.** It will guess `<remote>/HEAD`'s target if you don't, and that guess is frequently wrong — a repo's real long-lived integration branch is often not what `HEAD` points at (confirmed directly: the repo this tool was built against uses `standardize/v0.3-2026-09-27` as its actual working branch while `origin/HEAD` points at `master`). The resolved base is always printed first, specifically so a wrong guess is visible immediately.

## Measured results (real data, not synthetic — two scales)

| Corpus | Files in | After exact-hash | After containment | After similarity | Total time | Containment time | Similarity+cluster time |
|---|---|---|---|---|---|---|---|
| `Prompts/` subset | 228 | 227 | 226 | 128 | 6.9s | 4.4s (63%) | 2.0s (29%) |
| Full repo (`.gitignore`-scoped) | 422 | 407 | 406 | 259 | 19.0s | 10.3s (54%) | 6.9s (36%) |

Comparison counts roughly scaled with n² between the two runs (3.2x more pairs going from 228→422 files) and wall-clock time scaled consistently with that (containment: 2.4x; similarity+cluster: 3.4x) — real confirmation of the O(n²) cost these two layers were already documented as having, not just a theoretical claim. **Containment and similarity together are consistently ~85–95% of total runtime** — exact hash is nearly free by comparison (150ms for 422 files) and should never be the bottleneck.

**Audit, both scales:** `dedupe audit` independently re-derived all 3 claims from the 228-file run and all 17 claims from the 422-file run, straight from fresh disk reads with its own code path — **PASS** both times, zero mismatches.

## How deeper, more expensive passes should progress

The measured funnel above is the actual argument for ordering, not a guess: by the time similarity clustering (the most "semantic," most expandable layer) runs, it's already seeing 406 records instead of 422, and if a real embedding model replaced TF-IDF here, it would only ever be called on whatever survives containment — never on the full corpus, never on something exact-hash or containment already proved is redundant. Concretely, before adding a real embedding model (the one piece of planned-but-not-built depth):

1. **Push the O(n²) layers' input down further first.** Containment is currently the most expensive layer and runs on *every* post-exact-hash pair, including pairs with nothing in common at all. A cheap pre-filter — even something as simple as bucketing by a MinHash/SimHash signature before attempting a real containment check — would cut containment's comparison count from "all pairs" to "pairs that already look similar," likely the single biggest efficiency win available before touching embeddings at all.
2. **Only then does a real embedding model replace TF-IDF**, called once per surviving record (not per pair — embeddings are computed once and compared many times, unlike TF-IDF's current corpus-wide vectorization), on whatever's left after 1.
3. **Union-find becomes Leiden only once a real transitive-drift failure is observed** — not preemptively. The funnel data above (406 records → 259 after clustering, no runaway mega-cluster) doesn't show that failure yet at this scale; watch for it as corpus size grows, and treat its actual appearance as the trigger, not a round-number file count.

## Known limitations (real, not hidden)

- **Exact-path/no cross-identity matching.** Two sources that produce equivalent content under different names or paths (including a pure case difference — a real bug hit and fixed by hand in the repo this grew out of) aren't linked by any layer here. Would need a hash of normalized/canonicalized paths, or content-first grouping instead of path-first, to catch that class.
- **`.gitignore` support is deliberately partial** — bare top-level directory names only, real glob patterns (`*.log`, nested-path patterns) are skipped rather than mishandled. Good enough to catch "this whole directory isn't project content," not a reimplementation of git's ignore matching.
- **TF-IDF, not embeddings.** Layer 4 is a real, working, zero-cost approximation — not a claim that semantic dedup at "same idea, wildly different words" scale is solved. See `src/core/similarity.mjs`'s header for the exact upgrade path when that's worth the cost.
- **Union-find, not Leiden.** Layer 5's clustering can transitively over-merge in a large, densely-connected corpus. Not yet observed as a real problem at the scale this has been tested against; watch for it before scaling up much further.
- **Binary files aren't handled** anywhere in this pipeline — every layer assumes UTF-8 text.
- **`files` mode's containment/similarity stages are O(n²)** pairwise comparisons over survivors — measured directly above, not just asserted. See "How deeper passes should progress" for the concrete next step before this hits a wall at real scale.

## Validated against real data

Both adapters have been run against a real production repo, not just synthetic tests: `git` mode reproduced a prior, independently-verified result exactly (44 redundant / 3 auto-mergeable / 0 genuine conflicts across 47 contended files, 27 active branches) while fixing a real bug in that prior version (a false "needs manual resolution" verdict caused by comparing against the wrong merge-base, now correctly resolved as `auto_mergeable`). `files` mode found real, correct near-duplicate clusters in that repo's own content at 0.998–0.9999 similarity — genuinely near-identical forked/templated files, not noise — at two different corpus scales, with the containment and similarity layers' O(n²) cost directly measured rather than assumed, and every discard independently audited and confirmed lossless both times.
