# Development Documentation

This document provides detailed information for developers working on the DexArbitrageApp. It covers the architecture, codebase structure, database schema, and instructions for extending the application.

## Architecture Overview

The DexArbitrageApp is a full-stack application composed of three main parts:

1.  **Node.js Backend**: The core server that handles data fetching, database operations, and API endpoints.
2.  **Vanilla JS Frontend**: A lightweight, single-page application for visualizing data.
3.  **Python ML Service**: A separate service for training and serving machine learning models.

## Backend (Node.js)

The backend is built with Express.js and runs on Node.js (>=18).

### Key Files
-   `app.js`: The main entry point. It sets up the Express server, SQLite database connection, cron jobs for data fetching, and API endpoints.
-   `fetch-worker.js`: (If applicable) Worker script for offloading heavy data fetching tasks.
-   `notifier.js`: Handles notifications (Telegram, Slack, Email) based on configured rules.

### Database
The application uses `better-sqlite3` to interact with SQLite databases.
-   **Main Database**: `data.sqlite` (default) or `data-<server_id>.sqlite`.
-   **Schema**:
    -   `balances_history`: Stores historical balance snapshots.
    -   `completed_trades`: Stores details of executed trades.
    -   `server_tokens`: Stores token prices (buy/sell) for the server.
    -   `gas_balances`: Tracks gas usage and balances.
    -   `diff_history`: Stores historical price difference data between CEX and DEX.
    -   `contract_transactions`: Logs transaction hashes and statuses.

### Data Fetching
Data is fetched periodically using `node-cron`. The main jobs fetch:
-   ETH, POL, BNB prices (every 5 minutes).
-   Exchange balances and trade history (configured in `servers.json`).

## Frontend (Vanilla JS)

The frontend is located in the `public/` directory.

### Key Files
-   `index.html`: The main dashboard layout.
-   `script.js`: Contains the core logic for fetching data from the backend API and rendering charts/tables.
-   `styles.css`: Custom styles for the dashboard.

### Libraries
-   **Chart.js**: Used for rendering price and balance history charts.
-   **Bootstrap** (optional/if used): For layout and styling components.

## ML Service (Python)

The ML service is a FastAPI application that provides price prediction capabilities.

### Key Files
-   `ml_service/main.py`: The FastAPI application entry point.
-   `train.py`: Script for training machine learning models.
-   `predict.py`: Script for running local predictions (fallback).

### Setup
The ML service requires a Python environment with dependencies listed in `requirements.txt` (or installed via `pip`).
It exposes a `/predict` endpoint that accepts feature payloads and returns success probabilities.

## Configuration

### `servers.json`
This file configures the external servers/exchanges the app connects to.
```json
{
  "activeId": "bnb",
  "servers": [
    { "id": "bnb", "label": "BNB", "baseUrl": "...", ... }
  ],
  "notificationRules": { ... },
  "notifications": { ... }
}
```

### Environment Variables
-   `PORT`: Backend server port (default: 3000).
-   `DB_PATH`: Custom path for the SQLite database.
-   `ML_SERVICE_URL`: URL of the Python ML service (default: http://127.0.0.1:8100).
-   `ETHERSCAN_API_KEY`: API key for Etherscan (for transaction tracking).

## Setup and Run

### Prerequisites
-   Node.js >= 18
-   Python >= 3.8
-   npm

### Installation
1.  Install Node.js dependencies:
    ```bash
    npm install
    ```
2.  Install Python dependencies:
    ```bash
    pip install -r requirements.txt
    # OR manually:
    pip install fastapi uvicorn scikit-learn pandas numpy joblib
    ```

### Running
1.  Start the Backend:
    ```bash
    npm start
    ```
2.  Start the ML Service:
    ```bash
    npm run ml:service
    ```

## Extension Guides

### Adding a New Exchange
1.  Update `servers.json` to include the new server configuration in the `servers` array.
2.  Ensure the backend can reach the new server's API endpoints.

### Adding a New ML Model
1.  Train a new model using `train.py`.
2.  Save the model artifact (e.g., `model.joblib`) to the `models/` directory.
3.  Update the ML service to load the new model or pass the model path in the `/predict` request.

### Adding a New Chart
1.  Add a canvas element to `public/index.html`.
2.  In `public/script.js`, fetch the necessary data from the backend.
3.  Initialize a new Chart.js instance bound to the canvas element.
