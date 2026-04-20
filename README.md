# APA7 Citation Formatter

Personal tool that converts uploaded PDF / Word / images (or manually entered
metadata) into APA 7th edition reference entries and in-text citations, powered
by MiniMax (with optional vision) and Crossref.

## Layout

- `apps/web` — Next.js 14 (App Router) + Tailwind + shadcn-style components.
- `services/api` — FastAPI service that handles file ingestion, MiniMax calls,
  Crossref enrichment, and persists jobs in SQLite.

## Quick start

1. Copy `services/api/.env.example` to `services/api/.env` and fill in
   `MINIMAX_API_KEY` (and optional `CROSSREF_MAILTO`).
2. Start the backend:

   ```bash
   cd services/api
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

3. Start the frontend:

   ```bash
   cd apps/web
   pnpm install
   pnpm dev
   ```

The web app proxies `/api/backend/*` to `http://localhost:8000` during
development, so the browser never sees the MiniMax key.

## MVP scope

- Inputs: PDF / DOCX / images (single or **multi-file batch** via
  `POST /v1/jobs/batch`), or the manual metadata form (4 work types:
  journal article, book, book chapter, webpage). Batch jobs run concurrently
  on the API with an upper bound of `MAX_CONCURRENT_JOBS` (default 5) to
  avoid overwhelming MiniMax.
- Literature summaries: `POST /v1/summary` and `POST /v1/summary/batch`
  extract key claims, keywords, and topic tags from a document or pasted
  text. Batch summaries reuse the same concurrency cap as jobs.
- Outputs: APA 7 reference entry + parenthetical + narrative in-text citations.
- Reference library: browser-local (`localStorage`), supports add / edit /
  delete / reorder / copy-all, plus per-project saved summaries that sync
  with the summary page's active project. No downloads in MVP.
- Chinese sources default to fully English APA entries; `title_original` is
  preserved for traceability but the rendered output uses English.
- No URL scraping in MVP.

## Citation style reference

APA 7 formatting rules baked into the rendering prompt follow the official
[APA Style — Reference examples](https://apastyle.apa.org/style-grammar-guidelines/references/examples)
and the *Publication Manual of the American Psychological Association, 7th
Edition*.
