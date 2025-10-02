# Dex Arbitrage App

Simple Node.js app that periodically fetches balances and completed trades from a remote service, stores them in a local SQLite database, and serves a small UI plus JSON APIs for charts and dashboards.

## Features

- Polls remote endpoints every 2 minutes using `node-cron`.
- Stores data locally using `better-sqlite3` (single-file DB `data.sqlite`).
- Serves a static UI from `public/` and JSON APIs via Express.
- CORS enabled for easy local development and embedding.
- **Diff Analysis Page:** Provides detailed visualization and analysis of price differences (diffs) between DEX and CEX, including historical data, server token values, and integrated trade profitability.

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

Example requests:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/balances
curl "http://localhost:3000/balances/history?limit=1000"
curl "http://localhost:3000/trades?limit=1000"
```

## Data Model (SQLite)

The database is created automatically on first run. Two tables are used:

1) `balances_history`
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT ISO-8601
- `total_usdt` REAL (nullable)
- `total_coin` REAL (nullable)
- `raw_data` TEXT (JSON of the fetched payload)

2) `completed_trades`
- `id` INTEGER PRIMARY KEY
- `fsmType`, `pair`, `srcExchange`, `dstExchange`, `status`, `user`, `eta`, `props`, `nwId` TEXT (nullable)
- `estimatedProfitNormalized`, `estimatedProfit`, `estimatedGrossProfit`, `estimatedSrcPrice`, `estimatedDstPrice`, `estimatedQty` REAL (nullable)
- `executedProfitNormalized`, `executedProfit`, `executedGrossProfit`, `executedSrcPrice`, `executedDstPrice`, `executedQtySrc`, `executedQtyDst`, `executedFeeTotal`, `executedFeePercent` REAL (nullable)
- `executedTime`, `creationTime`, `openTime`, `lastUpdateTime` INTEGER (nullable)
- `txFee`, `calculatedVolume`, `conveyedVolume`, `commissionPercent` REAL (nullable)
- `hedge` INTEGER (nullable; 1/0)
- `raw_data` TEXT (JSON of the fetched trade object)

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
- ML Analysis:
  - Scatter + Linear Regression, with correlation and RÂ². Points colored by sign of Y. Zoom/pan.
  - Outlier clipping and histogram bin control.
  - Histograms for X and Y and Residuals (Y âˆ’ Å¶) scatter.
  - Correlation Matrix: Select variables, compute Pearson correlations; green positive, red negative.

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
