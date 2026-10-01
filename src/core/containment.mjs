// Layer 2: is A's content a strict subset of B's -- i.e. does B contain everything A has, in
// the same relative order, plus more? This replaces a naive "every line of A also appears
// SOMEWHERE in B" (line-set membership) check, which has a real false-positive mode: two files
// that just happen to share common boilerplate lines (a shared header, a repeated license
// block) get called "subset" of each other even though neither actually contains the other's
// structure. Order-preserving containment (A is a subsequence of B) doesn't have that failure:
// shared boilerplate lines scattered out of order won't satisfy it.
//
// Implementation: a single-pass greedy subsequence check, O(|A| + |B|) lines, not a full O(|A|*|B|)
// LCS dynamic program -- deliberately cheap because this runs on every pair of near-duplicate
// candidates, not once per file.

function lines(text) {
  return text.split("\n");
}

/** Is `a` a subsequence of `b` (every line of a appears in b, in order, not necessarily contiguous)? */
export function isSubsequence(a, b) {
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) {
    if (a[i] === b[j]) i++;
  }
  return i === a.length;
}

/**
 * @returns {"identical"|"a_subset_of_b"|"b_subset_of_a"|"neither"}
 */
export function classifyContainment(aText, bText) {
  if (aText === bText) return "identical";
  const a = lines(aText);
  const b = lines(bText);
  // Cheap reject: A can't be contained in B if A has more non-empty lines than B.
  const aCount = a.filter(Boolean).length;
  const bCount = b.filter(Boolean).length;
  if (aCount <= bCount && isSubsequence(a, b)) return "a_subset_of_b";
  if (bCount <= aCount && isSubsequence(b, a)) return "b_subset_of_a";
  return "neither";
}

/**
 * Records what the fuller side (`sub` is a subsequence of `full`) actually has that the
 * subset doesn't -- greedily aligns sub's lines against full (same matching order isSubsequence
 * uses) and returns every unmatched line of `full`, with its position. This is the recorded
 * difference: containment says "no information is lost by keeping only `full`," and this proves
 * it by naming exactly what `full` carries beyond `sub`, not just asserting the relationship.
 * @returns {{line: number, text: string}[]}
 */
export function extraLines(subText, fullText) {
  const sub = lines(subText);
  const full = lines(fullText);
  const extra = [];
  let i = 0;
  for (let j = 0; j < full.length; j++) {
    if (i < sub.length && sub[i] === full[j]) {
      i++;
    } else {
      extra.push({ line: j, text: full[j] });
    }
  }
  return extra;
}
