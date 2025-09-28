// Quick DB inspection helper
// Usage: npm run db:inspect

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');

function computeDexCex(snapshot) {
  let dexTotal = 0;
  let cexTotal = 0;
  if (!snapshot || typeof snapshot !== 'object') {
    return { dexTotal: 0, cexTotal: 0, combined: 0 };
  }
  for (const [name, ex] of Object.entries(snapshot)) {
    if (!ex || typeof ex !== 'object') continue;
    if (name === 'BinanceF') {
      let usdtWallet = 0;
      let pnlSum = 0;
      if (ex.balanceMap && typeof ex.balanceMap === 'object') {
        for (const b of Object.values(ex.balanceMap)) {
          if (!b || typeof b !== 'object') continue;
          const currency = String(b.currency || '').toLowerCase();
          const total = Number(b.total) || 0;
          const uPnL = Number(b.unrealizedProfit) || 0;
          if (currency === 'usdt') usdtWallet += total;
          else pnlSum += uPnL;
        }
      }
      cexTotal += usdtWallet + pnlSum;
      continue;
    }
    let exUsdt = 0;
    if (typeof ex.usdtVal === 'number' && Number.isFinite(ex.usdtVal)) exUsdt += ex.usdtVal;
    if (!Number.isFinite(ex.usdtVal) && ex.balanceMap && typeof ex.balanceMap === 'object') {
      for (const b of Object.values(ex.balanceMap)) {
        if (b && typeof b.totalUsdt === 'number' && Number.isFinite(b.totalUsdt)) {
          exUsdt += b.totalUsdt;
        }
      }
    }
    const exCoin = (typeof ex.coinVal === 'number' && Number.isFinite(ex.coinVal)) ? ex.coinVal : 0;
    dexTotal += exUsdt + exCoin;
  }
  return { dexTotal, cexTotal, combined: dexTotal + cexTotal };
}

function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const counts = {
    balances: db.prepare('SELECT COUNT(*) AS n FROM balances_history').get().n,
    trades: db.prepare('SELECT COUNT(*) AS n FROM completed_trades').get().n,
  };

  const lastBal = db.prepare('SELECT id, timestamp, total_usdt, total_coin, raw_data FROM balances_history ORDER BY id DESC LIMIT 1').get();
  let parts = { dexTotal: 0, cexTotal: 0, combined: 0 };
  if (lastBal?.raw_data) {
    try { parts = computeDexCex(JSON.parse(lastBal.raw_data)); } catch {}
  }

  const last5 = db.prepare('SELECT id, timestamp, total_usdt, total_coin FROM balances_history ORDER BY id DESC LIMIT 5').all();
  const recentTrades = db.prepare('SELECT id, pair, status, executedProfit, creationTime, lastUpdateTime FROM completed_trades ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT 5').all();

  console.log(JSON.stringify({
    db: DB_PATH,
    counts,
    latest_balance: {
      id: lastBal?.id,
      timestamp: lastBal?.timestamp,
      total_usdt: lastBal?.total_usdt,
      total_coin: lastBal?.total_coin,
      computed: parts,
    },
    last5_balances: last5,
    recent_trades: recentTrades,
  }, null, 2));

  db.close();
}

main();

