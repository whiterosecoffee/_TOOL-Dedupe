# HANDOFF: _TOOL-Dedupe

Scope handoff so a fresh session can resume from this file alone. Written 2026-10-01 from two sources: this session's own work (Phase 1 implementation) and a manifest pasted from a previous session. Claims about the Prompts repo come from that previous session and were NOT re-verified here (marked "unverified").

## Scope
`_TOOL-Dedupe` is a standalone layered-deduplication tool (exact hash, order-preserving containment, 3-way-merge, TF-IDF similarity, clustering) plus the real-data research behind its design. It is not the Prompts repo's branch-consolidation effort, and not a knowledge-graph builder; it is a filter meant to sit in front of one. Done means this repo is the sole home for de-dupe code, tests, experiments and open tasks.

## State at handoff
- Repo: `C:\Users\fivet\OneDrive\_TOOL-Dedupe`, remote `github.com/whiterosecoffee/_TOOL-Dedupe`, branch `main`.
- Commits: `a80d268` initial build; `1cd2b8b` diff recording, audit, gitignore scope fix; `69173ce` pass manifest and Splink experiment; `5d03681` improvement plan and Phase 1 (independent audit with completeness check, containment guards, chain resolution via `finalSupersets`, opt-in `--normalize`).
- Tests: `npm test`, 27 passing at `5d03681`.
- Plan: `IMPROVEMENT-PLAN.md`. Phase 1 done; Phases 2-4 open.

## Inventory (pointers)
| kind | address | disposition | note |
|---|---|---|---|
| artifact | `src/`, `test/`, `experiments/splink-real-corpus-test.py` | LEAVE | In place and committed. |
| artifact | `IMPROVEMENT-PLAN.md` | LEAVE | Source of truth for phases. |
| decision | Prompts repo branch `tools/branch-contention-dedupe` (deleted) | REFERENCE (unverified) | Earlier draft; previous session reports it was a strict subset of `src/adapters/git-branches.mjs` + `src/pipelines/git-dedupe.mjs` before deletion. |
| artifact | Prompts repo: `branch-cleanup-analysis.md`, `branch-merge-resolution-analysis.md`, `plan-unique-branch-isolation.md`, `note-variant-folder-convention.md` (on `standardize/v0.3-2026-09-27`) | REFERENCE (unverified) | Origin story and process prior art, not de-dupe code. |
| artifact | Prompts repo: `SESSION-CLOSING-PROTOCOL.md` (commit `dd05a89f`) | REFERENCE (unverified) | Sibling protocol: how a session stops. |
| ghost | `Prompts/_Spaghetti/Unrelated Threads/QGRAPH Knowledge Graph Exercise/` (commit `585623bf`) | REFERENCE (unverified) | Independent prior art for "explode before dedupe" and Fellegi-Sunter. |
| artifact | `C:\Users\fivet\OneDrive\prompts-worktrees\branch-contention-tool` | REFERENCE | Orphaned directory; still exists as of 2026-10-01. See task 7. |
| decision, closed | 18 Prompts-repo branches deleted by the previous session | REFERENCE (unverified) | Prompts-repo scope, closed there; not this repo's concern. |

## Supersessions
- Prompts branch `tools/branch-contention-dedupe` replaced by this repo's git adapter and pipeline (deleted after the previous session verified a strict subset).
- Naive line-set-membership containment replaced by order-preserving subsequence containment.
- Pipeline-shared audit helpers replaced by a standalone audit (`src/core/audit.mjs`); the README's earlier "its own code path" claim is now actually true, and a test enforces it.
- Handoff protocol v1 to v2 to v3 exist only as chat text in the previous session (see task 8).

## Split rule
In scope: anything with a path or SHA in this repo. Referenced only: Prompts-repo material, which is cited but never copied in.

## Unfinished tasks

Each is in four-part form. All are contingent unless marked structural.

### 1. Phase 2 of the plan: robustness (contingent)
- attest: Unicode-aware tokenizer with a non-English fixture that clusters; binary files skipped and counted (`skippedBinary`) in the report; per-cluster diagnostics (weakest pair, size warning); `test/fixtures/` corpus plus CLI and adapter tests; `npm test` green.
- lives: `src/core/similarity.mjs`, `src/adapters/files.mjs`, `src/core/cluster.mjs`, `src/pipelines/files-dedupe.mjs`, `test/`.
- unmet because: planned in `IMPROVEMENT-PLAN.md`, not started.
- clears when: implemented; no external dependency needed.

