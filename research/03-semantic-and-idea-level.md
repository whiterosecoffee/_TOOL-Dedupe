# 03 - Semantic and idea-level dedup: prior art

Scope: embedding dedup, STS/paraphrase, sub-document decomposition, cross-encoder rerank, LLM-as-judge. Context: local, mostly offline Node/Python text-file tool; triage overlap by real content comparison; never lose information.
Legend: each claim has a URL I fetched or saw in search results this session. "UNVERIFIED" = background knowledge, not checked.

## 1. Embedding-based dedup (SemDeDup, D4, SoftDedup, SemHash)

- SemDeDup: uses pretrained-model embeddings to remove "semantic duplicates" (similar, not identical). Removed 50% of a LAION subset with minimal loss; improved C4 LM experiments. https://arxiv.org/abs/2303.09540
  - Needs an embedding model plus clustering. The cluster-then-compare-within-cluster design and the epsilon value are UNVERIFIED (abstract does not state them).
  - Failure mode for us: it is corpus shrinking for ML training, which tolerates losing near-duplicates. That conflicts with "never lose information". Borrow candidate generation, not the deletion policy.
- D4: dedup plus embedding-based diversification for LLM pretraining; ~20% efficiency gain, up to 2% downstream gain at 6.7B. https://arxiv.org/abs/2308.12284 . Same caveat: objective is training value.
- SoftDedup: reweights samples by an n-gram "data commonness" score instead of deleting; >=26% fewer training steps for same perplexity. https://arxiv.org/abs/2407.06654 . Useful idea: graded overlap score instead of binary drop.
- SemHash (MinishLab): Model2Vec embeddings + ANN (Vicinity); default model potion-base-8M; dedups within one dataset or across two; scales to millions of records. https://minish.ai/packages/semhash/introduction/ and https://minish.ai/blog/2025-01-12-semhash-blogpost/ . Closest off-the-shelf tool; CPU only, no API.

## 2. Embedding models and runtime cost

- sentence-transformers paraphrase mining: brute force is quadratic and "fails to scale" past ~10,000 sentences, so it chunks (query_chunk_size x corpus_chunk_size); defaults top_k=100, max_pairs=500,000; examples use all-MiniLM-L6-v2. https://www.sbert.net/examples/sentence_transformer/applications/paraphrase-mining/README.html
- Model2Vec: static embeddings distilled from a sentence transformer; up to 50x smaller (~8 MB smallest), "up to 500x faster on CPU", small quality drop. https://github.com/MinishLab/model2vec . Good first-pass recall net on a laptop, no GPU.
- Node path: Transformers.js runs ONNX models (Xenova/all-MiniLM-L6-v2, 384-d; bge-small-en-v1.5, 384-d) locally in Node, no API/GPU. https://huggingface.co/Xenova/all-MiniLM-L6-v2 . One-time model download, then offline (cache behavior UNVERIFIED).
- ANN: USearch is HNSW with a native JavaScript/npm binding, mmap-able index, filter predicates, <1 MB Python package; claims 10x faster than FAISS (vendor claim, unverified independently). https://github.com/unum-cloud/usearch . For thousands to low millions of chunks, brute-force matrix multiply or USearch is enough. FAISS specifics UNVERIFIED.
- SetFit: few-shot contrastive fine-tuning of sentence transformers plus classification head, no prompts. https://arxiv.org/abs/2209.11055 . Could learn a "same / different claim" classifier from a few dozen human triage decisions (idea; applicability UNVERIFIED).

## 3. False-merge risk of embedding thresholds (key evidence)

- Embedding models rate negation and antonym pairs as MORE similar on average than genuinely similar sentences (e.g. "I go to school" vs "I do not go to school"): https://arxiv.org/pdf/2110.15708 (biomedical STS study) and https://preview.aclanthology.org/author-url/2022.blackboxnlp-1.20 (SemAntoNeg, 3152-entry negation/antonym probe set).
- Consequence: a cosine threshold cannot separate "same idea" from "same topic, opposite claim/number/condition". High cosine is a recall signal, never a merge decision. Numbers, dates, negation, modality (must vs may) and entities are the likely hidden differences (specific numeric-insensitivity study NOT verified).
- Threshold values are model- and domain-dependent; no universal epsilon found (UNVERIFIED).
- Mitigation: (a) embeddings only generate candidates; (b) require a second signal before collapsing: NLI/cross-encoder, token-level diff, or normalized exact equality; (c) deterministic guard that numbers, negation tokens, entities match; (d) three-way output: identical / paraphrase-with-guards-passed / needs-human.

