# de-dupe

Layered deduplication for the case that keeps recurring: many independent contributors (concurrent agent sessions, forked branches, scattered documents) produce a lot of content that overlaps, and most of that overlap is redundant, not a real disagreement — but you can't tell which is which without actually looking, and looking at everything by hand doesn't scale.

Grew out of a concrete incident: 27+ concurrent Claude Code sessions sharing one git repo produced heavily overlapping branches. The first fix (materializing every branch's full diff into a review folder) worked but didn't scale — most of what looked like "contention" turned out to be exact duplication or a trivial merge, and copying it all just moved the noise into a different file. This repo is the generalized, reusable version of the fix that actually worked: **triage every overlap by real content comparison before deciding it needs human attention at all.**

## The five layers

Each layer only ever sees what survived the one before it — cheapest and most certain first, so expensive/approximate layers run on the smallest possible remainder.

1. **Exact hash** (`src/core/hash.mjs`) — SHA-256 over raw content. Two records with the same hash are byte-identical, provably, for free. No two records ever need a full comparison if they already match here.
2. **Order-preserving containment** (`src/core/containment.mjs`) — is A a subsequence of B (everything A has, in the same order, plus more)? Deliberately *not* a naive "shared lines" check — that has a real false-positive mode (two files sharing common boilerplate get called "subset" of each other even with no actual structural relationship). This is a single-pass, order-preserving check instead.
3. **3-way-merge mergeability** (`src/core/merge3.mjs`) — for content that diverges but shares a real common ancestor, does `git merge-file` resolve it with zero conflicts? If so, it's disjoint/additive edits, not a genuine disagreement.
4. **TF-IDF similarity** (`src/core/similarity.mjs`) — "same idea, different words," approximated with zero dependencies and zero cost: vocabulary-overlap cosine similarity, not a real embedding model. Catches restated/templated content well (validated: 0.999+ scores on genuinely near-duplicate content in real testing); will miss a deep paraphrase that shares little vocabulary. The upgrade path to a real embedding model is a one-function swap — see that file's header.
5. **Clustering** (`src/core/cluster.mjs`) — union-find grouping over the similarity graph from layer 4. A simple, honest stand-in for real community detection (e.g. Leiden) — correct for small-to-medium corpora, but can transitively over-merge (A~B~C~D doesn't mean A and D are related) at real scale. Upgrade when that failure is actually observed, not before.

**What never happens automatically:** a genuine disagreement (layer 3 finds real conflicting edits) is never auto-resolved by picking a side. That's the one case worth a human looking at — everything else is redundant or safely mergeable and shouldn't cost anyone's attention.

## Adapters

- **`git`** (`src/adapters/git-branches.mjs`) — compares every branch of a git repo against a base ref, per contended file. The branch-consolidation use case this project started from.
- **`files`** (`src/adapters/files.mjs`) — walks a plain directory of text files. No git required; works on any corpus (documents, exported conversations, a scattered idea dump).

Adding a new source is writing a new adapter that produces `{id: string, content: string}[]` records — every core layer and pipeline is source-agnostic.

## Usage

```bash
npm test                                                    # 15 tests, all core layers + an end-to-end corpus test

node src/cli.mjs git --repo <path> --base <ref> [--remote origin] [--exclude a,b] [--out report.json]
node src/cli.mjs files --dir <path> [--threshold 0.65] [--out report.json]
```

`--help` on either subcommand or the bare CLI prints the full flag list.

**Always pass `--base` explicitly for `git` mode.** It will guess `<remote>/HEAD`'s target if you don't, and that guess is frequently wrong — a repo's real long-lived integration branch is often not what `HEAD` points at (confirmed directly: the repo this tool was built against uses `standardize/v0.3-2026-09-27` as its actual working branch while `origin/HEAD` points at `master`). The resolved base is always printed first, specifically so a wrong guess is visible immediately.

## Known limitations (real, not hidden)

- **Exact-path/no cross-identity matching.** Two sources that produce equivalent content under different names or paths (including a pure case difference — a real bug hit and fixed by hand in the repo this grew out of) aren't linked by any layer here. Would need a hash of normalized/canonicalized paths, or content-first grouping instead of path-first, to catch that class.
- **TF-IDF, not embeddings.** Layer 4 is a real, working, zero-cost approximation — not a claim that semantic dedup at "same idea, wildly different words" scale is solved. See `src/core/similarity.mjs`'s header for the exact upgrade path when that's worth the cost.
- **Union-find, not Leiden.** Layer 5's clustering can transitively over-merge in a large, densely-connected corpus. Not yet observed as a real problem at the scale this has been tested against; watch for it before scaling up much further.
- **Binary files aren't handled** anywhere in this pipeline — every layer assumes UTF-8 text.
- **`files` mode's containment/exact-dedupe stages are O(n²)** pairwise comparisons over survivors — fine at hundreds of files (tested), would need the similarity layer moved earlier as a pre-filter (only compare within a candidate cluster) before this scales to thousands.

## Validated against real data

Both adapters have been run against a real ~1000-branch/200-file production repo, not just synthetic tests: `git` mode reproduced a prior, independently-verified result exactly (44 redundant / 3 auto-mergeable / 0 genuine conflicts across 47 contended files, 27 active branches) while fixing a real bug in that prior version (a false "needs manual resolution" verdict caused by comparing against the wrong merge-base, now correctly resolved as `auto_mergeable`). `files` mode found real, correct near-duplicate clusters in that repo's own content at 0.998–0.9999 similarity — genuinely near-identical forked/templated files, not noise.
