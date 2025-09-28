# Repository Guidelines

## Project Structure & Module Organization
- Backend: `app.js` (Express API, cron jobs, SQLite access via `better-sqlite3`).
- Frontend: static files under `public/` (e.g., `index.html`, `styles.css`, `script.js`, analysis pages like `pair-analysis.html/js`).
- Scripts: utility tasks in `scripts/` (e.g., `scripts/inspect-db.js`).
- Data: SQLite files at repo root (e.g., `data.sqlite`, `data-*.sqlite`), plus WAL/SHM.
- Config/runtime: `servers.json` (auto-created/updated), `users.json` (demo-only auth), `package.json`.

## Build, Test, and Development Commands
- `npm start` — run the server locally on `http://localhost:3000`.
- `npm run db:inspect` — print quick DB stats and recent records.
- Examples:
  - `curl http://localhost:3000/health`
  - `curl "http://localhost:3000/balances/history?limit=500"`

Env vars (PowerShell examples):
- `$env:PORT=4000; npm start`
- `$env:DB_PATH="D:\\tmp\\dex.sqlite"; npm start`

## Coding Style & Naming Conventions
- JavaScript (Node 18+). Use 2-space indentation and semicolons; prefer `camelCase` for variables/functions.
- File names: backend `lowercase-with-dashes.js`; frontend assets in `public/` mirror page names (e.g., `token-analysis.html/js`).
- No linter configured. Keep changes consistent with existing code style; optional Prettier (2 spaces) is welcome but do not reformat unrelated files.

## Testing Guidelines
- No formal test framework yet. Use:
  - Runtime checks via curl/browser against local server.
  - `npm run db:inspect` to validate tables, counts, and latest snapshots.
- If adding tests, create `tests/` with lightweight Node scripts or Jest; prefer fast, deterministic checks around parsing, analytics, and SQL queries.

## Commit & Pull Request Guidelines
- Git history shows brief `fix:` messages (e.g., `fix:18`). Prefer Conventional Commits: `feat:`, `fix:`, `chore:`, with an imperative subject.
- PRs must include: purpose/summary, linked issues, testing steps (commands/curls), screenshots for UI changes, and notes for DB/schema or env var changes.

## Security & Configuration Tips
- Do not commit secrets. `users.json` is demo-only and insecure; replace with proper auth if needed.
- Large `*.sqlite` files and their `-wal/-shm` companions can bloat PRs; avoid committing regenerated data unless required.
- Configure sources via env vars: `BALANCES_URL`, `TRADES_URL`, `DB_PATH`, `PORT`.

## API Endpoints & Route Naming
- Naming: lowercase nouns, hyphenated segments; collections plural. Analytics live under `/trades/analytics/*`, diagnostics under `/analysis/*`, health/status under `/health` and `/status/*`.
- Common query: most endpoints accept `serverId` to select the active SQLite (e.g., `?serverId=bnb`).
- GET
  - `/balances` — latest snapshot.
  - `/balances/history?limit=500&before_timestamp=ISO` — time series (oldest→newest).
  - `/balances/exchanges` — per-exchange (DEX vs BinanceF) breakdown.
  - `/trades?limit=1000&pair=SYMBOL` — recent trades.
  - `/trades/pairs` — distinct pairs.
  - `/trades/analytics/pairs?limit=5000` — per-pair KPIs.
  - `/trades/analytics/tokens?limit=5000` — per-token KPIs.
  - `/analysis/server-tokens` — combine latest buy/sell with net profit by token.
  - `/analysis/token-time-patterns?token=eth&targetDate=YYYY-MM-DD` — intra-day/week patterns.
  - `/analysis/token-time-series?token=eth` — time series by token.
  - `/servers` and `/servers/active` — multi-server config.
  - `/status/summary`, `/status/server` — server diagnostics.
  - `/health` — liveness.
- POST
  - `/servers` — persist server config; `/servers/:id/select` — set active server.
  - `/login` — demo-only cookie auth (do not use in production).
