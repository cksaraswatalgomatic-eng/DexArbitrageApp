const { parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const Database = require('better-sqlite3');
const config = require('./config'); // Assuming config is in the same directory or accessible

let db;
let activeServer;

// Initialize database and active server from workerData
if (workerData && workerData.dbPath && workerData.activeServer) {
    db = new Database(workerData.dbPath);
    activeServer = workerData.activeServer;
    console.log(`Worker: Initialized with DB: ${workerData.dbPath} and Server: ${activeServer.id}`);
} else {
    console.error('Worker: Missing dbPath or activeServer in workerData.');
    process.exit(1);
}

// Helper function to fetch balances
async function fetchBalances(server) {
    if (!server.balancesUrl) {
        console.log(`Worker: Balances URL not configured for server ${server.id}. Skipping balance fetch.`);
        return null;
    }
    try {
        const response = await axios.get(server.balancesUrl);
        return response.data;
    } catch (error) {
        console.error(`Worker: Error fetching balances for ${server.id}:`, error.message);
        return null;
    }
}

// Helper function to store balances
function storeBalances(balances) {
    if (!balances) return;

    const { totalUsdt, totalCoin, raw } = balances;
    const timestamp = new Date().toISOString();

    const stmt = db.prepare('INSERT INTO balances_history (timestamp, total_usdt, total_coin, raw_data) VALUES (?, ?, ?, ?)');
    stmt.run(timestamp, totalUsdt, totalCoin, JSON.stringify(raw));
    parentPort.postMessage({ type: 'log', message: `Worker: Stored balances for ${activeServer.id}` });
}

// Helper function to fetch trades
async function fetchTrades(server) {
    if (!server.tradesUrl) {
        console.log(`Worker: Trades URL not configured for server ${server.id}. Skipping trade fetch.`);
        return null;
    }
    try {
        const response = await axios.get(server.tradesUrl);
        return response.data;
    } catch (error) {
        console.error(`Worker: Error fetching trades for ${server.id}:`, error.message);
        return null;
    }
}

// Helper function to store trades
function storeTrades(trades) {
    if (!trades || trades.length === 0) return;

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO completed_trades (
            id, fsmType, pair, srcExchange, dstExchange, status, user, eta, props, nwId,
            estimatedProfitNormalized, estimatedProfit, estimatedGrossProfit, estimatedSrcPrice, estimatedDstPrice, estimatedQty,
            executedProfitNormalized, executedProfit, executedGrossProfit, executedSrcPrice, executedDstPrice, executedQtySrc, executedQtyDst, executedFeeTotal, executedFeePercent,
            executedTime, creationTime, openTime, lastUpdateTime,
            txFee, calculatedVolume, conveyedVolume, commissionPercent, hedge, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const trade of trades) {
        try {
            stmt.run(
                trade.id, trade.fsmType, trade.pair, trade.srcExchange, trade.dstExchange, trade.status, trade.user, trade.eta, JSON.stringify(trade.props), trade.nwId,
                trade.estimatedProfitNormalized, trade.estimatedProfit, trade.estimatedGrossProfit, trade.estimatedSrcPrice, trade.estimatedDstPrice, trade.estimatedQty,
                trade.executedProfitNormalized, trade.executedProfit, trade.executedGrossProfit, trade.executedSrcPrice, trade.executedDstPrice, trade.executedQtySrc, trade.executedQtyDst, trade.executedFeeTotal, trade.executedFeePercent,
                trade.executedTime, trade.creationTime, trade.openTime, trade.lastUpdateTime,
                trade.txFee, trade.calculatedVolume, trade.conveyedVolume, trade.commissionPercent, trade.hedge, JSON.stringify(trade)
            );
        } catch (error) {
            console.error(`Worker: Error storing trade ${trade.id}:`, error.message);
        }
    }
    parentPort.postMessage({ type: 'log', message: `Worker: Stored ${trades.length} trades for ${activeServer.id}` });
}

// Main function to fetch and store all data
async function fetchAllAndStoreWorker() {
    parentPort.postMessage({ type: 'log', message: `Worker: Starting data fetch for server ${activeServer.id}...` });
    const balances = await fetchBalances(activeServer);
    storeBalances(balances);

    const trades = await fetchTrades(activeServer);
    storeTrades(trades);
    parentPort.postMessage({ type: 'log', message: `Worker: Data fetch complete for server ${activeServer.id}.` });
}

// Listen for messages from the main thread
parentPort.on('message', async (message) => {
    if (message.type === 'startFetch') {
        await fetchAllAndStoreWorker();
        parentPort.postMessage({ type: 'fetchComplete' });
    }
});