## 4. Sub-document units vs whole-file comparison

- Dense X Retrieval: indexing by propositions (atomic, self-contained factoids) "significantly outperforms passage-level units" for retrieval and helps QA at fixed budget. https://arxiv.org/abs/2312.06648 . Evidence is for retrieval, not dedup; transfer is by analogy.
- FActScore: decomposes long text into atomic facts and scores each against a source; automated estimate <2% error vs humans; human evaluation of 6,500 generations would have cost $26K. https://arxiv.org/abs/2305.14251 . Shows atomic-claim granularity works but needs an LLM per document.
- Reasoning (no direct citation, UNVERIFIED as measured): one whole-file vector averages away local differences, so two files sharing 90% but differing in one decisive paragraph look near-identical; a short file wholly contained in a long one looks dissimilar. So compare at paragraph/section level and report containment (fraction of A's units matched in B), not one file score.
- I found no paper directly measuring "sub-document beats whole-file for dedup". Treat as design inference supported by Dense X, not proven.
- LLM-free decomposition: split by headings/paragraphs/sentences; optional keyphrase signature per unit with YAKE (unsupervised, single-document, no corpus/training; pip install yake): https://github.com/LIAAD/yake . RAKE: UNVERIFIED (not fetched). Keyphrases suit blocking keys and explanation labels, not equivalence proof.

## 5. Cross-encoder / NLI rerank

- Pattern: bi-encoder retrieves candidates; cross-encoder or NLI model scores each pair jointly, with entailment/contradiction outputs. (Docs not fetched this session; model names, sizes, speeds UNVERIFIED.)
- Needs likely a ~100-400 MB model, CPU feasible for a shortlist (UNVERIFIED). A contradiction head addresses the negation weakness in sec 3, but NLI models are imperfect on numbers and long inputs (UNVERIFIED).
- Use bidirectional entailment as the strict "equivalent" test; one-way entailment = containment, keep both and record the relationship.

## 6. LLM-as-judge for same vs conflicting

- Strong judges agree with human preferences >80% (same as human-human) but show position, verbosity and self-enhancement bias and limited reasoning. https://arxiv.org/abs/2306.05685
- Position-bias study: 15 judges, >150,000 instances; consistency measured by swapping order; bias is stable across repetitions (not noise) and stronger on hard cases where judges disagree. https://arxiv.org/html/2406.07791v9 . The subtle-conflict cases we need are where the judge is least reliable.
- Cost: API per pair, or a local model needing GPU/high RAM (UNVERIFIED). Cost scales with pair count, so run only on the shortlist.
- Cost/safety controls (design, UNVERIFIED as measured): cascade exact -> normalized -> embedding -> NLI -> LLM; cache by pair hash; run both orders and require agreement else escalate to human; structured verdict {equivalent, a_contains_b, b_contains_a, conflict, unrelated} with verbatim quoted evidence spans, checked to exist in the sources; LLM output alone never triggers deletion.

## 7. What a local, offline tool should borrow

1. Cascade with embeddings as recall only (Model2Vec or MiniLM via Transformers.js/Python), never as merge authority.
2. Paragraph-level units plus per-pair containment ratio instead of one file score.
3. Deterministic guards (numbers, negation, entities, modals); any mismatch routes to human.
4. Optional offline NLI/cross-encoder second opinion on CPU.
5. Optional LLM judge, off by default, double-order, evidence-quoting, shortlist only.
6. Non-destructive collapse: record cluster membership and differing spans, keep originals; graded overlap score (SoftDedup idea).
7. SetFit-style small classifier trained on the user's own triage decisions (speculative).

## 8. Gaps (UNVERIFIED)
No benchmark found for numeric/date sensitivity of embedding dedup; no direct sub-document vs whole-file dedup study; FAISS, RAKE, cross-encoder specifics, HNSW recall settings, local-LLM judge accuracy not checked.
