# Factpedia AI Mode

A bilingual Marathi + English knowledge-search experience built with React, TypeScript, HTML and CSS.

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Knowledge sources
- Wikipedia: MediaWiki search API and page summary endpoints for Marathi and English.
- Factpedia: first checks an optional local JSON index (`factpedia-index.json` or `VITE_FACTPEDIA_INDEX_URL`), then searches the public `shravan-info/factpedia-mr` GitHub repository tree and retrieves matching article files. The JSON index format is an array of objects with `title`, `content` (or `text`), `url`, and optional `language` fields.

## Intelligence architecture
- Marathi, English and mixed-language detection.
- Query normalization, tokenization, stop-word handling and bilingual query expansion.
- A compact trainable MLP neural network for intent classification. This is a real neural classifier for routing, not a generative language model.
- An extensible rule bank with 2,400 weighted bilingual lexical-combination signals.
- Hybrid retrieval, relevance ranking, deduplication, source snippets and citations.
- GLE v1: intent-aware, bilingual, evidence-grounded response generation with sentence selection, deduplication, structured sections, and confidence diagnostics.\n- Safe fallback when source evidence is insufficient; no fabricated facts.

## GLE v3 evidence checks
- Follow-up questions can reuse the last few conversation questions to improve retrieval context.
- Similar passages from different sources are counted as cross-source support signals.
- Possible disagreement flags are heuristic review hints, not proof of factual contradiction.
- The response text remains grounded in retrieved evidence; the engine does not claim human-level reasoning or open-ended LLM generation.

## Important limitation
A 2,400-signal rule bank and a small intent classifier do not equal GPT-3. GPT-level open-ended generation requires a large trained language model. The architecture is ready for a generative model provider to be connected later.
