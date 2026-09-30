// Layer 5: group records into clusters using pairwise similarity above a threshold. This is a
// union-find (disjoint-set) over the similarity graph, not full Leiden community detection --
// Leiden finds densely-connected sub-communities even when the whole graph is one connected
// component (important at real scale, where transitive similarity chains can wrongly merge
// unrelated topics -- A~B~C~D doesn't mean A and D are related). Union-find is the honest,
// simple version: correct for small-to-medium corpora where that transitive-drift failure mode
// hasn't shown up yet. Upgrade path: swap this for a real Leiden/Louvain implementation
// (e.g. graphology + graphology-communities-louvain) once the corpus is large enough that
// transitive drift becomes a real, observed problem -- not before, per this project's own
// "verify the failure exists before building for it" discipline.
import { buildTfidfEmbedder, cosineSimilarity } from "./similarity.mjs";

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }
  find(id) {
    while (this.parent.get(id) !== id) {
      this.parent.set(id, this.parent.get(this.parent.get(id)));
      id = this.parent.get(id);
    }
    return id;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * @param {{id: string, content: string}[]} records
 * @param {number} threshold  cosine similarity above which two records are considered the same
 *                            cluster (0..1). Start high (e.g. 0.6-0.7) and lower deliberately --
 *                            a threshold set too low silently merges unrelated content, the
 *                            exact "flattening a real variant" failure this whole project is
 *                            trying to avoid one layer up.
 * @returns {{clusters: Map<string, string[]>, pairSimilarities: {a: string, b: string, score: number}[]}}
 */
export function clusterBySimilarity(records, threshold = 0.65) {
  const embed = buildTfidfEmbedder(records.map((r) => r.content));
  const vectors = records.map((r) => ({ id: r.id, vec: embed(r.content) }));
  const uf = new UnionFind(records.map((r) => r.id));
  const pairSimilarities = [];

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const score = cosineSimilarity(vectors[i].vec, vectors[j].vec);
      if (score > 0) pairSimilarities.push({ a: vectors[i].id, b: vectors[j].id, score: Number(score.toFixed(4)) });
      if (score >= threshold) uf.union(vectors[i].id, vectors[j].id);
    }
  }

  const clusters = new Map();
  for (const r of records) {
    const root = uf.find(r.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(r.id);
  }
  // Drop singleton "clusters" -- a cluster of one is just a record with no similar match, not a finding.
  for (const [root, ids] of clusters) if (ids.length < 2) clusters.delete(root);

  pairSimilarities.sort((a, b) => b.score - a.score);
  return { clusters, pairSimilarities };
}
