# Dex Arbitrage App - Project Context

## Project Overview

This is a Node.js application that monitors decentralized exchange (DEX) arbitrage opportunities by periodically fetching balances and completed trades from remote services. The data is stored in local SQLite databases and presented through a web dashboard with charts and analytics.

### Key Features
- Polls remote endpoints every 2 minutes using `node-cron`
- Stores data in SQLite databases (one per server) using `better-sqlite3`
- Provides a web UI dashboard and JSON APIs for data visualization
- Supports multiple servers (BNB, Arbitrum, Base) with configuration via `servers.json`
- CORS enabled for local development

### Main Technologies
- **Backend**: Node.js with Express.js
- **Database**: better-sqlite3 (SQLite)
- **Scheduling**: node-cron
- **Frontend**: Vanilla JavaScript with Chart.js for data visualization
- **Networking**: axios for HTTP requests

## Project Structure

```
DexArbitrageApp/
├── app.js              # Main server application
├── package.json        # Project dependencies and scripts
├── servers.json        # Multi-server configuration
├── README.md           # Project documentation
├── QWEN.md             # This file
├── data.sqlite         # Default SQLite database
├── data-*.sqlite       # Per-server SQLite databases
├── public/             # Static frontend files
│   ├── index.html      # Main dashboard
│   ├── script.js       # Dashboard JavaScript
│   ├── styles.css      # Dashboard styling
│   └── ...             # Other UI files
└── scripts/
    └── inspect-db.js   # Database inspection utility
```

## Building and Running

### Prerequisites
- Node.js 18+ (Node 20 LTS recommended)
- npm

### Quick Start
```bash
npm install
npm start
```

The server will start on http://localhost:3000 by default.

### Environment Variables
- `PORT`: HTTP port (default: 3000)
- `DB_PATH`: Path to SQLite file (default: ./data.sqlite)
- `BALANCES_URL`: Remote balances endpoint (optional)
- `TRADES_URL`: Remote completed trades endpoint (optional)

### NPM Scripts
- `npm start`: Run the server
- `npm run db:inspect`: Inspect the database contents

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

## Data Model

### balances_history
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT (ISO-8601)
- `total_usdt` REAL (nullable)
- `total_coin` REAL (nullable)
- `raw_data` TEXT (JSON of fetched payload)

### completed_trades
Contains numerous fields for trade details including:
- IDs and exchange information
- Estimated and executed prices/quantities/profits
- Timestamps and status information
- Properties and raw data

## Development Notes

### Code Organization
- Main server logic in `app.js`
- Frontend files in `public/` directory
- Database schema defined in `app.js`
- Multi-server configuration in `servers.json`

### Key Components
1. **Data Fetching**: Periodic fetching of balances and trades from remote endpoints
2. **Data Storage**: SQLite databases with separate files per server
3. **Data Processing**: Calculation of totals and normalization of trade properties
4. **API Layer**: RESTful endpoints for data access
5. **Frontend**: Interactive dashboard with charts and tables

### Frontend Features
- Real-time balance charts with zoom/pan capabilities
- Trade tables with sorting and filtering
- Exchange balance comparisons
- Server status monitoring
- Responsive design with light/dark themes

## Troubleshooting

Common issues and solutions:
- `Error: Cannot find module 'express'`: Run `npm install`
- `better-sqlite3` build errors on Windows with Node 22:
  - Install Visual Studio 2022 Build Tools with C++ workload, then `npm install`
  - Or switch to Node 20 LTS
- Port in use: Set a different port with `PORT` environment variable
- No data showing: Check remote endpoint connectivity and logs

## Multi-Server Support

The application supports multiple servers through `servers.json`:
- Each server has its own database file (`data-{serverId}.sqlite`)
- Active server can be switched via API or UI
- Default servers: BNB, Arbitrum, Base