# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

APA7 Citation Formatter — monorepo with a FastAPI backend (`services/api`) and Next.js 14 frontend (`apps/web`). See `README.md` for architecture details.

### Services

| Service | Directory | Port | Command |
|---------|-----------|------|---------|
| Backend (FastAPI) | `services/api` | 8000 | `source .venv/bin/activate && uvicorn app.main:app --reload --port 8000` |
| Frontend (Next.js) | `apps/web` | 3000 | `pnpm dev` |

The frontend proxies `/api/backend/*` → `http://localhost:8000` via `next.config.mjs` rewrites.

### Running tests / checks

- **Backend tests**: `cd services/api && source .venv/bin/activate && pytest`
- **Frontend lint**: `cd apps/web && pnpm lint`
- **Frontend typecheck**: `cd apps/web && pnpm typecheck`

### Non-obvious caveats

- The backend requires `MINIMAX_API_KEY` in `services/api/.env` for LLM-powered citation extraction/rendering. Without it, the `/v1/render` and `/v1/jobs` endpoints will return a 400 error, but the app still starts and health checks pass.
- Backend tests mock all external API calls (MiniMax, Crossref), so `pytest` passes without any API key configured.
- The `.eslintrc.json` file in `apps/web` must exist for `pnpm lint` to work non-interactively. If missing, `next lint` will prompt interactively.
- Python venv is at `services/api/.venv`. Always activate it before running backend commands.
- SQLite database is auto-created at `services/api/data/apa7.db` on first backend request — no migration step needed.
- `python3.12-venv` system package is required to create the virtualenv (not installed by default on Ubuntu 24.04 minimal).
