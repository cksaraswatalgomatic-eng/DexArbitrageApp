# Repository Guidelines

## Project Structure & Module Organization
Backend logic lives in `app.js`, wiring Express routes, cron jobs, and SQLite access. Frontend assets stay under `public/` (`index.html`, `contract-analysis.js`, `styles.css`), while helper scripts sit in `scripts/`. SQLite databases (`data-*.sqlite` plus WAL/SHM) remain at the repo root, and runtime config is tracked in `servers.json` with demo credentials in `users.json`. Keep new modules aligned with this layout so onboarding remains predictable.

## Build, Test, and Development Commands
Run `npm install` to sync Node 18+ dependencies. Use `npm start` to launch the Express server on `http://localhost:3000`, enabling cron jobs and the web UI. For quick diagnostics, `npm run db:inspect` executes `scripts/inspect-db.js`. Health-check the service with `curl http://localhost:3000/health` or pull historical balances via `curl "http://localhost:3000/balances/history?limit=500"`.

## Coding Style & Naming Conventions
JavaScript uses 2-space indentation, semicolons, and trailing commas when helpful. Prefer `camelCase` for variables and functions, and keep files under `public/` in `lowercase-with-dashes.js`. Match existing HTML and CSS formatting; avoid sweeping reflows. Add concise comments only where intent is non-obvious.

## Testing Guidelines
No formal framework exists yet. Validate features by running `npm start` locally and exercising endpoints or UI flows. When deeper coverage is needed, add temporary Node scripts (for example in `tests/`) and document sample inputs. Ensure schema tweaks are reversible before committing.

## Commit & Pull Request Guidelines
Follow short Conventional Commit messages such as `fix: align contract summary headers`. Pull requests should note the change intent, link relevant issues, list verification steps (`npm start`, `curl ...`), and include screenshots for UI updates. Flag database or environment changes so reviewers can update their setups promptly.

## Security & Configuration Tips
Never commit real secrets; `users.json` holds placeholders. Large SQLite files balloon diffs, so avoid re-committing them unless schema evolution demands it. Configure remote sources via environment variables like `BALANCES_URL`, `TRADES_URL`, `DB_PATH`, `PORT`, `ETHERSCAN_API_KEY`, and `ETHERSCAN_API_URL`.
