# Repository Guidelines

## Project Structure & Module Organization
- `app.js` drives Express routes, cron jobs, and SQLite access layers.
- UI assets live in `public/` (`index.html`, `contract-analysis.js`, `styles.css`); keep new browser scripts in lowercase-with-dashes.
- Helper utilities belong in `scripts/`; ad hoc diagnostics can live under `tests/` and should be documented before removal.
- SQLite databases (`data-*.sqlite` plus WAL/SHM) remain at the repository root alongside `servers.json` and demo credentials in `users.json`.

## Build, Test, and Development Commands
- `npm install`: syncs dependencies for Node 18 or newer.
- `npm start`: launches the Express server on `http://localhost:3000` and activates cron tasks.
- `npm run db:inspect`: executes `scripts/inspect-db.js` for quick SQLite snapshots.
- `curl http://localhost:3000/health`: verifies the service responds without loading the UI.
- `curl "http://localhost:3000/balances/history?limit=500"`: inspects recorded balance history for regression checks.

## Coding Style & Naming Conventions
- Use 2-space indentation, semicolons, and helpful trailing commas in JavaScript.
- Prefer `camelCase` identifiers; keep filenames under `public/` in `lowercase-with-dashes.js`.
- Match existing HTML and CSS formatting; avoid sweeping whitespace reflows.
- Keep comments concise and only when intent is non-obvious; trust self-documenting code first.

## Testing Guidelines
- No formal framework yet; validate via `npm start` and interact with the UI or REST endpoints.
- Capture sample API runs with `curl` and stash temporary scripts in `tests/` when deeper checks are needed.
- Confirm database schema changes are reversible before committing; snapshot affected tables with `npm run db:inspect`.
- Document manual test steps in pull requests so reviewers can reproduce quickly.

## Commit & Pull Request Guidelines
- Follow short Conventional Commit messages, for example `fix: align contract summary headers`.
- Summarize intent, link relevant issues, and list verification steps such as `npm start` or curl probes.
- Attach screenshots for UI changes and flag database or environment updates early.
- Ensure pull requests highlight any new configuration knobs or cron dependencies.

## Security & Configuration Tips
- Do not commit real secrets; keep using placeholder credentials in `users.json`.
- Configure remote sources via environment variables like `BALANCES_URL`, `TRADES_URL`, `DB_PATH`, `PORT`, `ETHERSCAN_API_KEY`, and `ETHERSCAN_API_URL`.
- Avoid re-committing large SQLite files unless schema evolution requires it; prefer migrations or scripts.
- Review cron tasks in `app.js` when adding network calls to ensure they respect rate and error handling limits.
