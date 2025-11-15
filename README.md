# Dex Arbitrage App

Simple Node.js app that periodically fetches balances and completed trades from a remote service, stores them in a local SQLite database, and serves a small UI plus JSON APIs for charts and dashboards.

## Features

- Polls remote endpoints every 2 minutes using `node-cron`.
- Stores data locally using `better-sqlite3` (single-file DB `data.sqlite`).
- Serves a static UI from `public/` and JSON APIs via Express.
- CORS enabled for easy local development and embedding.
- **Diff Analysis Page:** Provides detailed visualization and analysis of price differences (diffs) between DEX and CEX, including historical data, server token values, and integrated trade profitability.
- **Reports & Analytics Page:** `/reports.html` offers KPI cards, equity curves, trade quality histograms, and a paginated ledger with CSV/export tooling over completed trades + balances, now filterable by normalized trade props (Token, Exec, Dex, Diff, DexSlip, CexSlip, LHdelta) and using the same net-profit math as the dashboard’s Completed Trades table (dest-value minus src-cost minus 20 bps slip).

 - Notification system with Telegram, Slack, and Email providers, including configurable rules, digests, and a notifications dashboard.
## Prerequisites

- Node.js 18+ (Node 20 LTS recommended)
- npm

Windows note about `better-sqlite3` with Node 22:
- If `npm install` fails compiling `better-sqlite3` on Node 22, either:
  - Install MSVC build tools: Visual Studio 2022 Build Tools with â€œDesktop development with C++â€, then rerun `npm install`, or
  - Use Node 20 LTS via nvm-windows (recommended for simplicity).

## Quick Start

```bash
# From the project root
npm install
npm start
```

You should see:

```
Server listening on http://localhost:3000
```

Open the UI at http://localhost:3000 and use the JSON endpoints below.

## Configuration

- `PORT` (optional): HTTP port (default `3000`).
- `DB_PATH` (optional): path to the SQLite file (default `./data.sqlite`).
- `BALANCES_URL` (optional): remote balances endpoint. If empty, the balances fetcher is disabled.
- `TRADES_URL` (optional): remote completed trades endpoint. If empty, the trades fetcher is disabled.
- `ETHERSCAN_API_KEY` (optional but recommended): unified Etherscan V2 API key used by the contract analysis view when a server is configured with a `chainId`.
- `ETHERSCAN_API_URL` (optional): override for the unified API base (default `https://api.etherscan.io/v2`).
- `NLSQL_DB_PATH` (optional): path to the database that backs `/nlsql` (defaults to `./data.sqlite`).
- `NLSQL_TIMEOUT_MS` (optional): how long the natural-language queries can run before timing out (default `10000` ms, enter in milliseconds).
- `NLSQL_MAX_ROWS` (optional): cap for returned rows (default `5000`).
- `OLLAMA_HOST` (optional): URL for the local Ollama server (`http://127.0.0.1:11434` by default). Ensure `sqlcoder:7b` and `qwen2.5:3b-instruct` are pulled locally and use `OLLAMA_MAX_LOADED_MODELS=1` / `OLLAMA_NUM_PARALLEL=1`.

To point the app at different sources, set environment variables before starting the app.

Examples (PowerShell):

```powershell
$env:BALANCES_URL = 'http://195.201.178.120:3001/balance'
$env:TRADES_URL   = 'http://your-host:3001/completed'
npm start
```

If the balances endpoint is not available yet or returns 404, you can disable it:

```powershell
Remove-Item Env:BALANCES_URL  # or: $env:BALANCES_URL = ''
npm start
```

## Notifications

- Configure per-server providers (Telegram bot + chat, Slack webhook, SMTP email) from the Servers admin page or directly in `servers.json`.
- Notification rules support thresholds and cooldowns (`notificationRules` in `servers.json`). Defaults include profit alerts, low gas alerts, poll failure alerts, daily digests, and hourly digests.
- A new `/notifications/recent` API exposes the delivery log, and `/notifications.html` renders a table with status, channel, and details.
- Daily digest (default 09:00) summarises 24h net profit, success rate, fees, top pairs, and low-gas counts. Hourly digest (default at minute 5) highlights recent token activity and gas warnings.
- Digests honour the configured channels (email/slack) and respect cooldowns/unique keys to avoid duplicates.
### Contract Analysis Setup

