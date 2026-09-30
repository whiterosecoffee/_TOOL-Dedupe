// Layer 4: "same idea, different words" -- the case exact hash, containment, and 3-way merge
// all correctly miss, because none of them compare meaning, only literal text structure.
//
// This is TF-IDF + cosine similarity: zero dependencies, zero API keys, zero cost, runs fully
// offline. It is NOT a real embedding model -- it catches vocabulary overlap (two records using
// a lot of the same distinctive words), not deep paraphrase (two records saying the same thing
// in completely different words). That's a deliberate, honest tradeoff: this is the cheap first
// cut that works today with no setup, not a claim that it solves semantic dedup in general.
//
// Upgrade path, when it's worth the cost: replace `embed()` below with a call to a real
// embedding model (local: e.g. a sentence-transformers/BGE/E5 model over ONNX or a Python
// sidecar; hosted: an API call) that returns a dense vector per record instead of the sparse
// TF-IDF vector built here. Everything downstream (cosineSimilarity, cluster.mjs) is already
// vector-agnostic -- it just needs `embed(text) -> number[]`, not specifically a TF-IDF vector.
// Swapping the embedding function is the entire upgrade; nothing else in this file changes.

const STOPWORDS = new Set(
  "a an the is are was were be been being and or but if then else for to of in on at by with from as this that these those it its it's".split(" ")
);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Build TF-IDF vectors for a corpus. Returns embed(text) usable on new text against this corpus. */
export function buildTfidfEmbedder(corpusTexts) {
  const docTokens = corpusTexts.map(tokenize);
  const docFreq = new Map(); // term -> number of documents containing it
  for (const tokens of docTokens) {
    for (const term of new Set(tokens)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  const N = corpusTexts.length;
  const idf = new Map();
  for (const [term, df] of docFreq) idf.set(term, Math.log((N + 1) / (df + 1)) + 1); // smoothed idf

  function embed(text) {
    const tokens = tokenize(text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map();
    for (const [term, count] of tf) {
      const weight = (count / tokens.length) * (idf.get(term) ?? Math.log(N + 1) + 1); // unseen term: max idf
      if (weight > 0) vec.set(term, weight);
    }
    return vec; // sparse vector: Map<term, weight> -- cosineSimilarity below works on this shape
  }

  return embed;
}

/** Cosine similarity between two sparse vectors (Map<term, weight>). */
export function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  for (const [term, weightA] of vecA) {
    const weightB = vecB.get(term);
    if (weightB) dot += weightA * weightB;
  }
  const normA = Math.sqrt([...vecA.values()].reduce((s, w) => s + w * w, 0));
  const normB = Math.sqrt([...vecB.values()].reduce((s, w) => s + w * w, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}
