# GEMINI.md

## Project Overview

This is a Node.js application designed for cryptocurrency arbitrage analysis. It periodically fetches balance, trade, and status data from remote DEX/CEX endpoints, stores the information in a local SQLite database, and serves a web-based user interface for data visualization and analysis.

The application is built with:
-   **Backend:** Node.js and Express.js for the web server and API endpoints.
-   **Database:** `better-sqlite3` for storing time-series data of balances, trades, and other metrics.
-   **Task Scheduling:** `node-cron` is used to fetch data from the remote services every two minutes.
-   **HTTP Client:** `axios` is used to perform HTTP requests to the remote data sources.
-   **Frontend:** The UI is composed of static HTML, JavaScript, and CSS files located in the `public` directory. It includes several pages for different types of analysis.

The application supports multiple server configurations, which are managed through the `servers.json` file, allowing it to connect to different data sources for BNB, Arbitrum, and Base networks.

## Features

### Main Dashboard (`index.html`)

-   **Server Status:** Displays real-time information about the connected server, including uptime, `Mindiff`, `MaxOrderSize`, and token-specific parameters. It also shows profit and trade statistics for various time windows (1h, 4h, 8h, 12h, 24h).
-   **DEX vs CEX Comparison:** A table that compares the "Total USDT" values of matching tokens between DEX and CEX exchanges.
-   **Completed Trades:** A table of recent completed trades with details like "% Profit", "Net Profit", and other relevant information.
-   **DEX and CEX Balances:** Tables showing the token balances on DEX and CEX exchanges.

### Analysis Page (`analysis.html`)

-   **Time Series Charts:** Visualizes the history of "Total USDT Balance" and "Trading Volume".
-   **Profitability Analysis:** Provides insights into the profitability of trades.

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

### Configuration

The application can be configured using environment variables:
-   `PORT`: The port for the web server (default: `3000`).
-   `BALANCES_URL`: The URL for the balances endpoint.
-   `TRADES_URL`: The URL for the completed trades endpoint.

The active data source can be switched through the application's UI, which updates the `servers.json` file. The `servers.json` file also supports additional fields for contract analysis, such as `contractAddress`, `explorerSite`, `explorerApiBase`, and `explorerApiKey`.

User authentication is managed via the `users.json` file.

## Development Conventions

-   The main server logic is contained in `app.js`.
-   The frontend is composed of static files and is located in the `public` directory.
-   Database-related scripts, such as for inspecting the database, are in the `scripts` directory.
-   The application uses separate SQLite database files for each configured server (e.g., `data-bnb.sqlite`, `data-arbitrum.sqlite`).
-   API endpoints are defined in `app.js` and provide data for the frontend charts and tables.
-   The application has a modular structure for fetching and storing data for different servers.
