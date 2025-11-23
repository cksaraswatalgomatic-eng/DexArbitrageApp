import Database from 'better-sqlite3';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ML_SERVICE_URL = 'http://127.0.0.1:8100/predict';

function findDatabase() {
    const defaultPath = path.join(__dirname, 'data.sqlite');
    if (fs.existsSync(defaultPath)) return defaultPath;

    // Look for other sqlite files
    const files = fs.readdirSync(__dirname)
        .filter(f => f.startsWith('data-') && f.endsWith('.sqlite'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(__dirname, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Newest first

    if (files.length > 0) {
        return path.join(__dirname, files[0].name);
    }
    return null;
}

const DB_PATH = findDatabase();

// Helper to parse props
function normalizeProps(raw) {
    try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        const out = {};
        
        // Extract numeric props
        if (p.Diff !== undefined) out.Diff = Number(p.Diff);
        if (p.DexSlip !== undefined) out.DexSlip = Number(p.DexSlip);
        if (p.CexSlip !== undefined) out.CexSlip = Number(p.CexSlip);
        
        // Extract token if available
        for (const [k, v] of Object.entries(p)) {
            if (String(v) === 'BUY' || String(v) === 'SELL') {
                out.Side = v;
                // Try to infer token from key if not explicit
                if (!out.Token) out.Token = k;
            }
        }
        return out;
    } catch (e) {
        return {};
    }
}

// Helper to find closest diff
function getDiffContext(db, token, timestamp) {
    if (!token) return null;
    
    // Try to match by token name in curId (e.g., BASE_token_123)
    const row = db.prepare(`
        SELECT buyDiffBps, sellDiffBps, ts 
        FROM diff_history 
        WHERE curId LIKE ? 
        ORDER BY ABS(ts - ?) ASC 
        LIMIT 1
    `).get(`%${token}%`, timestamp);

    return row;
}

async function main() {
    if (!DB_PATH) {
        console.error('No SQLite database found (data.sqlite or data-*.sqlite)');
        process.exit(1);
    }
    console.log(`Using database: ${DB_PATH}`);

    const db = new Database(DB_PATH);
    
    // Fetch last 20 trades
    const trades = db.prepare(`
        SELECT id, pair, executedGrossProfit, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, lastUpdateTime, props 
        FROM completed_trades 
        ORDER BY lastUpdateTime DESC 
        LIMIT 20
    `).all();

    console.log(`Analyzing last ${trades.length} trades...\n`);
    console.log(
        "| ID | Pair | Actual Profit | ML Pred (Prob) | Features (Diff/DexSlip/CexSlip) |"
    );
    console.log("|---:|:---|:---:|:---:|:---:|");

    for (const trade of trades) {
        const props = normalizeProps(trade.props);
        const netProfit = (trade.executedQtyDst * trade.executedDstPrice) - (trade.executedSrcPrice * trade.executedQtySrc) - (0.0002 * trade.executedQtyDst * trade.executedDstPrice);
        
        // Context lookup
        let buyDiffBps = 0;
        let sellDiffBps = 0;
        
        // Try to find diff history
        let token = props.Token;
        if (!token && trade.pair) {
             const parts = trade.pair.split('->');
             if(parts.length > 0) {
                 const p = parts[0]; 
                 token = p.split('_')[2] || p; 
             }
        }
        
        const diffCtx = getDiffContext(db, token, trade.lastUpdateTime);
        if (diffCtx) {
            buyDiffBps = diffCtx.buyDiffBps || 0;
            sellDiffBps = diffCtx.sellDiffBps || 0;
        }

        const payload = {
            buyDiffBps: buyDiffBps,
            sellDiffBps: sellDiffBps,
            Diff: props.Diff || 0,
            DexSlip: props.DexSlip || 0,
            CexSlip: props.CexSlip || 0
        };

        try {
            const resp = await axios.post(ML_SERVICE_URL, {
                payloads: [payload],
                include_probabilities: true
            });
            
            const prediction = resp.data.predictions[0];
            const probability = resp.data.probabilities ? resp.data.probabilities[0][1] : 'N/A';
            
            const profitColor = netProfit > 0 ? '\x1b[32m' : '\x1b[31m'; // Green/Red
            const reset = '\x1b[0m';
            
            // Simple console output formatting
            console.log(
                `| ${trade.id} | ${trade.pair ? trade.pair.substring(0, 20) : 'N/A'}... | ${profitColor}${netProfit.toFixed(2)}${reset} | ${prediction} (${Number(probability).toFixed(2)}) | ${payload.Diff}/${payload.DexSlip}/${payload.CexSlip} |`
            );

        } catch (err) {
            console.log(`| ${trade.id} | ${trade.pair ? trade.pair.substring(0, 15) : 'N/A'}... | ${netProfit.toFixed(2)} | ERROR | - |`);
            console.error(err.message); 
        }
    }
}

main();