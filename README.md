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
- Factpedia: local JSON index retrieval. Deploy a `factpedia-index.json` file at the app root, or configure `VITE_FACTPEDIA_INDEX_URL`. Accepted shape: an array of objects with `title`, `content` (or `text`), `url`, and optional `language` fields.
- If the Factpedia index is not present, the interface reports that honestly rather than claiming it searched Factpedia.

## Intelligence architecture
- Marathi, English and mixed-language detection.
- Query normalization, tokenization, stop-word handling and bilingual query expansion.
- A compact trainable MLP neural network for intent classification. This is a real neural classifier for routing, not a generative language model.
- An extensible rule bank with 2,400 weighted bilingual lexical-combination signals.
- Hybrid retrieval, relevance ranking, deduplication, source snippets and citations.
- Evidence-based extractive answer synthesis.

## Important limitation
A 2,400-signal rule bank and a small intent classifier do not equal GPT-3. GPT-level open-ended generation requires a large trained language model. The architecture is ready for a generative model provider to be connected later.
