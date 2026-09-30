#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGitDedupe } from "./pipelines/git-dedupe.mjs";
import { runFilesDedupe } from "./pipelines/files-dedupe.mjs";

const USAGE = `de-dupe: layered deduplication (exact hash -> order-preserving containment ->
3-way-merge mergeability -> TF-IDF similarity clustering)

Usage:
  dedupe git --repo <path> [--base <ref>] [--remote <name>] [--exclude a,b] [--branches a,b] [--out <path>]
  dedupe files --dir <path> [--threshold <0..1>] [--out <path>]
  dedupe --help

git    Compare every branch of a git repo against a base ref; verdict each contended file as
       redundant (dedupe), auto_mergeable, or needs_variant. Always pass --base explicitly --
       a repo's real integration branch is frequently not <remote>/HEAD's target.

files  Walk a plain directory of text files; find exact duplicates, containment relationships,
       and (TF-IDF-similarity) near-duplicate clusters among what's left. No git required.
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

  if (command === "files") {
    if (!flags.dir) {
      console.error("Missing --dir <path>\n\n" + USAGE);
      process.exit(1);
    }
    const opts = {
      dir: resolve(String(flags.dir)),
      similarityThreshold: flags.threshold ? Number(flags.threshold) : undefined,
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
    const outPath = flags.out ? String(flags.out) : "dedupe-files-report.json";
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
    console.log(`\nFull report: ${outPath}`);
    return;
  }

  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

main();
