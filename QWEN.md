# Dex Arbitrage App - Project Context

## Project Overview

This is a Node.js application that monitors decentralized exchange (DEX) arbitrage opportunities by periodically fetching balances and completed trades from remote services. The data is stored in local SQLite databases and presented through a web dashboard with charts and analytics.

### Key Features
- Polls remote endpoints every 2 minutes using `node-cron`
- Stores data in SQLite databases (one per server) using `better-sqlite3`
- Provides a web UI dashboard and JSON APIs for data visualization
- Supports multiple servers (BNB, Arbitrum, Base, Polygon) with configuration via `servers.json`
- CORS enabled for local development
- Includes ML functionality for trade success prediction
- Contract analysis integration with Etherscan-compatible APIs
- Enhanced diff analysis with trade integration

### Main Technologies
- **Backend**: Node.js with Express.js
- **Database**: better-sqlite3 (SQLite)
- **Scheduling**: node-cron
- **Frontend**: Vanilla JavaScript with Chart.js for data visualization
- **Networking**: axios for HTTP requests
- **ML**: Python with scikit-learn for predictive modeling

## Project Structure

```
DexArbitrageApp/
├── app.js              # Main server application
├── package.json        # Project dependencies and scripts
├── servers.json        # Multi-server configuration
├── README.md           # Project documentation
├── QWEN.md             # This file
├── train.py            # ML model training script
├── predict.py          # ML prediction script
├── data.sqlite         # Default SQLite database
├── data-*.sqlite       # Per-server SQLite databases
├── public/             # Static frontend files
│   ├── index.html      # Main dashboard
│   ├── script.js       # Dashboard JavaScript
│   ├── styles.css      # Dashboard styling
│   ├── diff-analysis.html  # Diff analysis page
│   ├── pair-analysis.html  # Pair analysis page
│   └── ...             # Other UI files
└── scripts/
    └── inspect-db.js   # Database inspection utility
```

## Building and Running

### Prerequisites
- Node.js 18+ (Node 20 LTS recommended)
- Python 3.x (for ML features)
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
- `ETHERSCAN_API_KEY`: Etherscan API key for contract analysis
- `ETHERSCAN_API_URL`: Override for Etherscan API base URL

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
- `GET /trades/analytics/tokens`: Aggregated analytics per token
- `GET /trades/history?token={tokenName}&startTime={timestamp}&endTime={timestamp}`: Trade history for a specific token within a time range
- `DELETE /trades/:id`: Delete a specific trade

### Analysis Endpoints
- `GET /analysis/server-tokens`: Server token analysis with profit data
- `GET /analysis/token-time-patterns`: Token performance by time of day/week
- `GET /analysis/token-time-series`: Time series analysis for tokens

### Diff Data Endpoints
- `GET /diffdata/tokens`: Available tokens in diff history
- `GET /diffdata/history?curId={curId}`: Historical diff data for a specific token

### Machine Learning Endpoints
- `POST /ml/train`: Train the ML model
- `POST /ml/predict`: Get prediction based on features (buyDiffBps, sellDiffBps, Diff, DexSlip, CexSlip)

### Server Configuration
- `GET /servers`: List all servers
- `GET /servers/active`: Get active server
- `POST /servers`: Add new server
- `PUT /servers/:id`: Update server
- `DELETE /servers/:id`: Delete server
- `POST /servers/:id/select`: Set active server

### Contract Analysis
- `GET /contracts/analysis`: Contract transaction analysis with success/failure rates

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
- Properties (Diff, DexSlip, CexSlip, Dex, Exec) and raw data

### server_tokens
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT (ISO-8601)
- `name` TEXT (token name)
- `buy` REAL (buy price)
- `sell` REAL (sell price)

### gas_balances
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `timestamp` TEXT (ISO-8601)
- `contract` TEXT (contract address)
- `gas` REAL (gas amount)
- `is_low` INTEGER (1 if low gas, 0 otherwise)

