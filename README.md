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

## Knowledge sources (GLE v5++)
- **Marathi Wikipedia** and **English Wikipedia** are both queried for every question through their MediaWiki Action APIs. The engine searches article titles and text, then retrieves article extracts and language links/metadata from Wikipedia itself.
- **Factpedia** is searched through the optional local JSON index (`factpedia-index.json` or `VITE_FACTPEDIA_INDEX_URL`), with a GitHub repository-tree fallback to retrieve matching article files from `shravan-info/factpedia-mr`.
- No general web search engine is used by the GLE retrieval pipeline.

## GLE v5++ architecture
- Bilingual query expansion for common Marathi-English topic terms.
- Parallel retrieval from Marathi Wikipedia, English Wikipedia and Factpedia.
- Full article extract retrieval rather than relying only on short search-result snippets.
- Subject relevance scoring across article titles and individual sentences.
- Language-aware evidence ranking, deduplication and source-linked passages.
- Retrieval diagnostics show how many pages were found in each source.
- Insufficient-evidence fallback when no relevant passages are found.
- Follow-up question context is preserved by the existing GLE v3 contextual-query helper.
- Existing 2,400 weighted bilingual rule signals and compact intent classifier remain available for routing and retrieval support.

## Generation limitations
GLE v5++ is deterministic, evidence-grounded answer composition. It selects and organizes relevant source sentences and attaches source references. It is **not** a trained generative language model and does not freely translate English passages into Marathi or paraphrase arbitrary facts. When a matching passage is available only in the other language, the answer marks its source language rather than pretending it has translated it. True fluent open-ended generation/translation requires connecting a generative language model.

## Build verification
Run `npm run build` after installing dependencies. A successful GitHub commit or pull request does not itself prove that GitHub Pages has deployed the latest build.