- Add a `chainId` property to any entry in `servers.json` (or through the Servers admin page) to identify the target EVM chain.
- When a `chainId` is present and an API key is available (`explorerApiKey` on the server or the global `ETHERSCAN_API_KEY`), the app calls the unified Etherscan V2 endpoint.
- If no `chainId` is provided, the server will continue using the legacy per-chain explorer base URL (`explorerApiBase`).

## API Endpoints

- `GET /health`: Basic liveness check.
- `GET /balances`: Latest balance snapshot. Returns `{ timestamp, total_usdt, total_coin }`.
- `GET /balances/history?limit=500`:
  - Returns an array of balance snapshots ordered oldest â†’ newest.
  - `limit` defaults to 500, min 1, max 5000.
- `GET /trades/history?token={tokenName}&startTime={timestamp}&endTime={timestamp}`:
  - Returns trade history for a specific token within a given time range.
  - `tokenName` is required.
  - `startTime` and `endTime` are optional timestamps (milliseconds) to filter trades.
  - Returns an array of `{ lastUpdateTime, netProfit }`.
- Static UI: files under `public/` are served at `/`.

### Reporting APIs

The `/reports.html` page consumes the following filter-aware endpoints:

- `GET /api/reports/options`: distinct pairs/exchanges/statuses/networks for populating filter controls.
- `POST /api/reports/summary`: accepts `timeRange`, `pairs`, `srcExchanges`, `dstExchanges`, `statuses`, `nwIds`, `fsmTypes`, `hedgeMode`, `thresholds` (`minNotional`, `minAbsPnl`) and returns KPI metrics and histogram data. Net PnL is recomputed per trade as `(executedQtyDst * executedDstPrice) - (executedQtySrc * executedSrcPrice) - (0.0002 * executedQtyDst * executedDstPrice)` so the KPIs match the main dashboard.
- Every endpoint also accepts `propsFilters` to slice by normalized trade props (`tokens`, `execs`, `dexes`, plus numeric min/max for `diff`, `dexSlip`, `cexSlip`, `lhDelta`).
- `POST /api/reports/equity`: same filter payload, returns `{ balancesCurve, tradeCurve }` for the two equity charts.
- `POST /api/reports/breakdown`: adds optional `pairLimit` (default 50, capped at 500) and returns aggregated stats (trades, win rate, total/avg net PnL, notional volume) per pair; pass `format: 'csv'` to download the full pair list as a CSV export.
- `POST /api/reports/time`: same filters, returns `{ dayOfWeek, hourOfDay, daily }` arrays plus totals so the UI can visualize day/time performance patterns.
- `POST /api/reports/trades`: same filters plus `page`, `pageSize`, optional `format: 'csv'` for exports, returning paginated trade rows with derived net PnL, notional, and returns.

