# Repository Guidelines

## Project Structure & Module Organization
- `app.js` is the Node/Express entry point; most runtime logic (fetchers, notification services, HTTP APIs) lives in the root alongside helper scripts (`fetch-worker.js`, `notifier.js`, etc.).
- `public/` hosts the dashboard assets that the server renders at `/`.
- `scripts/` collects maintenance helpers (`inspect-db.js`, unused fixers, etc.), while `ml_service/`, `ml_pipeline/`, and `models/` power the optional machine-learning features and shared data schemas.
- SQLite files (`data*.sqlite`) and `servers.json` stay in the repo root to keep configuration, history, and notification rules close to the running app.
- Static exports live in `data_exports/`, and additional tooling (e.g., `compress.js`) is rooted alongside other one-off utilities so contributors know to look here before introducing new submodules.

## Build, Test, and Development Commands
- `npm install`: restores dependencies defined in `package.json`; run before any other npm command, especially on a fresh checkout.
- `npm start`: boots `app.js`, listens on `PORT` (default 3000), and serves both APIs and the static UI.
- `npm run lint`: enforces the ESLint/Prettier stack; fix violations automatically via `--fix`, then rerun before committing.
- `npm run db:inspect`: inspects the SQLite schema and data through `scripts/inspect-db.js` when you need to understand persistence without launching the full app.
- `npm run ml:service`: runs `uvicorn` on `ml_service.main` for contributors iterating on the ML APIs without touching Node.

## Coding Style & Naming Conventions
- Project uses ES modules (`"type": "module"`) and modern JavaScript syntax; match existing style with `const`/`let`, async/await, and short helper modules.
- Use two-space indentation to stay consistent with the surrounding files and keep statements on single lines unless readability demands otherwise.
- Run `npm run lint` (and optionally Prettier) to keep formatting, semicolons, and import ordering in sync; the ESLint config extends `eslint-config-prettier`, so rely on that for spacing decisions.
- Name new scripts in `scripts/` or `ml_service/` with lowercase-hyphen or camelCase depending on their runtime: `fetch-worker.js`, `ml_service/main.py`, etc.

## Testing Guidelines
- There is no automated test suite yet; verify changes manually by running the server (`npm start`) and hitting key endpoints (`/health`, `/balances`), or using `curl`/Postman as documented in `README.md`.
- When working on the ML side, exercise `ml_service` by starting `npm run ml:service` and curling `http://localhost:8100` endpoints that mimic production inputs.
- Document any manual verification steps you followed in your PR description to keep reviewers informed.

## Commit & Pull Request Guidelines
- Commit messages are concise, present-tense phrases that describe the work (e.g., “dropdown changes” in the recent history); continue this pattern by starting with a verb and keeping the scope tight.
- PRs should include a short summary, mention any related issue or ticket, and note UI changes with screenshots or link to the dashboard where appropriate.
- Highlight any required environment variables or database seeds in the PR body so reviewers can reproduce the behavior locally.

## Configuration Notes
- Use the `.env`/PowerShell examples in `README.md` to set `PORT`, `DB_PATH`, `BALANCES_URL`, `TRADES_URL`, and explorer keys before launching; missing URLs gracefully disable the corresponding fetchers.
- Keep sensitive data out of the repo (e.g., Telegram tokens or SMTP credentials); use `servers.json` stubs for samples and document real values outside version control.
