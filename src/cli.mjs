#!/usr/bin/env node
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGitDedupe } from "./pipelines/git-dedupe.mjs";
import { runFilesDedupe } from "./pipelines/files-dedupe.mjs";
import { auditZeroLoss } from "./core/audit.mjs";
import { countRecordsInDirectory } from "./adapters/files.mjs";
import { PASSES, PLANNED_NEXT_PASS } from "./passes.mjs";

const USAGE = `de-dupe: layered deduplication (exact hash -> order-preserving containment ->
3-way-merge mergeability -> TF-IDF similarity clustering)

Usage:
  dedupe scan --dir <path> [--ignore-dirs a,b]
  dedupe git --repo <path> [--base <ref>] [--remote <name>] [--exclude a,b] [--branches a,b] [--out <path>]
  dedupe files --dir <path> [--threshold <0..1>] [--ignore-dirs a,b] [--no-gitignore] [--max-files <n>|false]
               [--normalize] [--min-subset-lines <n>] [--max-size-ratio <n>] [--out <path>]
  dedupe audit --report <path> --dir <path>
  dedupe passes
  dedupe --help

scan   Fast, content-free dry run: count what "files" would walk (file count, bytes, extension
       breakdown, directories being skipped) WITHOUT reading anything. Run this first on any
       directory you haven't scanned before -- the cheapest possible step in this whole tool is
       finding out you're about to scan the wrong thing before paying to actually read it.

git    Compare every branch of a git repo against a base ref; verdict each contended file as
       redundant (dedupe), auto_mergeable, or needs_variant. Always pass --base explicitly --
       a repo's real integration branch is frequently not <remote>/HEAD's target.

files  Walk a plain directory of text files; find exact duplicates, containment relationships,
       and (TF-IDF-similarity) near-duplicate clusters among what's left. No git required.
       Respects the target directory's own .gitignore by default for bare top-level directory
       names (real globs aren't handled -- see src/adapters/files.mjs). Stops at 5000 files by
       default as a safety cap, not a real limit -- override with --max-files.

       --normalize compares after normalizing line endings, BOM and trailing whitespace (opt-in;
       groups matched only this way are flagged normalizedMatch). --min-subset-lines (default 5)
       and --max-size-ratio (default 20) stop tiny files being reported as "subsets" of everything.

audit  Independently re-derive every exact-duplicate and containment claim in a files-dedupe
       report straight from disk (fresh reads, not the pipeline's own in-memory state) and
       report any mismatch. Run this before trusting a report's discards; zero loss is only
       as real as the last time it was actually re-checked.
`;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (!command || command === "--help" || flags.help) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  if (command === "git") {
    if (!flags.repo) {
      console.error("Missing --repo <path>\n\n" + USAGE);
      process.exit(1);
    }
    const opts = {
      repoRoot: resolve(String(flags.repo)),
      remote: flags.remote ? String(flags.remote) : undefined,
      base: flags.base ? String(flags.base) : undefined,
      branches: flags.branches ? String(flags.branches).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      exclude: flags.exclude ? String(flags.exclude).split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    };
    if (!opts.base) {
      console.log(
        `No --base given -- will guess <remote>/HEAD's target. This guess is frequently wrong ` +
          `(a repo's real long-lived integration branch is often not what HEAD points at). Pass --base explicitly once you know it.`
      );
    }
    const report = runGitDedupe(opts);
    console.log(`Base ref: ${report.baseRef} (${report.baseCommit.slice(0, 8)})`);
    console.log(
      `Scanned ${report.branchesScanned.length} branches with content (${report.branchesSkipped.length} disconnected, skipped). ` +
        `${report.totalFilesTouched} files touched, ${report.totalContended} contended.`
    );
    console.log(
      `${report.summary.redundant} redundant, ${report.summary.auto_mergeable} auto-mergeable, ` +
        `${report.summary.needs_variant} genuinely need variant storage.`
    );
    if (report.summary.needs_variant > 0) {
      console.log("\nFiles needing variant storage:");
      for (const [path, r] of Object.entries(report.files)) {
        if (r.verdict === "needs_variant") console.log(`  - ${path}  (${r.branches.join(", ")})`);
      }
    }
    const outPath = flags.out ? String(flags.out) : "dedupe-git-report.json";
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`\nFull report: ${outPath}`);
    return;
  }

  if (command === "scan") {
    if (!flags.dir) {
      console.error("Missing --dir <path>\n\n" + USAGE);
      process.exit(1);
    }
    const dir = resolve(String(flags.dir));
    const ignoreDirs = flags["ignore-dirs"] ? new Set(String(flags["ignore-dirs"]).split(",").map((s) => s.trim()).filter(Boolean)) : undefined;
    const t0 = performance.now();
    const result = countRecordsInDirectory(dir, { ignoreDirs });
    const ms = Math.round(performance.now() - t0);
    console.log(`${result.count} files, ${(result.totalBytes / 1024 / 1024).toFixed(2)} MB, scanned in ${ms}ms (no content read).`);
    console.log("By extension: " + JSON.stringify(result.byExtension));
    console.log("Directories skipped (default + .gitignore): " + result.ignoredDirs.join(", "));
    if (result.count > 5000) {
      console.log(`\nNote: 'files' defaults to a 5000-file safety cap; this directory has ${result.count}. Pass --max-files to proceed, but see README's O(n^2) scaling note first.`);
    }
    return;
  }

  if (command === "files") {
    if (!flags.dir) {
      console.error("Missing --dir <path>\n\n" + USAGE);
      process.exit(1);
    }
    const opts = {
      dir: resolve(String(flags.dir)),
      similarityThreshold: flags.threshold ? Number(flags.threshold) : undefined,
      ignoreDirs: flags["ignore-dirs"] ? new Set(String(flags["ignore-dirs"]).split(",").map((s) => s.trim()).filter(Boolean)) : undefined,
      respectGitignore: flags["no-gitignore"] ? false : undefined,
      normalize: flags.normalize ? true : undefined,
      minSubsetLines: flags["min-subset-lines"] ? Number(flags["min-subset-lines"]) : undefined,
      maxSizeRatio: flags["max-size-ratio"] ? Number(flags["max-size-ratio"]) : undefined,
      maxFiles: flags["max-files"] === "false" ? false : flags["max-files"] ? Number(flags["max-files"]) : undefined,
    };
    const report = runFilesDedupe(opts);
    console.log(`Scanned ${report.totalFiles} files.`);
    console.log(
      `${report.exactDuplicateGroups.length} exact-duplicate groups (${
        report.totalFiles - report.afterExactDedupe
      } redundant copies). ${report.containmentPairs.length} containment relationships. ` +
        `${report.afterContainment} files remain after removing exact and contained duplicates.`
    );
    console.log(`${report.similarityClusters.length} similarity clusters found among those (threshold ${opts.similarityThreshold ?? 0.65}).`);
    console.log(
      `\nTiming: load ${report.timings.load_ms}ms, exact-hash ${report.timings.exact_hash_ms}ms, ` +
        `containment ${report.timings.containment_ms}ms, similarity+cluster ${report.timings.similarity_cluster_ms}ms, total ${report.timings.total_ms}ms`
    );
    console.log("Funnel: " + report.funnel.map((f) => `${f.stage}(${f.records_in ?? "-"}->${f.records_out})`).join(" -> "));
    const outPath = flags.out ? String(flags.out) : "dedupe-files-report.json";
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`\nFull report: ${outPath}`);
    return;
  }

  if (command === "audit") {
    if (!flags.report || !flags.dir) {
      console.error("Missing --report <path> and/or --dir <path>\n\n" + USAGE);
      process.exit(1);
    }
    const report = JSON.parse(readFileSync(String(flags.report), "utf8"));
    const result = auditZeroLoss(report, resolve(String(flags.dir)));
    console.log(`Independently re-checked ${result.checked} claims against fresh disk reads, using code independent of the pipeline.`);
    if (!result.completenessChecked) console.log("Note: report has no file list, so missed-duplicate (completeness) checking was skipped.");
    if (result.pass) {
      console.log("PASS -- zero loss confirmed: every discard the report made is independently verified correct.");
    } else {
      console.log(`FAIL -- ${result.failures.length} claim(s) did not re-verify:`);
      for (const f of result.failures) console.log("  " + JSON.stringify(f));
      process.exit(1);
    }
    return;
  }

  if (command === "passes") {
    console.log("Passes, cheapest and most certain first (src/passes.mjs is the source of truth -- this just prints it):\n");
    for (const p of PASSES) {
      console.log(`[depth ${p.depth}] ${p.label}  (${p.costTier})`);
      console.log(`  strips: ${p.strips}`);
      console.log(`  technique: ${p.technique}`);
      console.log(`  certainty: ${p.certainty}`);
      console.log(`  measured: ${p.measured}`);
      console.log(`  in: ${p.implementedIn}\n`);
    }
    console.log(`Not yet built -- [depth ${PLANNED_NEXT_PASS.depth}] ${PLANNED_NEXT_PASS.label}`);
    console.log(`  ${PLANNED_NEXT_PASS.rationale}`);
    return;
  }

  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

main();
