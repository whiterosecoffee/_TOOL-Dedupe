// Layer 1: exact dedup. A content hash IS an exact-match proof -- two records with the same
// hash are byte-identical, full stop, zero ambiguity, zero cost beyond hashing once per record.
// This is the cheapest and most certain layer; always run it first so every later, more
// expensive layer only ever sees records that have already survived exact dedup.
import { createHash } from "node:crypto";

export function contentHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * @param {{id: string, content: string}[]} records
 * @returns {{groups: Map<string, string[]>, unique: {id: string, content: string, hash: string}[]}}
 *   groups: hash -> record ids sharing that exact content (only entries with 2+ ids are duplicates)
 *   unique: one representative record per distinct hash (first-seen wins), carried forward to Layer 2+
 */
export function exactDedupe(records) {
  const groups = new Map();
  const firstSeen = new Map();
  for (const r of records) {
    const hash = contentHash(r.content);
    if (!groups.has(hash)) groups.set(hash, []);
    groups.get(hash).push(r.id);
    if (!firstSeen.has(hash)) firstSeen.set(hash, r);
  }
  const unique = [...firstSeen.entries()].map(([hash, r]) => ({ id: r.id, content: r.content, hash }));
  return { groups, unique };
}
