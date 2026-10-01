// Opt-in text normalization applied BEFORE hashing and containment, so that a CRLF copy and an
// LF copy of the same file (or one with a BOM, or trailing whitespace) are recognized as the same
// content. Off by default: it widens what "identical" means, so reports must say when it was used.
// The audit has its own independent copy of these rules (see core/audit.mjs) on purpose.

export function normalizeText(text) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n");
}
