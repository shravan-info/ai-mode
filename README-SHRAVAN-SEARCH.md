# Shravan Search
Education-focused website search inside Factpedia AI Mode.

JSON shards: public/data/sites/a.json through z.json. Source list: data/sites-source.json. Generator: scripts/build-site-index.mjs.

Current directory: 47 curated records. The requested 50,000 is a target, not the current count. Add verified real websites; do not invent domains or pad with duplicates. Run node scripts/build-site-index.mjs to rebuild shards.

## GitHub Actions automation

Workflow: `.github/workflows/refresh-search-index.yml`

- Runs every Monday at 02:17 UTC.
- Can also be started manually from the repository's **Actions** tab.
- Rebuilds `a.json` through `z.json` and the manifest from `data/sites-source.json`.
- Validates HTTPS URLs, required metadata, and duplicate domains/names.
- Runs the app production build and commits changed index files to `main`.

The workflow automates index generation, not discovery of 50,000 new sites. New entries must be real, reviewed education websites added to `data/sites-source.json`. The current source directory is still a small starter set; the 50,000 count remains a target.
