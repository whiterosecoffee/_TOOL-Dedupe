# Spike: does block-level comparison with exact verification beat the baseline?

Run: `node spike/run-spike.mjs [seeds=5] [families=8]` (zero dependencies; output also saved to `results.txt`).

## What it is
- `gen-corpus.mjs`: seeded generator. Documents are built from *atoms* (paragraphs with stable ids), so
  the true relationship of every document pair is known from construction (`classifyTruth`):
  identical, subset (ordered, >= 5 atoms), reorder, conflict (same origin paragraph edited on both
  sides), additive (disjoint additions), unrelated, trivial (tiny subsequence). Renderings include
  CRLF + trailing whitespace, hard re-wrapping, and "tight" (paragraphs on single newlines).
- `eval.mjs`: scores per-pair verdicts (collapse / review / separate). Primary metric: **unsafe merges**
  (a collapse that truth says is not safe, including the wrong direction).
- `tools.mjs`: four tools on identical inputs: the old implementation (`src/`), the old one with
  `--normalize`, a "similarity decides" ablation (5-word-shingle containment >= 0.95 triggers
  collapse), and the new block-level path (paragraph blocks, exact ordered verification, typed triage).

## Result (5 seeds x 8 families, 310 documents, 9,474 labelled pairs; see `results.txt`)
| tool | unsafe merges | safe-collapse recall | conflicts etc. surfaced | review band | comparisons |
|---|---|---|---|---|---|
| v0 (old, as shipped) | 0 | 46% | 55% | 322 | 9,474 |
| v0 + --normalize | 0 | 70% | 43% | 204 | 9,474 |
| similarity-decides (ablation) | **329** | 100% | 59% | 211 | 9,474 |
| block-level + exact verify | 0 | 76% | 89% | 328 | 3,620 |

## What this supports
1. **Similarity must not decide.** The ablation collapsed 329 pairs it shouldn't have, including every
   one-word edit and negation (143 real conflicts silently hidden). Matches the research (file 02/03).
2. **Exact verification gives zero unsafe merges** in both the old and new tools; the old tool pays for
   that by missing a lot (46-70% collapse recall) and by hiding conflicts inside undifferentiated
   "similar" clusters.
3. **Block-level units help:** better recall than the old tool, 89% of real conflicts/reorders/additive
   pairs surfaced, correct type on 100% of those it typed, with about 62% fewer comparisons.

## What it does NOT show (read before trusting the table)
- **The generator and the block tool share a unit.** An earlier run without the "tight" layout showed
  the block tool at 100% on everything; that was the generator matching the tool's assumption. With
  paragraphs on single newlines the block tool drops to 76% recall because it sees one giant block.
  Paragraph detection is the weak point; real text varies more than this generator does.
- Synthetic text from a random vocabulary. Natural language, real boilerplate and real edits are not
  tested. The 0.8 token-Jaccard "same block, edited" threshold and the 0.3 related-fraction are
  hand-set (a short block with one changed word falls under 0.8 and is typed "additive", not "conflict").
- The block tool's 13 false reviews come from boilerplate-sharing unrelated documents; the old tool had 5.
- Truth for conflict/additive is defined at paragraph granularity, which flatters paragraph-level tools.
- Candidate generation here is an inverted index on exact block hashes; edited-only overlap would be missed.
- No LSH, embeddings, clustering checks or round-trip delta verification yet; this spike tests only the
  unit-of-comparison question.

## Suggested next steps (not started)
Robust paragraph segmentation (fallback to lines / sentence windows); calibrate the near-block and
related thresholds from random-pair sampling instead of hand-setting; then add cluster verification
and the delta + round-trip hash representation.
