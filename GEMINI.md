# GEMINI.md

## Project Overview

This is a Node.js application designed for cryptocurrency arbitrage analysis. It periodically fetches balance, trade, and status data from remote DEX/CEX endpoints, stores the information in a local SQLite database, and serves a web-based user interface for data visualization and analysis.

The application is built with:
-   **Backend:** Node.js and Express.js for the web server and API endpoints.
-   **Database:** `better-sqlite3` for storing time-series data of balances, trades, and other metrics.
-   **Task Scheduling:** `node-cron` is used to fetch data from the remote services every two minutes.
-   **HTTP Client:** `axios` is used to perform HTTP requests to the remote data sources.
-   **Frontend:** The UI is composed of static HTML, JavaScript, and CSS files located in the `public` directory. It includes several pages for different types of analysis.
-   **Machine Learning:** Python scripts (`train.py`, `predict.py`) are integrated for predictive analysis.

The application supports multiple server configurations, which are managed through the `servers.json` file, allowing it to connect to different data sources for BNB, Arbitrum, and Base networks.

## Key Components
1. **Data Fetching**: Periodic fetching of balances and trades from remote endpoints
2. **Data Storage**: SQLite databases with separate files per server
3. **Data Processing**: Calculation of totals and normalization of trade properties
4. **API Layer**: RESTful endpoints for data access
5. **Frontend**: Interactive dashboard with charts and tables

## Features

### Main Dashboard (`index.html`)

-   **Server Status:** Displays real-time information about the connected server, including uptime, `Mindiff`, `MaxOrderSize`, and token-specific parameters. It also shows profit and trade statistics for various time windows (1h, 4h, 8h, 12h, 24h).
-   **DEX vs CEX Comparison:** A table that compares the "Total USDT" values of matching tokens between DEX and CEX exchanges.
-   **Completed Trades:** A table of recent completed trades with details like "% Profit", "Net Profit", and other relevant information.
-   **DEX and CEX Balances:** Tables showing the token balances on DEX and CEX exchanges.

### Diff Analysis Page (`diff-analysis.html`)

-   **Time Series Charts:** Visualizes the history of "Total USDT Balance" and "Trading Volume".
-   **Profitability Analysis:** Provides insights into the profitability of trades.
-   **Pagination:** Implemented pagination for the "Diff Analysis" chart and table, allowing data to be loaded in chunks of 5000 entries. A "Load More" button was added to fetch additional data.
-   **Trade Data Integration:** Integrated trade data from the "Completed Trades" table into the "Diff Analysis" chart. Trades are displayed as scatter points, with their time and net profit.
-   **Dynamic Trade Filtering:** Trade data is now dynamically loaded based on the visible time range of the diff data, ensuring that only relevant trades are displayed.
-   **Trade Data Accuracy:** Corrected the timestamp used for trade data (`lastUpdateTime` instead of `executedTime`) and ensured that "Net Profit" values are accurately calculated and displayed.
-   **Visual Enhancements:**
    *   "Trades (Net Profit)" are now colored neon green for positive profits and neon red for negative profits.
    *   "Buy Diff" line color changed to blue.
-   **Button Styling:** "Reset Zoom" and "Load More" buttons now share the same style as the "Refresh" button on the main dashboard (dark orange with neon effect).

### Pair Analysis Page (`pair-analysis.html`)

-   **Individual Pair Profitability Analysis:** Provides a detailed breakdown of profitability for a selected pair based on its attributes, including `Diff`, `DexSlip`, `CexSlip`, and execution type.
-   **Top Winners and Losers:** Lists the most and least profitable pairs.

### Token Analysis Page (`token-analysis.html`)

-   **Token-level Analytics:** Aggregates and displays trade statistics (wins, losses, net profit) for each token.
-   **Time-based Patterns:** Shows profitability patterns for a selected token by hour of the day and day of the week.
-   **Time Series Data:** Displays a time series of net profit, average buy price, and average sell price for a selected token.

### Contract Analysis Page (`contract-analysis.html`)

-   **Transaction Monitoring:** Fetches and displays recent transactions for a configured smart contract.
-   **Failure Analysis:** Identifies failed transactions and attempts to determine the reason for failure by scraping the block explorer.
-   **Success/Failure Rates:** Shows transaction success and failure rates over various time periods.

### ML Analysis Page (`ml-analysis.html`)

-   **Trade Prediction:** Uses a trained machine learning model to predict the outcome of trades based on various features.
-   **Model Training:** Provides an interface to trigger the training of the machine learning model.

### Other Pages

