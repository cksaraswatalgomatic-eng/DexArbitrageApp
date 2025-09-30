# Repository Guidelines

## Project Structure & Module Organization
- Backend logic lives in `app.js`, wiring Express routes, cron jobs, and SQLite access.
- Frontend assets are under `public/` (e.g., `index.html`, `contract-analysis.js`, `styles.css`).
- Utility scripts for inspection live in `scripts/` (for example, `scripts/inspect-db.js`).
- SQLite data files (`data-*.sqlite` plus WAL/SHM) sit at the repository root.
- Runtime configuration persists in `servers.json`; demo credentials are in `users.json`.

## Build, Test, and Development Commands
- `npm install` — install dependencies for Node 18+.
- `npm start` — run the Express server on `http://localhost:3000` with cron jobs active.
- `npm run db:inspect` — print recent SQLite stats via `scripts/inspect-db.js`.
- Quick checks: `curl http://localhost:3000/health` or `curl "http://localhost:3000/balances/history?limit=500"`.

## Coding Style & Naming Conventions
- JavaScript code uses 2-space indentation, semicolons, and trailing commas where sensible.
- Prefer `camelCase` for variables and functions; keep filenames in `public/` as `lowercase-with-dashes.js`.
- Match existing HTML/JS formatting; avoid wholesale reformatting unrelated sections.

## Testing Guidelines
- No formal framework yet; validate changes by exercising endpoints locally.
- Use browser tools or `curl` to confirm analytics output and new API responses.
- For complex logic, add ad hoc Node scripts (e.g., under a `tests/` folder) and document sample inputs.
- Ensure schema or data migrations are reversible before committing.

## Commit & Pull Request Guidelines
- Follow short Conventional Commit messages (`feat:`, `fix:`, `chore:`); example: `fix: align contract summary headers`.
- Pull requests should explain the change, link issues where relevant, list verification steps (`npm start`, `curl …`), and include screenshots for UI updates.
- Call out database or environment variable changes so reviewers can update local setups.

## Security & Configuration Tips
- Never commit real secrets; `users.json` is placeholder data only.
- Large SQLite files inflate diffs; avoid re-committing unless schema updates require it.
- Configure remote sources via env vars: `BALANCES_URL`, `TRADES_URL`, `DB_PATH`, `PORT`, `ETHERSCAN_API_KEY`, `ETHERSCAN_API_URL`.
