# Gemini Project Context: DexArbitrageApp

This document provides a comprehensive overview of the DexArbitrageApp project, its architecture, and instructions for development and operation.

## Project Overview

The DexArbitrageApp is a full-stack application designed for analyzing and visualizing cryptocurrency arbitrage opportunities between Decentralized Exchanges (DEXs) and Centralized Exchanges (CEXs).

The application consists of three main components:

1.  **Node.js Backend:** A core service built with Express.js that periodically fetches trade and balance data from external APIs, stores it in a local SQLite database, and serves a web frontend and a REST API.
2.  **Web Frontend:** A vanilla JavaScript single-page application that provides a rich user interface with interactive charts and tables for data visualization and analysis.
3.  **Python ML Service:** A machine learning component that includes a training pipeline to build predictive models and a FastAPI service to serve those models for real-time predictions.

## Architecture

### Backend (Node.js)

-   **Framework:** Express.js (ES Modules)
-   **Database:** `better-sqlite3` for local SQLite storage (`data.sqlite`).
-   **Scheduling:** `node-cron` for periodic data fetching (every 2 minutes).
-   **Key Files:**
    -   `app.js`: Main application file containing the Express server, API endpoints, cron jobs, and database logic.
    -   `package.json`: Defines Node.js dependencies and scripts.
    -   `servers.json`: Configuration for different servers/environments.

### Frontend (Vanilla JS)

-   **Libraries:** Chart.js (via CDN/local), plain HTML/CSS.
-   **Key Files:**
    -   `public/index.html`: The main HTML file for the dashboard.
    -   `public/script.js`: The main JavaScript file for frontend logic, data fetching, and chart rendering.
    -   `public/styles.css`: CSS for styling the application.
    -   `public/reports.html` & `public/reports.js`: Reporting and analytics interface.

### Machine Learning (Python)

-   **Frameworks:** `scikit-learn`, `pandas`, `numpy`.
-   **API:** `fastapi` and `uvicorn`.
-   **Key Files:**
    -   `train.py`: Script for training the machine learning models.
    -   `ml_service/main.py`: FastAPI application for serving the trained models.
    -   `ml_pipeline/`: Directory containing Python modules for the ML pipeline (data loading, feature engineering, modeling).
    -   `models/`: Directory where trained models are stored.

## Building and Running

### Prerequisites

-   Node.js (>=18)
-   npm
-   Python 3

### Installation

1.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```

2.  **Install Python dependencies:**
    ```bash
    pip install numpy pandas scikit-learn joblib fastapi uvicorn pydantic
    ```

### Running the Application

1.  **Start the main application (backend and frontend):**
    ```bash
    npm start
    ```
    The application will be available at `http://localhost:3000`.

2.  **Start the ML service:**
    ```bash
    npm run ml:service
    ```
    The ML service will be available at `http://localhost:8100`.

### Training a New Model

To train a new machine learning model, run the `train.py` script. Check the script for available arguments.

```bash
python train.py --task classification --model-type random_forest --refresh-data
```

## Development Conventions

-   **Configuration:** The application is configured through environment variables (e.g., `PORT`, `DB_PATH`, `BALANCES_URL`, `TRADES_URL`) and `servers.json`.
-   **Database Schema:** The database schema is defined in `app.js` within the `ensureDb` function. It includes tables for `balances_history`, `completed_trades`, `server_tokens`, `gas_balances`, etc.
-   **API Endpoints:** The main API endpoints are defined in `app.js`. Refer to `README.md` for a detailed list.
-   **Modularity:** The project is divided into a Node.js backend, a frontend, and a Python ML service, each with its own set of responsibilities.
-   **Code Style:**
    -   **JS:** Uses ES Modules (`import`/`export`).
    -   **Python:** Uses Type Hints and Pydantic models.

## Scripts

-   `npm start`: Runs `node app.js`.
-   `npm run ml:service`: Runs the FastAPI ML service.
-   `npm run lint`: Runs ESLint.
-   `npm run db:inspect`: Runs `scripts/inspect-db.js` to inspect the database.
