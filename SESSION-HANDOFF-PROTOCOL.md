<!--
Provenance: received 2026-10-01 from the originating "DE-DUPE TOOL" session (rooted in the Prompts
repo), pasted by the owner. The text below the rule is saved as received.
NOT confirmed by that session: whether this is the exact text it ran or a reconstruction.
NOT present in the text: the "standing concurrency check" (local-vs-origin ahead/behind, other
live sessions on the same checkout) that the same session's summary said v3 added. Treat that
check as a known gap in this version, not as part of it.
This is a general protocol, not de-dupe code; it is kept here only so it survives. Its natural
home is next to SESSION-CLOSING-PROTOCOL.md in the Prompts repo (see HANDOFF.md task 8).
-->

---

SESSION HANDOFF — re-scope active work into its own scope (v3)

INPUTS (I supply; ask only if missing)
  scope_name     <slug for the scope>
  source         <this session's own context — its transcript/tool
                  history, not another session's>
  target_kind    <git-repo | plain-folder | same-repo-new-session |
                  other — state which>
  parent_root    <directory/location under which the scope lives,
                  if target_kind needs one>
  target_state   <new | existing — if existing, name its path/url>

PHASE 1 — MANIFEST (ANSWER only. No writes, no commands that mutate.)
Pull only from source. If target_state is "existing," check what's
actually there first — don't assume empty; treat this as
sync-and-continue, not create. Produce:

1. SCOPE STATEMENT, 3 lines max: what this scope is, what it is not,
   what "done" looks like.

2. INVENTORY, one row per item:
   kind (transcript | decision | artifact | unfinished task | ghost | open question)
   | origin address | disposition (MOVE | COPY | REFERENCE | LEAVE)
   | reason
   Default is REFERENCE, not MOVE. If target_state is "existing," mark
   anything already correctly in place as LEAVE, not re-MOVE.

3. UNFINISHED TASKS: for each, state four parts:
   - attest: what must be checkably true for it to be done
   - lives: where the solution belongs (be concrete)
   - unmet because: why it isn't done today
   - clears when: what would unblock it
   Classify contingent or structural. Default suspicion: contingent.
   A task missing any of the four parts becomes a ghost with blanks
   carried as the maturity statement.

4. SUPERSESSIONS: anything in the source that was corrected or
   replaced. Carry a reference to what it replaced. Don't edit old text.

5. SPLIT RISKS: items straddling the scope boundary. State the
   partition logic once: what makes something "in" vs. "referenced."

6. PROPOSED STRUCTURE: check what already exists at the target before
   proposing anything. If something real is already there (of whatever
   kind — code, documents, notes), add only what's missing, usually one
   handoff record. If genuinely new, propose the minimal real structure
   that kind of scope actually needs, each piece with a stated reason —
   don't default to a software-project shape unless the scope is one.

7. WRITE-PATH CHECK: before specifying how content gets written into
   the target, check whether it already has its own structured intake
   mechanism (a schema, an adapter, a CLI, a required format). If yes,
   name and use it. If no, say so and use a plain write — never assume
   a specific mechanism without checking.

8. VERSIONING CHECK: if target_kind is git-repo, state the real git
   state (branch, sync status) before proposing any git action. If it
   isn't a git repo, say so and drop every git-specific step below —
   don't apply them by default.

9. EXCHANGE BLOCK: target / action / intent / cost / value / rationale,
   for Phase 2.

STOP. Wait for a yes or edits.

PHASE 2 — EXECUTE (only on yes; estimate cost first)
  a. If target_kind is git-repo and target_state is "new": create,
     git init, scaffold-only first commit. If "existing": re-verify
     current state before writing (don't trust the Phase 1 read as
     still current). If target_kind is anything else: do the
     equivalent real step for that kind — state what it is.
  b. Write exactly what Phase 1's EXCHANGE BLOCK listed — nothing else.
  c. Unfinished tasks and ghosts go into one handoff record, four-part
     form, named to match the target's own convention if one exists
     (otherwise HANDOFF.md).
  d. If git-repo: commit, message states scope and what's unresolved.
     If not: do the real equivalent close-out step, or state there
     isn't one.
  e. Leave the origin untouched except one reference pointing at the
     new location. No deletions — unless something is independently
     verified redundant, in which case delete it and state exactly
     what verification justified it.
  f. Verify: every MOVE/COPY inventory row exists at its destination;
     every unfinished task appears in the handoff record.
  g. Report actual cost vs. the Phase 1 estimate.

RULES
  - Narrow stays narrow: nothing adjacent to scope_name.
  - Never build a second system beside an existing one; check first.
  - If source isn't reachable by a tool, record that as a contingent
    constraint with its unblocker named — don't fabricate content.
  - If a rule here serves the outcome worse than an alternative in this
    specific case, say so and propose the alternative.
  - End with: Next step: <queued action>.
