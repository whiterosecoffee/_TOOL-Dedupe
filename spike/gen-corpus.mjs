// Ground-truth corpus generator. Documents are built from ATOMS (paragraphs with stable ids), so
// the true relationship between any two documents is known from construction, not guessed by a
// tool. Truth is computed on atom ids only (classifyTruth); no tool ever sees atom ids.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYL = ["ka", "lo", "mi", "ren", "tu", "sha", "vo", "dix", "pel", "gor", "nia", "zu", "bra", "fen"];
const COMMON = "the also each then after before which system process review given every other result note case still within about under".split(" ");

export function generateCorpus(seed, { families = 8 } = {}) {
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const atoms = new Map(); // id -> {text, root, boiler}
  let nAtom = 0;
  const newAtom = (text, root = null, boiler = false) => {
    const id = `a${nAtom++}`;
    atoms.set(id, { text, root: root ?? id, boiler });
    return id;
  };
  const word = () => Array.from({ length: int(2, 3) }, () => pick(SYL)).join("");
  const paragraph = (topic) => {
    if (rand() < 0.25) {
      // List-style paragraph: items with NO terminal punctuation (headings/bullets look like this).
      const items = Array.from({ length: int(3, 5) }, () => "- " + Array.from({ length: int(6, 10) }, () => (rand() < 0.7 ? pick(topic) : pick(COMMON))).join(" "));
      return items.join("\n");
    }
    const sentences = Array.from({ length: int(3, 5) }, () => {
      const words = Array.from({ length: int(8, 14) }, () => (rand() < 0.7 ? pick(topic) : pick(COMMON)));
      return words.join(" ") + ".";
    });
    return sentences.join(" ");
  };
  const edit = (id) => {
    const src = atoms.get(id);
    const words = src.text.split(" ");
    const at = int(2, words.length - 3);
    if (rand() < 0.5) words.splice(at, 0, "not"); // negation-style edit
    else words[at] = word(); // word-swap edit
    return newAtom(words.join(" "), src.root);
  };
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const H = newAtom("Confidential working draft. Do not distribute outside the review group.", null, true);
  const F = newAtom("End of document. Contact the maintainers with any corrections.", null, true);

  const docs = []; // {id, atoms:[atomId], render}
  const OPS = ["copy", "crlf", "rewrap", "tight", "wraptight", "sparse", "superset", "shrunk", "reorder", "additive", "conflict"];
  for (let f = 0; f < families; f++) {
    const topic = Array.from({ length: 80 }, word);
    const withBoiler = rand() < 0.5;
    const mid = Array.from({ length: int(10, 14) }, () => newAtom(paragraph(topic)));
    const base = withBoiler ? [H, ...mid, F] : mid;
    docs.push({ id: `f${f}-base.md`, atoms: base, render: "plain" });
    const ops = shuffle(OPS).slice(0, int(5, 8));
    ops.forEach((op, k) => {
      const id = `f${f}-${op}${k}.md`;
      let list = [...base];
      let render = "plain";
      if (op === "crlf") render = "crlf";
      else if (op === "rewrap") render = "rewrap";
      else if (op === "tight") render = "tight"; // paragraphs separated by ONE newline, no blank line
      else if (op === "wraptight") render = "wraptight"; // hard-wrapped AND single-newline: paragraph boundaries invisible
      else if (op === "sparse") render = "sparse"; // a blank line between every sentence
      else if (op === "superset" || op === "additive") {
        for (let i = 0; i < int(2, 4); i++) list.splice(int(0, list.length), 0, newAtom(paragraph(topic)));
      } else if (op === "shrunk") {
        for (let i = 0; i < int(2, 4) && list.length > 7; i++) list.splice(int(0, list.length - 1), 1);
      } else if (op === "reorder") {
        do list = shuffle(list);
        while (list.every((x, i) => x === base[i]));
      } else if (op === "conflict") {
        const i = int(withBoiler ? 1 : 0, list.length - (withBoiler ? 2 : 1));
        list[i] = edit(list[i]);
      }
      docs.push({ id, atoms: list, render });
    });
  }
  docs.push({ id: "trivial-h.md", atoms: [H], render: "plain" });
  docs.push({ id: "trivial-hf.md", atoms: [H, F], render: "plain" });

  for (const d of docs) d.text = renderDoc(d, atoms, rand);
  return { docs, atoms, truth: buildTruth(docs, atoms) };
}

function wrap(text, width = 72) {
  const lines = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else line = line ? line + " " + w : w;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function renderDoc(d, atoms, rand) {
  const paras = d.atoms.map((id) => atoms.get(id).text);
  if (d.render === "wraptight") return paras.map((p) => wrap(p)).join("\n") + "\n";
  if (d.render === "sparse") return paras.map((p) => p.split(". ").join(".\n\n")).join("\n\n") + "\n";
  if (d.render === "tight") return paras.join("\n") + "\n";
  if (d.render === "rewrap") return paras.map((p) => wrap(p)).join("\n\n") + "\n";
  const body = paras.map((p) => (d.render === "crlf" && rand() < 0.4 ? p + "  " : p)).join("\n\n") + "\n";
  return d.render === "crlf" ? body.replace(/\n/g, "\r\n") : body;
}

export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function isSubsequence(a, b) {
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) if (a[i] === b[j]) i++;
  return i === a.length;
}

/**
 * True relationship of two atom lists. Classes:
 *  identical | subset (A in B, ordered, >=5 atoms) | trivial (tiny subsequence) | reorder |
 *  conflict (both sides changed the same origin atom) | additive (disjoint additions) | unrelated
 * @returns {{cls: string, subset?: "a"|"b"}}
 */
export function classifyTruth(A, B, atoms) {
  if (A.length === B.length && A.every((x, i) => x === B[i])) return { cls: "identical" };
  const aInB = A.length < B.length && isSubsequence(A, B);
  const bInA = B.length < A.length && isSubsequence(B, A);
  if (aInB || bInA) {
    const small = aInB ? A : B;
    if (small.length < 5) return { cls: "trivial" };
    return { cls: "subset", subset: aInB ? "a" : "b" };
  }
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
  const ca = count(A);
  const cb = count(B);
  const sameMultiset = ca.size === cb.size && [...ca].every(([k, v]) => cb.get(k) === v);
  if (sameMultiset) return { cls: "reorder" };
  const realShared = [...ca].filter(([k]) => cb.has(k) && !atoms.get(k).boiler).length;
  if (realShared === 0) return { cls: "unrelated" };
  const aOnly = A.filter((x) => !cb.has(x));
  const bOnly = B.filter((x) => !ca.has(x));
  const aRoots = new Set(aOnly.map((x) => atoms.get(x).root));
  const contested = bOnly.some((x) => aRoots.has(atoms.get(x).root));
  return { cls: contested ? "conflict" : "additive" };
}

export function buildTruth(docs, atoms) {
  const truth = new Map();
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const t = classifyTruth(docs[i].atoms, docs[j].atoms, atoms);
      const rec = { cls: t.cls };
      if (t.subset) rec.subset = t.subset === "a" ? docs[i].id : docs[j].id;
      truth.set(pairKey(docs[i].id, docs[j].id), rec);
    }
  }
  return truth;
}

export function writeCorpus(dir, docs) {
  mkdirSync(dir, { recursive: true });
  for (const d of docs) writeFileSync(join(dir, d.id), d.text);
}