Example requests:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/balances
curl "http://localhost:3000/balances/history?limit=1000"
curl "http://localhost:3000/trades?limit=1000"
```

## Data Model (SQLite)

The database is created automatically on first run and grows as the cron jobs populate the different data streams (balances, trades, diffs, liquidity, and gas metrics). Tables are added in `app.js` under `ensureDb` and the scheduler inserts or updates these rows whenever polls run.

1) `balances_history`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT NOT NULL (ISO-8601)
- `total_usdt` REAL (nullable)
- `total_coin` REAL (nullable)
- `raw_data` TEXT (JSON of the fetched balances payload)
- Stores the latest snapshot per poll, powering `/balances`, `/balances/history`, and the dashboard balance cards.

  Column notes:
  - `total_usdt`: aggregate USDT value reported by the fetcher.
  - `total_coin`: total of non-USDT assets when available.
  - `raw_data`: raw payload used to recompute derived UI metrics.

2) `completed_trades`
- `id` INTEGER PRIMARY KEY
- `fsmType`, `pair`, `srcExchange`, `dstExchange`, `status`, `user`, `eta`, `props`, `nwId` TEXT (nullable)
- `estimatedProfitNormalized`, `estimatedProfit`, `estimatedGrossProfit`, `estimatedSrcPrice`, `estimatedDstPrice`, `estimatedQty` REAL (nullable)
- `executedProfitNormalized`, `executedProfit`, `executedGrossProfit`, `executedSrcPrice`, `executedDstPrice`, `executedQtySrc`, `executedQtyDst`, `executedFeeTotal`, `executedFeePercent` REAL (nullable)
- `executedTime`, `creationTime`, `openTime`, `lastUpdateTime` INTEGER (nullable)
- `txFee`, `calculatedVolume`, `conveyedVolume`, `commissionPercent` REAL (nullable)
- `hedge` INTEGER (nullable; 1/0)
- `raw_data` TEXT (JSON of the fetched trade object)
- New rows are inserted per completed trade poll and feed the hourly/daily digests plus `/trades/history`.

  Column notes:
  - `props`: JSON-like metadata (Dex/Diff tags, slippage info) to reconstruct the UI columns.
  - `nwId`: network identifier if the trade ran on a non-default chain.
  - `hedge`: `1` when trade is hedging, `0` otherwise.

3) `server_tokens`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT NOT NULL
- `name` TEXT NOT NULL
- `buy`, `sell` REAL (nullable)
- Tracks the last known server-level token buy/sell values to enrich diff data and to back the `/status` view.

  Column notes:
  - `buy`/`sell`: prices used as CEX proxies when diff history does not provide them.

4) `diff_history`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `curId` TEXT NOT NULL
- `ts` INTEGER NOT NULL
- `buyDiffBps`, `sellDiffBps` INTEGER (nullable)
- `cexVol`, `serverBuy`, `serverSell`, `dexVolume` REAL (nullable)
- `rejectReason` TEXT (nullable)
- `UNIQUE(curId, ts)` ensures the latest sample per timestamp overrides older data, and the retention logic keeps ~7 days (`maybePruneDiffHistory` in `app.js`).

  Column notes:
  - `curId`: token identifier used on the diff dataset.
  - `ts`: Unix timestamp (ms) for the diff snapshot.
  - `cexVol`: CEX-reported volume tied to `curId`.
  - `serverBuy`/`serverSell`: fallback from `server_tokens` when diffs lack CEX prices.

5) `contract_transactions`
- `hash` TEXT NOT NULL
- `serverId` TEXT NOT NULL
- `timestamp` INTEGER NOT NULL
- `isError` INTEGER NOT NULL
- `reason` TEXT (nullable)
- `ethPrice`, `polPrice`, `bnbPrice` REAL (nullable)
- `raw_data` TEXT
- Deduplicated by `(serverId, hash)`, this table is populated at `/contracts` poll time and surfaces explorer visibility plus success-rate metrics.

  Column notes:
  - `isError`: `1` when the transaction reverted or failed.
  - `reason`: human-friendly failure description or `null` when the tx succeeded.

6) `liquidity_data`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT NOT NULL
- `symbol` TEXT NOT NULL (lowercase token key without USDT)
- `price` REAL NOT NULL
- `liquidity` REAL NOT NULL
- `cumulative_volume` REAL (nullable)
- Updated by `fetchLiquidityData`, which sums two 1-minute Binance candles for each `symbol` before inserting or updating the latest row for that token.

  Column notes:
  - `liquidity`: combined USDT volume from two recent minute candles.
  - `cumulative_volume`: optional running total (currently unused in the UI).

7) `gas_balances`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT NOT NULL
- `contract` TEXT NOT NULL
- `gas` REAL (nullable)
- `is_low` INTEGER (boolean flag)
- Captures per-contract gas snapshots from status feeds and raises low-gas notifications when the value dips below the configured thresholds.

  Column notes:
  - `is_low`: `1` means the value triggered the notifier’s threshold (default 2).

8) `gas_balance_tracking`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT NOT NULL
- `contract` TEXT NOT NULL
- `gas_balance` REAL (nullable)
- `gas_deposit` REAL DEFAULT 0
- `source` TEXT NOT NULL DEFAULT `'auto'`
- `note` TEXT (nullable)
- Used both by the automated polling (sums into a `__total__` tracker) and by `/gas-balance/deposit` so the UI can show historical balance and deposit lines.

  Column notes:
  - `gas_deposit`: logged deposit amounts (auto totals use `0`).
  - `source`: `auto`/`auto-total` for polls, `manual` for API-driven deposits.

9) Notification & helper tables (`notification_state`, `notifications_log`, etc.) support digest delivery metadata and are created alongside the other schema definitions.

10) `odata_dictionary`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `kind` TEXT NOT NULL (`table`, `column`, `example`)
- `ref` TEXT
- `text` TEXT NOT NULL
- Populated once per DB with table/column descriptions plus ~12 question/SQL examples (`kind='example'`) so the Ollama prompts understand the schema and time windows.
- Used every time `/api/nlsql/ask` builds a prompt (`schema & dictionary` block) to keep the LLM grounded in the current schema.

The cron scheduler still runs every two minutes (`*/2 * * * *`) and continues to insert balances, trades, diff points, liquidity metrics, and gas tracking rows as described above.
## Scheduler

- Cron expression: `*/2 * * * *` (runs every 2 minutes)
- Tasks:
  - Fetch balances â†’ compute totals â†’ insert into `balances_history`.
  - Fetch completed trades â†’ insert or ignore (by primary key) into `completed_trades`.

Logs will indicate stored balance totals and how many new trades were inserted.

## Troubleshooting

- `Error: Cannot find module 'express'` â†’ run `npm install` in the project root.
- `better-sqlite3` build errors on Windows with Node 22:
  - Option A: Install Visual Studio 2022 Build Tools with C++ workload, then `npm install`.
  - Option B: Switch to Node 20 LTS (e.g., via nvm-windows), then `npm install`.
- Port in use: set a different port, e.g. `PORT=4000 npm start` (PowerShell: `$env:PORT=4000; npm start`).
- No data showing: ensure the remote endpoints are reachable from your machine; check logs for fetch errors.

## Development Notes

- Static frontend lives in `public/` (`index.html`, `styles.css`, `script.js`).
- Server code: `app.js` (Express + cron + SQLite).
- Keep requests light; default timeouts are 15s for balances and 20s for trades.

## Scripts

- `npm start` â€“ run the server (`node app.js`).
- `npm run nlsql:test` â€“ run the natural language SQL sanitizer smoke tests.

---

If you want environment-variable driven configuration for the remote URLs or DB path, open an issue or update `app.js` to read from `process.env` and I can help wire it up.

## Feature Guide (Quick Reference)

This is a condensed guide to the inâ€‘app documentation available at `/docs.html`.

- Total USDT Balance Over Time: Combined DEX (usdtVal + coinVal) + BinanceF (USDT + sum of unrealized PnL). Zoom with wheel/drag, pan with Ctrl + drag. Reset using the header button.
- DEX Exchange Balances: Perâ€‘exchange totals and token rows (filtered to `totalUsdt > 0.1`). Use search and column sorting.
- BinanceF Balances: Token USDT value = `(entryPrice Ã— total)/leverage + unrealizedProfit`. USDT total = wallet USDT + sum of unrealized PnL.
- Completed Trades: Shows `executedGrossProfit` (green/red), `Quantity = executedSrcPrice Ã— executedQtySrc`, timestamps, parsed `props` (`Dex`, `Diff`, `DexSlip`, `CexSlip`). Sort/search supported.
- Pair Analysis:
  - Bar Chart: Total Gross Profit by Pair (top 20).
  - Win Rate (Top Winners) and Total Loss (Top Losers): Charts to spot consistent winners and risky pairs.
  - Pair Feature Differences (Wins vs Losses): All pairs with trades count, total profit (colored), and averages of `Diff`, `DexSlip`, `CexSlip` for wins and losses, plus overall CexSlip average. Sort/search.
- Pair Deep Dive:
  - Cumulative Gross Profit over time (loads fully zoomed out).
  - Gross Profit Distribution histogram.
  - Scatter: chosen X vs gross profit.
## Diff Analysis Page Enhancements

-   **Pagination:** Implemented pagination for the "Diff Analysis" chart and table, allowing data to be loaded in chunks of 5000 entries. A "Load More" button was added to fetch additional data.
-   **Trade Data Integration:** Integrated trade data from the "Completed Trades" table into the "Diff Analysis" chart. Trades are displayed as scatter points, with their time and net profit.
-   **Dynamic Trade Filtering:** Trade data is now dynamically loaded based on the visible time range of the diff data, ensuring that only relevant trades are displayed.
-   **Trade Data Accuracy:** Corrected the timestamp used for trade data (`lastUpdateTime` instead of `executedTime`) and ensured that "Net Profit" values are accurately calculated and displayed.
-   **Visual Enhancements:**
    *   "Trades (Net Profit)" are now colored neon green for positive profits and neon red for negative profits.
    *   "Buy Diff" line color changed to blue.
-   **Button Styling:** "Reset Zoom" and "Load More" buttons now share the same style as the "Refresh" button on the main dashboard (dark orange with neon effect).

Open `/docs.html` in the app for deeper explanations with examples.