-   **Login (`login.html`):** A simple login page for authentication.
-   **Servers (`servers.html`):** A page for managing server configurations (adding, editing, deleting servers).
-   **Docs (`docs.html`):** Documentation page.
-   **Pair Deep Dive (`pair-deep.html`):** A more detailed analysis page for individual pairs.

## Authentication

The application includes a basic authentication mechanism with a login page. User credentials are stored in `users.json`. **This implementation is insecure (stores passwords in plain text) and should not be used in a production environment.**

## Building and Running

To get the application running, follow these steps:

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Run the Application:**
    ```bash
    npm start
    ```
The server will start on `http://localhost:3000` by default.

## Configuration

- `PORT` (optional): HTTP port (default `3000`).
- `DB_PATH` (optional): path to the SQLite file (default `./data.sqlite`).
- `BALANCES_URL` (optional): remote balances endpoint. If empty, the balances fetcher is disabled.
- `TRADES_URL` (optional): remote completed trades endpoint. If empty, the trades fetcher is disabled.
- `ETHERSCAN_API_KEY` (optional but recommended): unified Etherscan V2 API key used by the contract analysis view when a server is configured with a `chainId`.
- `ETHERSCAN_API_URL` (optional): override for the unified API base (default `https://api.etherscan.io/v2`).

To point the app at different sources, set environment variables before starting the app.

### Contract Analysis Setup

- Add a `chainId` property to any entry in `servers.json` (or through the Servers admin page) to identify the target EVM chain.
- When a `chainId` is present and an API key is available (`explorerApiKey` on the server or the global `ETHERSCAN_API_KEY`), the app calls the unified Etherscan V2 endpoint.
- If no `chainId` is provided, the server will continue using the legacy per-chain explorer base URL (`explorerApiBase`).

## Multi-Server Support

The application supports multiple servers through `servers.json`:
- Each server has its own database file (`data-{serverId}.sqlite`)
- Active server can be switched via API or UI
- Default servers: BNB, Arbitrum, Base

## API Endpoints

### Health and Status
- `GET /health`: Basic liveness check
- `GET /status/summary`: Server status summary
- `GET /status/server`: Detailed server status with profit/trade stats

### Data Endpoints
- `GET /balances`: Latest balance snapshot
- `GET /balances/history`: Historical balance data (supports limit and before_timestamp)
- `GET /balances/exchanges`: Detailed per-exchange balances
- `GET /trades`: Completed trades list
- `GET /trades/pairs`: Distinct trade pairs
- `GET /trades/analytics/pairs`: Aggregated analytics per pair

### Server Configuration
- `GET /servers`: List all servers
- `GET /servers/active`: Get active server
- `POST /servers`: Add new server
- `PUT /servers/:id`: Update server
- `DELETE /servers/:id`: Delete server
- `POST /servers/:id/select`: Set active server

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

## Feature Guide (Quick Reference)

This is a condensed guide to the in‑app documentation available at `/docs.html`.

- Total USDT Balance Over Time: Combined DEX (usdtVal + coinVal) + BinanceF (USDT + sum of unrealized PnL). Zoom with wheel/drag, pan with Ctrl + drag. Reset using the header button.
- DEX Exchange Balances: Per‑exchange totals and token rows (filtered to `totalUsdt > 0.1`). Use search and column sorting.
- BinanceF Balances: Token USDT value = `(entryPrice × total)/leverage + unrealizedProfit`. USDT total = wallet USDT + sum of unrealized PnL.
- Completed Trades: Shows `executedGrossProfit` (green/red), `Quantity = executedSrcPrice × executedQtySrc`, timestamps, parsed `props` (`Dex`, `Diff`, `DexSlip`, `CexSlip`). Sort/search supported.
- Pair Analysis:
  - Bar Chart: Total Gross Profit by Pair (top 20).
  - Win Rate (Top Winners) and Total Loss (Top Losers): Charts to spot consistent winners and risky pairs.
  - Pair Feature Differences (Wins vs Losses): All pairs with trades count, total profit (colored), and averages of `Diff`, `DexSlip`, `CexSlip` for wins and losses, plus overall CexSlip average. Sort/search.
- Pair Deep Dive:
  - Cumulative Gross Profit over time (loads fully zoomed out).
  - Gross Profit Distribution histogram.
  - Scatter: chosen X vs gross profit.
- ML Analysis:
  - Scatter + Linear Regression, with correlation and R². Points colored by sign of Y. Zoom/pan.
  - Outlier clipping and histogram bin control.
  - Histograms for X and Y and Residuals (Y − Ŷ) scatter.
  - Correlation Matrix: Select variables, compute Pearson correlations; green positive, red negative.
