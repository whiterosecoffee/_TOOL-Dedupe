// Usage: node spike/run-spike.mjs [seeds=5] [families=8]
// Generates seeded ground-truth corpora, runs every tool on identical inputs, prints one table.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCorpus, writeCorpus } from "./gen-corpus.mjs";
import { score, merge } from "./eval.mjs";
import { toolV0, toolShingle, toolBlock, toolMulti } from "./tools.mjs";
import { STRATEGIES } from "./segment.mjs";

const seeds = Number(process.argv[2] ?? 5);
const families = Number(process.argv[3] ?? 8);
const TOOLS = {
  "v0 (old, as shipped)": (d) => toolV0(d),
  "v0 + --normalize": (d) => toolV0(d, { normalize: true }),
  "similarity-decides (ablation)": (d) => toolShingle(d),
  "block: paragraphs (blank lines)": (d) => toolBlock(d, { segment: STRATEGIES.paragraph, minWords: 60 }),
  "block: paragraphs + line fallback": (d) => toolBlock(d, { segment: STRATEGIES.paragraphWithLineFallback, minWords: 60 }),
  "block: sentences (layout-invariant)": (d) => toolBlock(d, { segment: STRATEGIES.sentence, minWords: 60 }),
  "multi-segmentation (any-verify, 2-agree review)": (d) => toolMulti(d, { segments: Object.values(STRATEGIES) }),
};

const totals = {};
let docCount = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const corpus = generateCorpus(seed, { families });
  docCount += corpus.docs.length;
  const dir = mkdtempSync(join(tmpdir(), "spike-"));
  try {
    writeCorpus(dir, corpus.docs);
    for (const [name, run] of Object.entries(TOOLS)) {
      const { verdicts, comparisons } = run(dir);
      const s = score(corpus.truth, verdicts, comparisons);
      totals[name] = totals[name] ? merge(totals[name], s) : s;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");
const first = Object.values(totals)[0];
const lines = [];
lines.push(`Seeds: ${seeds}, families/seed: ${families}, documents: ${docCount}, labelled pairs: ${first.pairs}`);
lines.push(`Truth mix: ${Object.entries(first.byTruth).map(([k, r]) => `${k}=${r.collapse + r.review + r.separate}`).join(", ")}\n`);
lines.push("| tool | unsafe merges | safe-collapse recall | conflicts etc. surfaced | hidden by collapse | review band | false review | typed triage | comparisons |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const [name, m] of Object.entries(totals)) {
  lines.push(
    `| ${name} | ${m.unsafeMerges} | ${pct(m.collapsedSafely, m.collapseRequired)} (${m.collapsedSafely}/${m.collapseRequired}) | ` +
      `${pct(m.surfaced, m.needsReview)} (${m.surfaced}/${m.needsReview}) | ${m.hiddenByCollapse} | ${m.reviewBand} | ${m.falseReview} | ` +
      `${m.typedCount ? pct(m.typedCorrect, m.typedCount) : "untyped"} | ${m.comparisons} |`
  );
}
lines.push("\nVerdict by true relationship (collapse / review / separate):");
for (const [name, m] of Object.entries(totals)) {
  lines.push(`\n${name}`);
  for (const [cls, r] of Object.entries(m.byTruth)) lines.push(`  ${cls.padEnd(10)} ${r.collapse} / ${r.review} / ${r.separate}`);
}
const out = lines.join("\n");
console.log(out);
writeFileSync(new URL("./results.txt", import.meta.url), out + "\n");