### 2. Cheap similarity prefilter before containment, with efficiency fixes (contingent)
This merges the previous session's "similarity pre-filter" item with plan items 3.1 and 3.2.
- attest: a shared candidate-pair generator (MinHash/SimHash bucketing) feeds both containment and similarity; re-running the 422-file benchmark shows lower comparison counts; containment pairs and clusters at the default threshold are identical to a brute-force run (diff-tested); similarity precomputes norms, uses an inverted index and stores only pairs above a floor.
- lives: new module in `src/core/`; `src/pipelines/files-dedupe.mjs`; `src/core/similarity.mjs`.
- unmet because: justified by README's measured results (containment 54-63% of runtime) but never built.
- clears when: task 4 (dependency decision) is answered, or the prefilter is hand-written zero-dependency.

### 3. Calibrate the similarity threshold (contingent)
- attest: the hardcoded `0.65` in `src/core/cluster.mjs` is replaced by a data-derived threshold (Splink-style unsupervised estimation), or the README records an explicit decision to keep it with a stated reason.
- lives: `src/core/similarity.mjs`, `src/core/cluster.mjs`, `README.md`.
- unmet because: `experiments/splink-real-corpus-test.py` shows the mechanism is sound, but nothing in the pipeline uses it.
- clears when: implemented, or deferred in writing in the README.

### 4. Dependency adoption decision (structural: needs an explicit yes)
- attest: either `ignore` (full gitignore matching) and a MinHash library are added to `package.json` and used, or the README states why the repo stays zero-dependency.
- lives: `package.json`, `src/adapters/files.mjs`.
- unmet because: the repo's zero-dependency stance was deliberate. The previous session cited adoption figures (`ignore` about 380M/week, `minhash` about 9.7K/week), unverified here.
- clears when: the owner answers.

### 5. "Explode before de-dupe": decide the unit of comparison (structural)
- attest: a written decision on whether comparison stays at whole-file level or a decomposition pass (cheap: RAKE/YAKE; expensive: LLM claim extraction) runs first, naming which depth to pilot first, scoped to one concrete test.
- lives: a new `ARCHITECTURE.md` or a README section, before any new adapter code.
- unmet because: argued from two directions (direct reasoning and the QGRAPH prior art) but no code or decision doc exists.
- clears when: the owner picks a pilot depth.

### 6. Phase 4 of the plan: plan/apply workflow, embeddings, Leiden (contingent, on demand)
- attest: `dedupe plan` emits a reviewable keep-representative list; `dedupe apply --plan` moves files to a quarantine folder with an undo manifest (no deletion); embeddings and Leiden only if Phase 2 diagnostics show over-merging or a need.
- lives: new commands in `src/cli.mjs`, new modules in `src/`.
- unmet because: deliberately sequenced after Phases 2-3.
- clears when: Phases 2-3 are done and the owner asks for it.

### 7. Orphaned worktree directory (contingent)
- attest: `C:\Users\fivet\OneDrive\prompts-worktrees\branch-contention-tool` no longer exists.
- lives: filesystem only, outside git.
- unmet because: an OneDrive file lock blocked deletion (previous session's report); the directory still existed on 2026-10-01.
- clears when: the lock releases (often after a reboot) and someone deletes it by hand.

### 8. Preserve the SESSION HANDOFF protocol (ghost: lives outside this repo)
- attest: the protocol (v3) exists as a real file, for example `SESSION-HANDOFF-PROTOCOL.md` in the Prompts repo next to `SESSION-CLOSING-PROTOCOL.md`.
- lives: Prompts repo root (outside this session's folders).
- unmet because: the protocol exists only as chat text in the previous session, and writing it to the Prompts repo was not approved here. Maturity: the v3 text is not available in this session, only its resulting manifest.
- clears when: the owner has the previous session (or a new one) write it to the Prompts repo in an isolated worktree, or supplies the v3 text.

## Known unverified claims
Everything about the Prompts repo above (deleted branches, `dd05a89f`, `585623bf`, branch contents). A fresh session should re-check with `git log` there before relying on it.

## Resume here
Next step: Phase 2 (task 1), unless the owner first answers task 4 or task 5.
