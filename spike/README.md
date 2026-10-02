# Spike: unit of comparison, and robust paragraph detection

Run: `node spike/run-spike.mjs [seeds=5] [families=8]` (zero dependencies; output also saved to `results.txt`).

## What it is
- `gen-corpus.mjs`: seeded generator. Documents are built from *atoms* (paragraphs with stable ids), so the
  true relationship of every document pair is known from construction (`classifyTruth`): identical, subset
  (ordered, >= 5 atoms), reorder, conflict (same origin paragraph edited on both sides), additive (disjoint
  additions), unrelated, trivial (tiny subsequence). Renderings: plain, CRLF + trailing whitespace, hard
  re-wrap, "tight" (single newlines), "wraptight" (wrapped AND single newlines: paragraph boundaries are
  invisible), "sparse" (blank line between every sentence). About a quarter of paragraphs are bullet lists
  with no terminal punctuation.
- `segment.mjs`: three ways to cut text into comparison units: blank-line paragraphs; paragraphs with a
  per-line fallback; sentences of whitespace-flattened text.
- `eval.mjs`: scores per-pair verdicts (collapse / review / separate). Primary metric: **unsafe merges**
  (a collapse that truth says is not safe, including the wrong direction).
- `tools.mjs`: the old implementation (`src/`), the old one with `--normalize`, a "similarity decides"
  ablation (5-word-shingle containment >= 0.95 triggers collapse), the block-level classifier under each
  segmentation, and a **multi-segmentation** tool: run the same exact classifier under all three
  segmentations; collapse if any exactly verifies an ordered subset (conflicting directions go to review);
  send to review only if at least two segmentations agree.

## Result (5 seeds x 8 families, 307 documents, 9,294 labelled pairs; see `results.txt`)
| tool | unsafe merges | safe-collapse recall | conflicts etc. surfaced | review band | false review | typed triage | comparisons |
|---|---|---|---|---|---|---|---|
| v0 (old, as shipped) | 0 | 35% | 61% | 375 | 5 | untyped | 9,294 |
| v0 + --normalize | 0 | 48% | 53% | 287 | 5 | untyped | 9,294 |
| similarity-decides (ablation) | **324** | 99% | 51% | 176 | 0 | untyped | 9,294 |
| block: paragraphs (blank lines) | 0 | 49% | 77% | 293 | 10 | 97% | 2,192 |
| block: paragraphs + line fallback | 0 | 47% | 85% | 409 | 10 | 91% | 2,960 |
| block: sentences | 0 | 60% | 100% | 659 | 64 | 62% | 3,271 |
| multi-segmentation | 0 | **85%** | 85% | 329 | 10 | 90% | 3,278 |

## What this supports
1. **Similarity must not decide.** The ablation made 324 unsafe merges and silently hid 167 real
   conflicts (every one-word edit and negation). Consistent with the research (files 02, 03).
2. **No single segmentation is robust.** Paragraph splitting breaks when blank lines are absent; the line
   fallback breaks on wrapped text and lists; sentence splitting breaks on list items with no punctuation
   (units run across paragraph boundaries) and produced 64 false reviews and only 62% typing accuracy.
3. **Verifying under several segmentations helps, and stays safe.** Each check is exact on its own units,
   so adding segmentations raised safe-collapse recall from 47-60% to 85% with zero unsafe merges, and it
   cut sentence-level false reviews from 64 to 10 by requiring two segmentations to agree.
4. All block-level variants beat the old tool on collapse recall and on surfacing conflicts, with roughly
   65-77% fewer comparisons, and keep zero unsafe merges.

## What it does NOT show (read before trusting the table)
- **Generator coupling is still the main risk.** Twice the generator matched the tool's assumption and gave
  a near-perfect score (blank-line paragraphs, then sentence units); each time adding a harder layout
  exposed the gap. The current layouts are the ones I thought of, not a sample of real documents.
- Synthetic text from a random vocabulary; no real prose, code, tables, headings, or markdown nesting.
- The 15% of safe collapses still missed are mostly wrapped + unpunctuated combinations where no
  segmentation recovers the original paragraph boundaries. I did not analyze them file by file.
- Conflict "surfaced" fell from 100% (sentences alone) to 85% (agreement rule): that is the price of the
  agreement requirement. I did not tune it.
- Thresholds are hand-set: 0.8 token-Jaccard for an "edited unit", 0.3 related-fraction, 60-word minimum
  for a collapsible subset. A short unit with one changed word falls below 0.8 and is typed "additive".
- Truth for conflict/additive is defined at paragraph granularity, which flatters paragraph-level tools.
- Candidate generation is an inverted index on exact unit hashes; overlap made only of edited units is
  missed. No LSH, embeddings, cluster checks, or round-trip delta verification yet.

## Suggested next steps (not started)
Calibrate the three thresholds by random-pair sampling instead of hand-setting; inspect the residual 15%
missed collapses; test on real documents (this repo's own markdown, git branch variants) where truth is
partly unknown, using the independent audit instead of ground truth; then add cluster verification and the
delta + round-trip hash representation.
