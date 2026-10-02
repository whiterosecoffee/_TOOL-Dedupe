// Segmentation strategies: text -> ordered list of comparison units ("blocks").
// All normalize CRLF/BOM first and collapse whitespace inside a unit.
const norm = (t) => t.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
const clean = (b) => b.replace(/\s+/g, " ").trim();

/** Units = blank-line-separated paragraphs. Fragile: a file with no blank lines is ONE unit. */
export function paragraph(text) {
  return norm(text).split(/\n[ \t]*\n/).map(clean).filter(Boolean);
}

/** Paragraphs, but if the file has no blank-line structure fall back to one unit per line. */
export function paragraphWithLineFallback(text) {
  const paras = paragraph(text);
  if (paras.length > 1) return paras;
  const lines = norm(text).split("\n").map(clean).filter(Boolean);
  return lines.length > 1 ? lines : paras;
}

/** Units = sentences of the whitespace-flattened text. Invariant to wrapping and paragraph layout. */
export function sentence(text) {
  return clean(norm(text)).split(/(?<=[.!?])\s+/).filter(Boolean);
}

export const STRATEGIES = { paragraph, paragraphWithLineFallback, sentence };