### diff_history
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `curId` TEXT (currency ID)
- `ts` INTEGER (timestamp)
- `buyDiffBps` INTEGER (buy diff in basis points)
- `sellDiffBps` INTEGER (sell diff in basis points)
- `cexVol` REAL (CEX volume)
- `serverBuy` REAL (server buy price)
- `serverSell` REAL (server sell price)
- `dexVolume` REAL (DEX volume)
- `rejectReason` TEXT (reason for rejection)
- UNIQUE(curId, ts)

### contract_transactions
- `hash` TEXT (transaction hash)
- `serverId` TEXT (server ID)
- `timestamp` INTEGER (timestamp)
- `isError` INTEGER (1 if error, 0 otherwise)
- `reason` TEXT (error reason)
- `ethPrice` REAL (ETH price at time of transaction)
- `polPrice` REAL (POL price at time of transaction)
- `bnbPrice` REAL (BNB price at time of transaction)
- `raw_data` TEXT (raw transaction data)
- PRIMARY KEY (serverId, hash)

## Development Notes

### Code Organization
- Main server logic in `app.js`
- Frontend files in `public/` directory
- Database schema defined in `app.js`
- Multi-server configuration in `servers.json`
- ML scripts in `train.py` and `predict.py`

### Key Components
1. **Data Fetching**: Periodic fetching of balances, trades, diff data, and status from remote endpoints
2. **Data Storage**: SQLite databases with separate files per server
3. **Data Processing**: Calculation of totals, normalization of trade properties, and aggregation for analytics
4. **API Layer**: RESTful endpoints for data access
5. **Frontend**: Interactive dashboard with charts and tables
6. **Machine Learning**: Training and prediction capabilities for trade success

### Frontend Features
- Real-time balance charts with zoom/pan capabilities
- Trade tables with sorting and filtering
- Exchange balance comparisons
- Server status monitoring
- Diff analysis with trade integration
- Pair and token analytics
- Machine learning analysis with correlation matrices
- Contract transaction analysis
- Responsive design with light/dark themes
- Authentication system

### Notifications and Digests
- The application supports notifications via Telegram, Slack, and email
- The "Hourly Digest" functionality has been updated to generate for all configured servers and send to both Telegram and Slack channels
- Notification conditions are now checked systematically for all servers every 2 minutes
- Fixed duplicate notification issue by adding unique keys to differentiate notification types
- Enhanced the formatting of hourly digest messages with emojis and better structure for improved readability
- Changed the hourly digest to only be sent to Slack and not Telegram
- Updated the hourly digest to display 'Gas Status' instead of 'Blacklist' with proper formatting
- Added UI elements in servers.html to expose notification rules, schedules, and thresholds for configuration
- Reverted the hourly digest cron schedule back to hourly (0 * * * *)
- Created a new Balance Update notification type with configurable schedule and channels

## Troubleshooting

Common issues and solutions:
- `Error: Cannot find module 'express'`: Run `npm install`
- `better-sqlite3` build errors on Windows with Node 22:
  - Install Visual Studio 2022 Build Tools with C++ workload, then `npm install`
  - Or switch to Node 20 LTS
- Port in use: Set a different port with `PORT` environment variable
- No data showing: Check remote endpoint connectivity and logs
- Python ML scripts not working: Ensure Python is installed and required packages (pandas, sklearn) are available

## Multi-Server Support

The application supports multiple servers through `servers.json`:
- Each server has its own database file (`data-{serverId}.sqlite`)
- Active server can be switched via API or UI
- Default servers: BNB, Arbitrum, Base, Polygon
- Each server can have its own contract address and explorer API configuration

## Machine Learning Integration

The application includes Python-based ML functionality:
- `train.py`: Trains a Random Forest classifier using trade and diff history data
- `predict.py`: Uses the trained model to predict trade success probability
- The model considers features like buyDiffBps, sellDiffBps, Diff, DexSlip, and CexSlip
- API endpoints allow training and prediction via HTTP requests
