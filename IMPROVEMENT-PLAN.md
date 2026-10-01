# Improvement plan

Source: design review of the current pipeline (core layers, audit, files pipeline). Ordered by risk reduction first, then scale. Each phase is independently shippable and ends with tests plus an audit run.

## Principles
- Trust before speed: fix anything that can produce a wrong "safe to discard" verdict before optimizing.
- Every change gets a test that fails on the old behavior.
- No new dependencies unless a phase says so.

## Phase 1: Correctness of discard verdicts (small, do first) -- DONE

Implemented: the audit is a standalone implementation (rewritten in `src/core/audit.mjs` rather than a new file) with a completeness check; containment has `--min-subset-lines` (default 5) and `--max-size-ratio` (default 20); chains resolve into `finalSupersets`; `--normalize` is opt-in and flagged as `normalizedMatch`. Tests in `test/phase1.test.mjs`.

| # | Change | Files | Done when |
|---|---|---|---|
| 1.1 | **Truly independent audit.** Reimplement subsequence check via LCS (or a separate Python script) and re-hash with a separate code path. Add a *completeness* check: re-hash all files and confirm no exact duplicate exists outside reported groups. | `src/core/audit.mjs`, new `src/core/audit-independent.mjs` | Deliberately injected bug in `isSubsequence` is caught by the audit; test proves it. |
| 1.2 | **Containment size floor.** Skip containment when the subset has fewer than N non-blank lines (default 5) or the superset is more than K times larger (default 20x). Make both flags. | `src/core/containment.mjs`, `src/cli.mjs` | A 1-line `}` file is no longer reported as subset of everything. |
| 1.3 | **Resolve containment chains.** Follow A⊂B⊂C to the final surviving superset; report both the direct and final superset. | `src/pipelines/files-dedupe.mjs` | No report names a discarded file as a superset. |
| 1.4 | **Normalization pass.** Optional normalization (CRLF to LF, trailing whitespace, BOM) applied before hashing and containment; originals still read for audit. Report which files only matched after normalization. | `src/core/normalize.mjs` (new), `hash.mjs`, pipeline | CRLF and LF copies of one file group as duplicates, flagged "normalized match". |

## Phase 2: Robustness

| # | Change | Done when |
|---|---|---|
| 2.1 | Unicode-aware tokenizer (`\p{L}\p{N}`, no ASCII-only strip). Fall back to character n-grams for scripts without whitespace. | Non-English fixture clusters correctly. |
| 2.2 | Detect and skip binary files (NUL-byte sniff); count them in the report instead of failing silently. | Report has `skippedBinary` count. |
| 2.3 | Cluster diagnostics: weakest internal pair, size, and a warning when a cluster exceeds a size or density limit (the observable trigger for Leiden). | Report flags over-merged clusters. |
| 2.4 | Reproducible fixture corpus in `test/fixtures/` with known duplicates, subsets, CRLF variants, boilerplate-only overlaps, non-English text. Add CLI and adapter tests. | `npm test` covers CLI end to end. |

## Phase 3: Scale

| # | Change | Done when |
|---|---|---|
| 3.1 | **Shared candidate generator**: MinHash/SimHash bucketing over shingles, producing candidate pairs once; containment and similarity both consume it instead of their own O(n²) loops. | Comparison count drops on the 422-file corpus; verdicts identical to the brute-force run (diff-tested). |
| 3.2 | Similarity efficiency: precompute norms, inverted-index scoring, store only pairs above a floor (e.g. 0.3) rather than all positive pairs. | Memory is no longer O(n²); results unchanged above the floor. |
| 3.3 | Honest scale statement in the README (in-memory, thousands of files) and a `--max-bytes` guard next to `--max-files`. | README claim matches measured limits. |

Regression rule for 3.1/3.2: run old and new on the same corpus and require identical containment pairs and identical clusters at the default threshold.

## Phase 4: Completing the workflow (optional, after 1-3)

- `dedupe plan`: choose a keep-representative per group (rule-based: newest, shortest path, user-ranked dir) and emit a reviewable action list. Still no deletion.
- `dedupe apply --plan`: execute the plan only into a quarantine folder (move, not delete), with a manifest for undo.
- Real embedding model behind the existing `embed()` seam, run only on survivors, once Phase 3 limits input size.
- Leiden only if 2.3 diagnostics show real over-merging.

## Order and effort

1. 1.1, 1.2, 1.3, 1.4 (roughly a day; mostly small, local edits)
2. 2.4 then 2.1-2.3
3. 3.1 then 3.2, 3.3
4. Phase 4 on demand

## Risks
- Normalization (1.4) changes what counts as "identical"; keep it opt-in and clearly labelled in reports.
- The prefilter (3.1) can miss pairs the brute-force run found; the diff test against brute force is the safeguard, and the audit's completeness check (1.1) covers the exact-duplicate side.
