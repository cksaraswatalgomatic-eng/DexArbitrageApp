const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

// Configuration
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const BALANCES_URL = process.env.BALANCES_URL || 'http://195.201.178.120:3001/balance';
const TRADES_URL = process.env.TRADES_URL || 'http://195.201.178.120:3001/completed';
const SERVERS_FILE = path.join(__dirname, 'servers.json');

let etherscanBase = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2';
if (etherscanBase) {
  while (etherscanBase.endsWith('/')) etherscanBase = etherscanBase.slice(0, -1);
}
const ETHERSCAN_API_URL = etherscanBase;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';

// App setup
const app = express();
app.use(cors()); // Allow all origins
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multi-server config
function loadServers() {
  if (!fs.existsSync(SERVERS_FILE)) {
    const defaults = {
      activeId: 'bnb',
      servers: [
        { id: 'bnb', label: 'BNB', baseUrl: 'http://195.201.178.120:3001', balancesPath: '/balance', completedPath: '/completed' },
        { id: 'arbitrum', label: 'ARBITRUM', baseUrl: 'http://168.119.69.230:3001', balancesPath: '/balance', completedPath: '/completed' },
        { id: 'base', label: 'BASE', baseUrl: 'http://95.216.27.101:3001', balancesPath: '/balance', completedPath: '/completed' },
      ]
    };
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  } catch {
    return { activeId: 'default', servers: [{ id: 'default', label: 'Default', baseUrl: (BALANCES_URL||'').replace(/\/(balance|balances).*/, ''), balancesPath: '/balance', completedPath: '/completed' }] };
  }
}
function saveServers(cfg) { fs.writeFileSync(SERVERS_FILE, JSON.stringify(cfg, null, 2)); }
function getActiveServer() { const cfg = loadServers(); return cfg.servers.find(s => s.id === cfg.activeId) || cfg.servers[0]; }

const dbCache = new Map();
const initialTradesSynced = new Set();
function dbPathFor(serverId) {
  if (serverId === 'default' && fs.existsSync(DB_PATH)) return DB_PATH;
  return path.join(__dirname, `data-${serverId}.sqlite`);
}
function ensureDb(serverId) {
  if (dbCache.has(serverId)) return dbCache.get(serverId);
  const file = dbPathFor(serverId);
  const _db = new Database(file);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS balances_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      total_usdt REAL,
      total_coin REAL,
      raw_data TEXT
    );
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS completed_trades (
      id INTEGER PRIMARY KEY,
      fsmType TEXT,
      pair TEXT,
      srcExchange TEXT,
      dstExchange TEXT,
      status TEXT,
      user TEXT,
      estimatedProfitNormalized REAL,
      estimatedProfit REAL,
      estimatedGrossProfit REAL,
      eta TEXT,
      estimatedSrcPrice REAL,
      estimatedDstPrice REAL,
      estimatedQty REAL,
      executedProfitNormalized REAL,
      executedProfit REAL,
      executedGrossProfit REAL,
      executedTime INTEGER,
      executedSrcPrice REAL,
      executedDstPrice REAL,
      executedQtySrc REAL,
      executedQtyDst REAL,
      executedFeeTotal REAL,
      executedFeePercent REAL,
      props TEXT,
      creationTime INTEGER,
      openTime INTEGER,
      lastUpdateTime INTEGER,
      nwId TEXT,
      txFee REAL,
      calculatedVolume REAL,
      conveyedVolume REAL,
      commissionPercent REAL,
      hedge INTEGER,
      raw_data TEXT
    );
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS server_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      name TEXT NOT NULL,
      buy REAL,
      sell REAL
    );
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS gas_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      contract TEXT NOT NULL,
      gas REAL,
      is_low INTEGER
    );
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS diff_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curId TEXT NOT NULL,
      ts INTEGER NOT NULL,
      buyDiffBps INTEGER,
      sellDiffBps INTEGER,
      cexVol REAL,
      serverBuy REAL,
      serverSell REAL,
      dexVolume REAL,
      rejectReason TEXT,
      UNIQUE(curId, ts)
    );
  `);
  ensureDiffHistoryColumns(_db);
  dbCache.set(serverId, _db);
  return _db;
}

function ensureDiffHistoryColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(diff_history)').all().map(col => col.name));
  const migrations = [];
  if (!columns.has('serverBuy')) migrations.push('ALTER TABLE diff_history ADD COLUMN serverBuy REAL');
  if (!columns.has('serverSell')) migrations.push('ALTER TABLE diff_history ADD COLUMN serverSell REAL');
  if (!columns.has('dexVolume')) migrations.push('ALTER TABLE diff_history ADD COLUMN dexVolume REAL');
  if (!columns.has('rejectReason')) migrations.push('ALTER TABLE diff_history ADD COLUMN rejectReason TEXT');
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      console.error('[db] diff_history migration failed:', err.message);
    }
  }
}

async function fetchDiffDataAndStoreFor(server) {
  if (!server) return;
  try {
    const url = server.baseUrl + '/diffdata';
    const resp = await axios.get(url, { timeout: 15000 });
    const data = resp.data;
    if (!Array.isArray(data)) return;

    const db = ensureDb(server.id);
    const lookupStmt = db.prepare('SELECT buy, sell FROM server_tokens WHERE name = ? ORDER BY timestamp DESC LIMIT 1');
    const tokenCache = new Map();

    const rows = data.map((raw) => {
      if (!raw || raw.curId == null || raw.ts == null) return null;
      const curId = String(raw.curId);
      const ts = parseInt(raw.ts, 10);
      if (!Number.isFinite(ts)) return null;
      const tokenName = tokenNameFromCurId(curId);

      const cacheKey = tokenName || '';
      let tokenRow = tokenCache.get(cacheKey);
      if (tokenRow === undefined) {
        tokenRow = lookupStmt.get(tokenName);
        if (!tokenRow && tokenName) {
          const upper = tokenName.toUpperCase();
          if (upper !== tokenName) tokenRow = lookupStmt.get(upper);
        }
        if (!tokenRow && tokenName) {
          const lower = tokenName.toLowerCase();
          if (lower !== tokenName) tokenRow = lookupStmt.get(lower);
        }
        tokenCache.set(cacheKey, tokenRow || null);
      }

      return {
        curId,
        ts,
        buyDiffBps: raw.buyDiffBps != null ? parseInt(raw.buyDiffBps, 10) : null,
        sellDiffBps: raw.sellDiffBps != null ? parseInt(raw.sellDiffBps, 10) : null,
        cexVol: safeNumber(raw.cexVol),
        serverBuy: tokenRow ? safeNumber(tokenRow.buy) : null,
        serverSell: tokenRow ? safeNumber(tokenRow.sell) : null,
        dexVolume: safeNumber(raw.dexLiq),
        rejectReason: raw.rr == null ? null : String(raw.rr),
      };
    }).filter(Boolean);

    if (!rows.length) {
      console.log('[diffdata:' + server.label + '] No diff data rows to store.');
      return;
    }

    const stmt = db.prepare('INSERT INTO diff_history (curId, ts, buyDiffBps, sellDiffBps, cexVol, serverBuy, serverSell, dexVolume, rejectReason) ' +
      'VALUES (@curId, @ts, @buyDiffBps, @sellDiffBps, @cexVol, @serverBuy, @serverSell, @dexVolume, @rejectReason) ' +
      'ON CONFLICT(curId, ts) DO UPDATE SET ' +
      'buyDiffBps = COALESCE(excluded.buyDiffBps, diff_history.buyDiffBps), ' +
      'sellDiffBps = COALESCE(excluded.sellDiffBps, diff_history.sellDiffBps), ' +
      'cexVol = COALESCE(excluded.cexVol, diff_history.cexVol), ' +
      'serverBuy = CASE WHEN diff_history.serverBuy IS NULL THEN excluded.serverBuy ELSE diff_history.serverBuy END, ' +
      'serverSell = CASE WHEN diff_history.serverSell IS NULL THEN excluded.serverSell ELSE diff_history.serverSell END, ' +
      'dexVolume = COALESCE(excluded.dexVolume, diff_history.dexVolume), ' +
      'rejectReason = COALESCE(excluded.rejectReason, diff_history.rejectReason)');

    db.transaction((items) => {
      for (const item of items) stmt.run(item);
    })(rows);
    console.log('[diffdata:' + server.label + '] Stored ' + rows.length + ' diff data points.');
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) console.log(`[diffdata:${server.label}] 404 (not found). Skipping.`);
    else console.error(`[diffdata:${server.label}] Fetch/store error:`, err.message);
  }
}

// Helpers
function safeNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function propsHasCurId(rawProps, curId) {
  if (!curId) return false;
  try {
    const parsed = typeof rawProps === 'string' ? JSON.parse(rawProps) : rawProps;
    if (!parsed || typeof parsed !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(parsed, curId);
  } catch {
    return false;
  }
}

function getTradeRawProps(trade) {
  if (!trade) return null;
  const raw = safeJsonParse(trade.raw_data, null);
  if (!raw || raw.props == null) return null;
  return raw.props;
}

function tradeHasCurId(trade, curId) {
  if (!curId || !trade) return false;
  if (propsHasCurId(trade.props, curId)) return true;
  const rawProps = getTradeRawProps(trade);
  return propsHasCurId(rawProps, curId);
}

function extractTokensFromPropsSource(source) {
  const obj = safeJsonParse(source, null);
  if (!obj || typeof obj !== 'object') return [];
  const tokens = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const upper = value.toUpperCase();
      if (upper === 'BUY' || upper === 'SELL') tokens.push(String(key));
    }
  }
  return tokens;
}

function extractTokensFromTrade(trade) {
  if (!trade) return [];
  const tokens = new Set();
  if (trade.props != null) {
    for (const token of extractTokensFromPropsSource(trade.props)) tokens.add(token);
  }
  const raw = safeJsonParse(trade.raw_data, null);
  if (raw && raw.props != null) {
    for (const token of extractTokensFromPropsSource(raw.props)) tokens.add(token);
  }
  return Array.from(tokens);
}

function tokenSymbolFromCurId(curId) {
  if (typeof curId !== 'string') return null;
  const parts = curId.split('_').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return null;
}

function aggregateTokenMetrics(tradeRows) {
  const metrics = new Map();
  for (const trade of tradeRows) {
    const tokens = extractTokensFromTrade(trade);
    if (!tokens.length) continue;
    const netProfit = (Number(trade.executedQtyDst) * Number(trade.executedDstPrice)) - (Number(trade.executedSrcPrice) * Number(trade.executedQtySrc)) - (0.0002 * Number(trade.executedQtyDst) * Number(trade.executedDstPrice));
    const gp = Number(trade.executedGrossProfit) || 0;
    const props = normalizePropsRaw(trade.props);

    for (const token of tokens) {
      let rec = metrics.get(token);
      if (!rec) {
        rec = {
          token,
          trades: 0,
          wins: 0,
          losses: 0,
          totalGrossProfit: 0,
          totalNetProfit: 0,
          sumCexSlip: 0,
          countCexSlip: 0,
          sumDexSlip: 0,
          countDexSlip: 0,
          sumDiff: 0,
          countDiff: 0,
        };
        metrics.set(token, rec);
      }

      rec.trades += 1;
      rec.totalGrossProfit += gp;
      if (Number.isFinite(netProfit)) rec.totalNetProfit += netProfit;
      if (gp > 0) rec.wins += 1;
      else if (gp < 0) rec.losses += 1;

      if (Number.isFinite(props.CexSlip)) { rec.sumCexSlip += props.CexSlip; rec.countCexSlip++; }
      if (Number.isFinite(props.DexSlip)) { rec.sumDexSlip += props.DexSlip; rec.countDexSlip++; }
      if (Number.isFinite(props.Diff)) { rec.sumDiff += props.Diff; rec.countDiff++; }
    }
  }
  return metrics;
}

function tokenNameFromCurId(curId) {
  if (typeof curId !== 'string') return null;
  const parts = curId.split('_').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return parts[0] || curId || null;
}

function calculateTotals(snapshot) {
  let totalUsdt = 0;

  if (!snapshot || typeof snapshot !== 'object') {
    return { totalUsdt: null, totalCoin: null };
  }

  for (const [name, ex] of Object.entries(snapshot)) {
    if (!ex || typeof ex !== 'object') continue;

    if (name === 'BinanceF') {
      totalUsdt += Number(ex.usdtVal) || 0;
    } else {
      totalUsdt += Number(ex.coinVal) || 0;
    }
  }
  // The meaning of totalCoin is now ambiguous, so we nullify it.
  return {
    totalUsdt: Number.isFinite(totalUsdt) ? totalUsdt : null,
    totalCoin: null,
  };
}


// Helper to compute per-snapshot DEX and CEX totals
function computeDexCex(snapshot) {
  let dexTotal = 0;
  let cexTotal = 0;

  if (!snapshot || typeof snapshot !== 'object') {
    return { dexTotal: 0, cexTotal: 0, combined: 0 };
  }

  for (const [name, ex] of Object.entries(snapshot)) {
    if (!ex || typeof ex !== 'object') continue;

    if (name === 'BinanceF') {
      cexTotal += Number(ex.usdtVal) || 0;
    } else {
      dexTotal += Number(ex.coinVal) || 0;
    }
  }

  return { dexTotal, cexTotal, combined: dexTotal + cexTotal };
}

// Normalize various props encodings into a canonical shape
function normalizePropsRaw(input) {
  try {
    const p = typeof input === 'string' ? JSON.parse(input) : (input || {});
    const out = {};

    // Direct keys
    if (p && (p.Diff != null || p.DexSlip != null || p.CexSlip != null || p.Dex != null || p.Exec != null)) {
      if (p.Diff != null) out.Diff = Number(p.Diff);
      if (p.DexSlip != null) out.DexSlip = Number(p.DexSlip);
      if (p.CexSlip != null) out.CexSlip = Number(p.CexSlip);
      if (p.Dex != null) out.Dex = String(p.Dex);
      if (p.Exec != null) out.Exec = String(p.Exec);
    } else {
      // Heuristic format: { 'SOME_link_xxxx': 'SELL', '0.14': '0.06', 'Market': '0.27' }
      // Exec key is one of these, value is CexSlip
      const execKey = ['Market','Limit','PostOnly','IOC','FOK'].find(k => Object.prototype.hasOwnProperty.call(p, k));
      if (execKey) { out.Exec = execKey; const v = Number(p[execKey]); if (Number.isFinite(v)) out.CexSlip = v; }
      // Find Dex as value of any key whose value is 'BUY' or 'SELL'
      for (const [k, v] of Object.entries(p)) {
        if (v === 'BUY' || v === 'SELL') {
          out.Dex = String(v);
          break;
        }
      }
      // Find numeric key/value pair -> key = Diff, value = DexSlip
      for (const [k, v] of Object.entries(p)) {
        const nk = Number(k); const nv = Number(v);
        if (Number.isFinite(nk) && Number.isFinite(nv)) { out.Diff = nk; out.DexSlip = nv; break; }
      }
    }
    return out;
  } catch (e) {
    console.error('normalizePropsRaw - error:', e);
    return {};
  }
}

async function fetchBalancesAndStoreFor(server) {
  if (!server) return;
  try {
    const url = server.baseUrl + (server.balancesPath || '/balance');
    const resp = await axios.get(url, { timeout: 15000 });
    const data = resp.data;
    const { totalUsdt, totalCoin } = calculateTotals(data);
    const row = { timestamp: new Date().toISOString(), total_usdt: totalUsdt, total_coin: totalCoin, raw_data: JSON.stringify(data) };
    const db = ensureDb(server.id);
    db.prepare(`INSERT INTO balances_history (timestamp, total_usdt, total_coin, raw_data) VALUES (@timestamp,@total_usdt,@total_coin,@raw_data)`).run(row);
    console.log(`[balances:${server.label}] Stored @ ${row.timestamp} | total_usdt=${totalUsdt}${totalCoin != null ? ` total_coin=${totalCoin}` : ''}`);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) console.log(`[balances:${server.label}] 404 (not found). Skipping.`);
    else console.error(`[balances:${server.label}] Fetch/store error:`, err.message);
  }
}

function storeCompletedTrades(server, trades, sourceLabel = 'recent') {
  if (!server) return 0;
  const arr = Array.isArray(trades) ? trades : [];
  if (!arr.length) {
    if (sourceLabel) console.log(`[trades:${server.label}] No trades from ${sourceLabel}.`);
    return 0;
  }

  const db = ensureDb(server.id);
  let inserted = 0;

  const insertTradeStmt = db.prepare(`INSERT OR IGNORE INTO completed_trades (
      id, fsmType, pair, srcExchange, dstExchange, status, user,
      estimatedProfitNormalized, estimatedProfit, estimatedGrossProfit, eta,
      estimatedSrcPrice, estimatedDstPrice, estimatedQty,
      executedProfitNormalized, executedProfit, executedGrossProfit, executedTime,
      executedSrcPrice, executedDstPrice, executedQtySrc, executedQtyDst,
      executedFeeTotal, executedFeePercent, props, creationTime, openTime, lastUpdateTime,
      nwId, txFee, calculatedVolume, conveyedVolume, commissionPercent, hedge, raw_data
    ) VALUES (
      @id, @fsmType, @pair, @srcExchange, @dstExchange, @status, @user,
      @estimatedProfitNormalized, @estimatedProfit, @estimatedGrossProfit, @eta,
      @estimatedSrcPrice, @estimatedDstPrice, @estimatedQty,
      @executedProfitNormalized, @executedProfit, @executedGrossProfit, @executedTime,
      @executedSrcPrice, @executedDstPrice, @executedQtySrc, @executedQtyDst,
      @executedFeeTotal, @executedFeePercent, @props, @creationTime, @openTime, @lastUpdateTime,
      @nwId, @txFee, @calculatedVolume, @conveyedVolume, @commissionPercent, @hedge, @raw_data
    )`);

  const insert = db.transaction((items) => {
    for (const t of items) {
      const normProps = normalizePropsRaw(t.props);
      const row = {
        id: t.id,
        fsmType: t.fsmType ?? null,
        pair: t.pair ?? null,
        srcExchange: t.srcExchange ?? null,
        dstExchange: t.dstExchange ?? null,
        status: t.status ?? null,
        user: t.user ?? null,
        estimatedProfitNormalized: safeNumber(t.estimatedProfitNormalized),
        estimatedProfit: safeNumber(t.estimatedProfit),
        estimatedGrossProfit: safeNumber(t.estimatedGrossProfit),
        eta: t.eta == null ? null : String(t.eta),
        estimatedSrcPrice: safeNumber(t.estimatedSrcPrice),
        estimatedDstPrice: safeNumber(t.estimatedDstPrice),
        estimatedQty: safeNumber(t.estimatedQty),
        executedProfitNormalized: safeNumber(t.executedProfitNormalized),
        executedProfit: safeNumber(t.executedProfit),
        executedGrossProfit: safeNumber(t.executedGrossProfit),
        executedTime: t.executedTime != null ? parseInt(t.executedTime) : null,
        executedSrcPrice: safeNumber(t.executedSrcPrice),
        executedDstPrice: safeNumber(t.executedDstPrice),
        executedQtySrc: safeNumber(t.executedQtySrc),
        executedQtyDst: safeNumber(t.executedQtyDst),
        executedFeeTotal: safeNumber(t.executedFeeTotal),
        executedFeePercent: safeNumber(t.executedFeePercent),
        props: Object.keys(normProps).length ? JSON.stringify(normProps) : (t.props == null ? null : String(t.props)),
        creationTime: t.creationTime != null ? parseInt(t.creationTime) : null,
        openTime: t.openTime != null ? parseInt(t.openTime) : null,
        lastUpdateTime: t.lastUpdateTime != null ? parseInt(t.lastUpdateTime) : null,
        nwId: t.nwId == null ? null : String(t.nwId),
        txFee: safeNumber(t.txFee),
        calculatedVolume: safeNumber(t.calculatedVolume),
        conveyedVolume: safeNumber(t.conveyedVolume),
        commissionPercent: safeNumber(t.commissionPercent),
        hedge: t.hedge === true ? 1 : t.hedge === false ? 0 : null,
        raw_data: JSON.stringify(t)
      };
      const info = insertTradeStmt.run(row);
      if (info.changes > 0) inserted += 1;
    }
  });

  insert(arr);
  console.log(`[trades:${server.label}] Inserted new trades${sourceLabel ? ` (${sourceLabel})` : ''}: ${inserted}/${arr.length}`);
  return inserted;
}

async function fetchTradesAndStoreFor(server) {
  if (!server) return;
  try {
    const url = server.baseUrl + (server.completedPath || '/completed');
    const resp = await axios.get(url, { timeout: 20000 });
    const arr = Array.isArray(resp.data) ? resp.data : [];
    storeCompletedTrades(server, arr, 'delta');
  } catch (err) {
    console.error(`[trades:${server?.label}] Fetch/store error:`, err.message);
  }
}

async function fetchAllTradesAndStoreFor(server) {
  if (!server) return false;
  try {
    const url = server.baseUrl + (server.completedAllPath || '/completedall');
    const resp = await axios.get(url, { timeout: 60000 });
    const arr = Array.isArray(resp.data) ? resp.data : [];
    storeCompletedTrades(server, arr, 'bootstrap');
    return true;
  } catch (err) {
    console.error(`[trades:${server?.label}] Fetch/store (completedall) error:`, err.message);
    return false;
  }
}

async function fetchStatusAndStoreFor(server) {
  if (!server) return;
  try {
    const serverIp = server.baseUrl.split(':')[1].substring(2);
    const resp = await axios.get(`http://${serverIp}:3001/`, { timeout: 10000 });
    const text = resp.data;
    if (typeof text !== 'string') return;

    const timestamp = new Date().toISOString();
    const db = ensureDb(server.id);

    // Parse and store tokens
    const sdiffLine = text.split(/\r?\n/).find(l => l.startsWith('SDIFF_Uniswap_ckhvar2'));
    if (sdiffLine) {
      const propsIndex = sdiffLine.indexOf('Mindiff:');
      const propsStr = propsIndex > -1 ? sdiffLine.substring(propsIndex) : '';
      const tokens = propsStr.match(/\w+\([\d.]+,[\d.]+\)/g)?.map(t => {
        const [name, values] = t.split('(');
        const [buy, sell] = values.slice(0, -1).split(',');
        return { name, buy: safeNumber(buy), sell: safeNumber(sell) };
      });

      if (tokens && tokens.length) {
        const stmt = db.prepare('INSERT INTO server_tokens (timestamp, name, buy, sell) VALUES (@timestamp, @name, @buy, @sell)');
        db.transaction((items) => {
          for (const item of items) stmt.run({ timestamp, ...item });
        })(tokens);
        console.log(`[status:${server.label}] Stored ${tokens.length} tokens.`);
      }
    }

    // Parse and store gas balances
    const blacklistLine = text.split(/\r?\n/).find(l => l.startsWith('SDIFF Uniswap BlackList:'));
    if (blacklistLine) {
      const str = blacklistLine.replace('SDIFF Uniswap BlackList:', '').trim();
      const gasBalances = str.split(',').map(item => item.trim()).filter(Boolean).map(item => {
        const [key, value] = item.split(':');
        if (key && value !== undefined) {
          const valNum = parseFloat(value);
          return { contract: key, gas: valNum, is_low: valNum < 2 ? 1 : 0 };
        }
        return null;
      }).filter(Boolean);

      if (gasBalances && gasBalances.length) {
        const stmt = db.prepare('INSERT INTO gas_balances (timestamp, contract, gas, is_low) VALUES (@timestamp, @contract, @gas, @is_low)');
        db.transaction((items) => {
          for (const item of items) stmt.run({ timestamp, ...item });
        })(gasBalances);
        console.log(`[status:${server.label}] Stored ${gasBalances.length} gas balances.`);
      }
    }
  } catch (err) {
    console.error(`[status:${server?.label}] Fetch/store error:`, err.message);
  }
}

async function ensureInitialTradesSync(server) {
  if (!server) return;
  if (initialTradesSynced.has(server.id)) return;
  const ok = await fetchAllTradesAndStoreFor(server);
  if (ok) initialTradesSynced.add(server.id);
}

async function fetchAllAndStore() {
  const cfg = loadServers();
  for (const s of cfg.servers) {
    await ensureInitialTradesSync(s);
    // Fetch status first to ensure it's processed before other data
    await fetchStatusAndStoreFor(s);
    // Then fetch balances and trades in parallel
    await Promise.allSettled([fetchBalancesAndStoreFor(s), fetchTradesAndStoreFor(s), fetchDiffDataAndStoreFor(s)]);
  }
}

// Schedule: every 2 minutes
cron.schedule('*/2 * * * *', () => {
  console.log('[cron] Running scheduled fetch...');
  fetchAllAndStore();
});

// Kick off initial fetch on startup (non-blocking)
fetchAllAndStore();

app.get('/trades/history', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const token = req.query.token;
    const curId = req.query.curId;
    let startTime = req.query.startTime != null && req.query.startTime !== '' ? Number(req.query.startTime) : null;
    let endTime = req.query.endTime != null && req.query.endTime !== '' ? Number(req.query.endTime) : null;
    let minNetProfit = req.query.minNetProfit != null && req.query.minNetProfit !== '' ? Number(req.query.minNetProfit) : null;
    let maxNetProfit = req.query.maxNetProfit != null && req.query.maxNetProfit !== '' ? Number(req.query.maxNetProfit) : null;

    if (!Number.isFinite(startTime)) startTime = null;
    if (!Number.isFinite(endTime)) endTime = null;
    if (!Number.isFinite(minNetProfit)) minNetProfit = null;
    if (!Number.isFinite(maxNetProfit)) maxNetProfit = null;

    if (!token && !curId) {
      return res.status(400).json({ error: 'token or curId parameter is required' });
    }

    let query = 'SELECT id, lastUpdateTime, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, props, raw_data FROM completed_trades';
    const clauses = [];
    const params = [];

    if (token) {
      clauses.push('pair LIKE ?');
      params.push(`%${token}%`);
    }

    if (startTime != null && endTime != null) {
      clauses.push('lastUpdateTime BETWEEN ? AND ?');
      params.push(startTime, endTime);
    }

    if (clauses.length) {
      query += ' WHERE ' + clauses.join(' AND ');
    }

    const trades = db.prepare(query).all(params);
    console.log(`[api:/trades/history] params token=${token || 'none'} curId=${curId || 'none'} start=${startTime ?? 'none'} end=${endTime ?? 'none'} fetched=${trades.length}`);

    let filteredTrades = trades;
    if (curId) {
      const matching = [];
      const nonMatchingSamples = [];
      for (const trade of trades) {
        if (tradeHasCurId(trade, curId)) {
          matching.push(trade);
        } else if (nonMatchingSamples.length < 5) {
          const parsedProps = safeJsonParse(trade.props, {});
          const rawProps = getTradeRawProps(trade);
          nonMatchingSamples.push({
            id: trade.id,
            lastUpdateTime: trade.lastUpdateTime,
            propsKeys: parsedProps && typeof parsedProps === 'object' ? Object.keys(parsedProps) : [],
            rawPropsKeys: rawProps && typeof rawProps === 'object' ? Object.keys(rawProps) : []
          });
        }
      }
      console.log(`[api:/trades/history] curId=${curId} matches=${matching.length}`);
      if (!matching.length && nonMatchingSamples.length) {
        console.log('[api:/trades/history] sample non-matching trades:', nonMatchingSamples);
      }
      filteredTrades = matching;
    } else {
      console.log(`[api:/trades/history] no curId filter applied; using ${filteredTrades.length} trades`);
    }

    const tradesWithNetProfit = filteredTrades.map(t => {
      const netProfit = (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
      const rawProps = getTradeRawProps(t);
      const rawPropsStr = rawProps == null ? null : (typeof rawProps === 'string' ? rawProps : JSON.stringify(rawProps));
      return {
        lastUpdateTime: t.lastUpdateTime,
        netProfit: netProfit,
        props: t.props,
        rawProps: rawPropsStr
      };
    });

    const tradesFilteredByProfit = tradesWithNetProfit.filter(t => {
      if (minNetProfit !== null && t.netProfit < minNetProfit) {
        return false;
      }
      if (maxNetProfit !== null && t.netProfit > maxNetProfit) {
        return false;
      }
      return true;
    });

    console.log(`[api:/trades/history] returning ${tradesFilteredByProfit.length} trades after profit filter`);
    res.json(tradesFilteredByProfit);
  } catch (err) {
    console.error('[api:/trades/history] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/diffdata/tokens', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const rows = db.prepare('SELECT DISTINCT curId FROM diff_history ORDER BY curId').all();
    res.json(rows.map(r => r.curId));
  } catch (err) {
    console.error('[api:/diffdata/tokens] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/diffdata/history', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const curId = req.query.curId;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 5000, 5000));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const minBuyDiffBps = req.query.minBuyDiffBps ? parseFloat(req.query.minBuyDiffBps) : null;
    const maxBuyDiffBps = req.query.maxBuyDiffBps ? parseFloat(req.query.maxBuyDiffBps) : null;
    const minSellDiffBps = req.query.minSellDiffBps ? parseFloat(req.query.minSellDiffBps) : null;
    const maxSellDiffBps = req.query.maxSellDiffBps ? parseFloat(req.query.maxSellDiffBps) : null;

    if (!curId) {
      return res.status(400).json({ error: 'curId parameter is required' });
    }

    let query = 'SELECT curId, ts, buyDiffBps, sellDiffBps, cexVol, serverBuy, serverSell, dexVolume, rejectReason FROM diff_history WHERE curId = ?';
    const params = [curId];

    if (minBuyDiffBps !== null) {
      query += ' AND buyDiffBps >= ?';
      params.push(minBuyDiffBps);
    }
    if (maxBuyDiffBps !== null) {
      query += ' AND buyDiffBps <= ?';
      params.push(maxBuyDiffBps);
    }
    if (minSellDiffBps !== null) {
      query += ' AND sellDiffBps >= ?';
      params.push(minSellDiffBps);
    }
    if (maxSellDiffBps !== null) {
      query += ' AND sellDiffBps <= ?';
      params.push(maxSellDiffBps);
    }

    query += ' ORDER BY ts DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const diffRows = db.prepare(query).all(params);

    const tokenName = tokenNameFromCurId(curId);
    const serverTokenStmt = db.prepare('SELECT buy, sell FROM server_tokens WHERE name = ? ORDER BY timestamp DESC LIMIT 1');
    let serverToken = tokenName ? serverTokenStmt.get(tokenName) : null;
    if (!serverToken && tokenName) {
      const upper = tokenName.toUpperCase();
      if (upper !== tokenName) serverToken = serverTokenStmt.get(upper);
    }
    if (!serverToken && tokenName) {
      const lower = tokenName.toLowerCase();
      if (lower !== tokenName) serverToken = serverTokenStmt.get(lower);
    }

    const normalizedRows = diffRows.reverse().map((row) => {
      const ts = Number(row.ts);
      const buy = row.serverBuy != null ? safeNumber(row.serverBuy) : null;
      const sell = row.serverSell != null ? safeNumber(row.serverSell) : null;
      const dexVolume = row.dexVolume != null ? safeNumber(row.dexVolume) : null;
      const cexVol = safeNumber(row.cexVol);
      const normalized = {
        curId: row.curId,
        ts: Number.isFinite(ts) ? ts : null,
        buyDiffBps: safeNumber(row.buyDiffBps),
        sellDiffBps: safeNumber(row.sellDiffBps),
        cexVol,
        serverBuy: buy,
        serverSell: sell,
        dexVolume,
        rejectReason: row.rejectReason == null ? null : String(row.rejectReason),
      };
      if (normalized.serverBuy == null && serverToken?.buy != null) {
        normalized.serverBuy = safeNumber(serverToken.buy);
      }
      if (normalized.serverSell == null && serverToken?.sell != null) {
        normalized.serverSell = safeNumber(serverToken.sell);
      }
      return normalized;
    });

    const normalizedServerToken = serverToken ? {
      buy: safeNumber(serverToken.buy),
      sell: safeNumber(serverToken.sell),
    } : null;

    res.json({
      diffData: normalizedRows,
      serverToken: normalizedServerToken
    });
  } catch (err) {
    console.error('[api:/diffdata/history] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API Endpoints
function getDbFromReq(req) {
  const serverId = req.query.serverId || loadServers().activeId;
  return ensureDb(serverId);
}

app.get('/balances', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const row = db.prepare(
      'SELECT timestamp, total_usdt, total_coin FROM balances_history ORDER BY id DESC LIMIT 1'
    ).get();
    if (!row) return res.status(404).json({ error: 'No balance data yet' });
    res.json(row);
  } catch (err) {
    console.error('[api:/balances] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/balances/history', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 500, 5000));
    const beforeTimestamp = req.query.before_timestamp; // New parameter
    const db = getDbFromReq(req);

    let query = 'SELECT timestamp, total_usdt, total_coin, raw_data FROM balances_history';
    const params = [];

    if (beforeTimestamp) {
      query += ' WHERE timestamp < ?';
      params.push(beforeTimestamp);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(params);

    // Reverse the order to send oldest first, as expected by Chart.js
    const sortedRows = rows.reverse();

    const enriched = sortedRows.map(r => {
      let snapshot;
      try { snapshot = JSON.parse(r.raw_data); } catch { snapshot = null; }
      const parts = computeDexCex(snapshot);
      // Keep legacy total_usdt if combined is not computable
      const combined = Number.isFinite(parts.combined) && parts.combined !== 0 ? parts.combined : r.total_usdt;
      return {
        timestamp: r.timestamp,
        total_usdt: combined,
        total_dex_usdt: parts.dexTotal,
        total_cex_usdt: parts.cexTotal
      };
    });
    res.json(enriched);
  } catch (err) {
    console.error('[api:/balances/history] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detailed per-exchange balances derived from the latest stored snapshot
app.get('/balances/exchanges', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const row = db.prepare(
      'SELECT timestamp, raw_data FROM balances_history ORDER BY id DESC LIMIT 1'
    ).get();
    if (!row) return res.status(404).json({ error: 'No balance data yet' });

    let snapshot;
    try {
      snapshot = JSON.parse(row.raw_data);
    } catch (_) {
      return res.status(500).json({ error: 'Corrupt balance snapshot' });
    }

    const result = { timestamp: row.timestamp, dex: [], cex: null };

    // DEX example: Uniswap_BEP20
    for (const [exName, ex] of Object.entries(snapshot || {})) {
      if (!ex || typeof ex !== 'object') continue;
      if (exName === 'BinanceF') continue; // handled in CEX section

      // Only include if it looks like a DEX style with balanceMap
      if (ex.balanceMap && (ex.usdtVal != null || ex.coinVal != null)) {
        const tokens = [];
        for (const b of Object.values(ex.balanceMap)) {
          if (!b || typeof b !== 'object') continue;
          const total = Number(b.total) || 0;
          const totalUsdt = Number(b.totalUsdt) || 0;
          if (totalUsdt > 0.1) {
            tokens.push({ currency: String(b.currency || ''), total, totalUsdt });
          }
        }
        // Sort desc by USDT value
        tokens.sort((a, b) => b.totalUsdt - a.totalUsdt);
        const totalUSDT = Number(ex.coinVal) || 0;
        result.dex.push({ exchange: exName, totalUSDT, tokens });
      }
    }

    // CEX: BinanceF calculation
    const binanceF = snapshot?.BinanceF;
    if (binanceF && binanceF.balanceMap) {
      const tokens = [];
      let usdtTotal = 0;
      let unrealizedSum = 0;
      for (const b of Object.values(binanceF.balanceMap)) {
        if (!b || typeof b !== 'object') continue;
        const currency = String(b.currency || '');
        const total = Number(b.total) || 0;
        const lev = Number(b.leverage) || 1;
        const entry = Number(b.entryPrice) || 0;
        const uPnL = Number(b.unrealizedProfit) || 0;
        let usdtValue;
        let totalUsdt;
        if (currency.toLowerCase() === 'usdt') {
          usdtValue = total;
          usdtTotal += total;
          totalUsdt = total;
        } else {
          usdtValue = (entry * total) / (lev || 1) + uPnL;
          unrealizedSum += uPnL;
          totalUsdt = b.total * b.entryPrice;
        }
        const available = Number(b.available) || 0;
        if (Math.abs(usdtValue) > 0.1) {
          tokens.push({ currency, total, available, usdtValue, totalUsdt, leverage: lev, entryPrice: entry, unrealizedProfit: uPnL });
        }
      }
      tokens.sort((a, b) => (b.usdtValue || 0) - (a.usdtValue || 0));
      const totalUSDT = Number(binanceF.usdtVal) || 0;
      result.cex = { exchange: 'BinanceF', totalUSDT, tokens, unrealizedSum, usdtTotal };
    }

    // DEX vs CEX Comparison
    const comparison = [];
    if (result.dex.length && result.cex) {
      const cexTokens = new Map(result.cex.tokens.map(t => [t.currency.split('/')[0], t]));
      for (const dex of result.dex) {
        for (const token of dex.tokens) {
          const dexTokenName = token.currency.split('_')[1];
          if (cexTokens.has(dexTokenName)) {
            const cexToken = cexTokens.get(dexTokenName);
            const difference = token.totalUsdt - cexToken.totalUsdt;
            comparison.push({ 
              token: dexTokenName, 
              dexTotalUsdt: token.totalUsdt, 
              cexTotalUsdt: cexToken.totalUsdt, 
              difference 
            });
          }
        }
      }
    }
    result.comparison = comparison.filter(c => c.token !== 'usdt' && c.token !== 'usdc');

    res.json(result);
  } catch (err) {
    console.error('[api:/balances/exchanges] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/trades', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 1000, 10000));
    const pair = req.query.pair ? String(req.query.pair) : null;
    const db = getDbFromReq(req);
    let rows;
    if (pair) {
      rows = db.prepare(
        'SELECT * FROM completed_trades WHERE pair = ? ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT ?'
      ).all(pair, limit);
    } else {
      rows = db.prepare(
        'SELECT * FROM completed_trades ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT ?'
      ).all(limit);
    }
    res.json(rows);
  } catch (err) {
    console.error('[api:/trades] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Distinct pairs for UI filters
app.get('/trades/pairs', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const rows = db.prepare(
      `SELECT pair, COUNT(*) AS cnt
       FROM completed_trades
       WHERE pair IS NOT NULL AND TRIM(pair) <> ''
       GROUP BY pair
       ORDER BY cnt DESC, pair ASC
       LIMIT 2000`
    ).all();
    res.json(rows.map(r => r.pair));
  } catch (err) {
    console.error('[api:/trades/pairs] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Aggregated analytics per pair (profit/loss, win rate, feature means)
app.get('/trades/analytics/pairs', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 5000, 20000));
    const db = getDbFromReq(req);
    const rows = db.prepare(
      "SELECT pair, executedGrossProfit, executedTime, executedSrcPrice, executedQtySrc, executedQtyDst, executedDstPrice, props, raw_data FROM completed_trades ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT ?"
    ).all(limit);

    const m = new Map();
    for (const r of rows) {
      const pair = r.pair;
      if (!m.has(pair)) {
        m.set(pair, {
          pair,
          trades: 0,
          wins: 0,
          losses: 0,
          totalGrossProfit: 0,
          totalNetProfit: 0,
          sumProfitPos: 0,
          sumProfitNeg: 0,
          sumExecTime: 0,
          sumQty: 0,
          // props feature sums overall and split by win/loss
          sums: { Diff: 0, DexSlip: 0, CexSlip: 0 },
          sumsPos: { Diff: 0, DexSlip: 0, CexSlip: 0 },
          sumsNeg: { Diff: 0, DexSlip: 0, CexSlip: 0 },
          cnts: { Diff: 0, DexSlip: 0, CexSlip: 0 },
          cntsPos: { Diff: 0, DexSlip: 0, CexSlip: 0 },
          cntsNeg: { Diff: 0, DexSlip: 0, CexSlip: 0 },
        });
      }
      const rec = m.get(pair);
      const gp = Number(r.executedGrossProfit) || 0;
      const netProfit = (r.executedQtyDst * r.executedDstPrice) - (r.executedSrcPrice * r.executedQtySrc) - (0.0002 * r.executedQtyDst * r.executedDstPrice);
      const execTime = Number(r.executedTime) || 0;
      const qty = (Number(r.executedSrcPrice) || 0) * (Number(r.executedQtySrc) || 0);
      const props = normalizePropsRaw(r.props);
      const diff = Number(props.Diff);
      const dexSlip = Number(props.DexSlip);
      const cexSlip = Number(props.CexSlip);

      rec.trades += 1;
      rec.totalGrossProfit += gp;
      rec.totalNetProfit += netProfit;
      rec.sumExecTime += execTime;
      rec.sumQty += qty;
      if (gp > 0) { rec.wins += 1; rec.sumProfitPos += gp; }
      else if (gp < 0) { rec.losses += 1; rec.sumProfitNeg += gp; }

      if (Number.isFinite(diff)) { rec.sums.Diff += diff; rec.cnts.Diff++; if (gp>0) {rec.sumsPos.Diff+=diff; rec.cntsPos.Diff++;} else if (gp<0){rec.sumsNeg.Diff+=diff; rec.cntsNeg.Diff++;} }
      if (Number.isFinite(dexSlip)) { rec.sums.DexSlip += dexSlip; rec.cnts.DexSlip++; if (gp>0) {rec.sumsPos.DexSlip+=dexSlip; rec.cntsPos.DexSlip++;} else if (gp<0){rec.sumsNeg.DexSlip+=dexSlip; rec.cntsNeg.DexSlip++;} }
      if (Number.isFinite(cexSlip)) { rec.sums.CexSlip += cexSlip; rec.cnts.CexSlip++; if (gp>0) {rec.sumsPos.CexSlip+=cexSlip; rec.cntsPos.CexSlip++;} else if (gp<0){rec.sumsNeg.CexSlip+=cexSlip; rec.cntsNeg.CexSlip++;} }
    }

    const result = Array.from(m.values()).map(r => {
      const avg = (sum, cnt) => (cnt > 0 ? sum / cnt : null);
      const trades = r.trades || 1;
      return {
        pair: r.pair,
        trades: r.trades,
        wins: r.wins,
        losses: r.losses,
        winRate: r.trades ? r.wins / r.trades : null,
        totalGrossProfit: r.totalGrossProfit,
        totalNetProfit: r.totalNetProfit,
        avgGrossProfit: r.totalGrossProfit / trades,
        avgNetProfit: r.totalNetProfit / trades,
        sumProfitPos: r.sumProfitPos,
        sumProfitNeg: r.sumProfitNeg,
        avgExecTime: r.sumExecTime / trades,
        avgQty: r.sumQty / trades,
        features: {
          Diff: { avg: avg(r.sums.Diff, r.cnts.Diff), avgWin: avg(r.sumsPos.Diff, r.cntsPos.Diff), avgLoss: avg(r.sumsNeg.Diff, r.cntsNeg.Diff) },
          DexSlip: { avg: avg(r.sums.DexSlip, r.cnts.DexSlip), avgWin: avg(r.sumsPos.DexSlip, r.cntsPos.DexSlip), avgLoss: avg(r.sumsNeg.DexSlip, r.cntsNeg.DexSlip) },
          CexSlip: { avg: avg(r.sums.CexSlip, r.cnts.CexSlip), avgWin: avg(r.sumsPos.CexSlip, r.cntsPos.CexSlip), avgLoss: avg(r.sumsNeg.CexSlip, r.cntsNeg.CexSlip) }
        }
      };
    });

    // Sort helpers
    const topWinners = [...result].sort((a,b)=> (b.totalNetProfit)-(a.totalNetProfit)).slice(0,50);
    const topLosers = [...result].sort((a,b)=> (a.totalNetProfit)-(b.totalNetProfit)).slice(0,50);

    res.json({ generatedAt: new Date().toISOString(), limit, totalPairs: result.length, topWinners, topLosers, pairs: result });
  } catch (err) {
    console.error('[api:/trades/analytics/pairs] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/trades/analytics/tokens', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 5000, 20000));
    const db = getDbFromReq(req);
    const rows = db.prepare(
      "SELECT pair, executedGrossProfit, executedTime, executedSrcPrice, executedQtySrc, executedQtyDst, executedDstPrice, props, raw_data FROM completed_trades ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT ?"
    ).all(limit);

    const metrics = aggregateTokenMetrics(rows);

    const result = Array.from(metrics.values()).map(r => ({
      token: r.token,
      trades: r.trades,
      wins: r.wins,
      losses: r.losses,
      totalGrossProfit: r.totalGrossProfit,
      totalNetProfit: r.totalNetProfit,
      winRate: r.trades ? r.wins / r.trades : null,
      avgNetProfit: r.trades ? r.totalNetProfit / r.trades : null,
      avgCexSlip: r.countCexSlip > 0 ? r.sumCexSlip / r.countCexSlip : null,
      avgDexSlip: r.countDexSlip > 0 ? r.sumDexSlip / r.countDexSlip : null,
      avgDiff: r.countDiff > 0 ? r.sumDiff / r.countDiff : null,
    }));

    const topWinners = [...result].sort((a, b) => (b.totalNetProfit) - (a.totalNetProfit)).slice(0, 50);
    const topLosers = [...result].sort((a, b) => (a.totalNetProfit) - (b.totalNetProfit)).slice(0, 50);

    res.json({ generatedAt: new Date().toISOString(), limit, totalTokens: result.length, topWinners, topLosers, tokens: result });
  } catch (err) {
    console.error('[api:/trades/analytics/tokens] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/trades/:id', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const id = req.params.id;
    const stmt = db.prepare('DELETE FROM completed_trades WHERE id = ?');
    const info = stmt.run(id);

    if (info.changes > 0) {
      res.status(200).json({ success: true, message: 'Trade deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Trade not found' });
    }
  } catch (err) {
    console.error('[api:/trades/:id] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/analysis/server-tokens', async (req, res) => {
  try {
    const db = getDbFromReq(req);

    // 1. Get latest buy/sell for each token
    const tokenData = db.prepare(`
      SELECT name, buy, sell
      FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY name ORDER BY timestamp DESC) as rn
        FROM server_tokens
      )
      WHERE rn = 1
    `).all();
    const tokenMap = new Map(tokenData.map(t => [t.name.toLowerCase(), t]));

    // 2. Aggregate profit data from completed trades
    const tradeRows = db.prepare(
      "SELECT executedGrossProfit, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, props, raw_data FROM completed_trades"
    ).all();

    const metrics = aggregateTokenMetrics(tradeRows);

    const result = Array.from(metrics.values()).map(r => {
      const symbol = tokenSymbolFromCurId(r.token);
      const tokenInfo = symbol ? tokenMap.get((symbol || '').toLowerCase()) : null;
      return {
        token: r.token,
        buy: tokenInfo?.buy ?? null,
        sell: tokenInfo?.sell ?? null,
        totalNetProfit: r.totalNetProfit,
        trades: r.trades,
      };
    });

    res.json(result);

  } catch (err) {
    console.error('[api:/analysis/server-tokens] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/analysis/token-time-patterns', (req, res) => {
  try {
    const token = req.query.token ? String(req.query.token) : null;
    if (!token) {
      return res.status(400).json({ error: 'Token parameter is required' });
    }

    const targetDateStr = req.query.targetDate;
    const targetDate = targetDateStr ? new Date(targetDateStr) : new Date();
    targetDate.setUTCHours(0, 0, 0, 0);

    // Calculate date ranges for the request
    const dayStartTs = targetDate.getTime();
    const dayEndTs = dayStartTs + (24 * 60 * 60 * 1000) - 1;

    const dayOfWeek = targetDate.getUTCDay(); // 0=Sun
    const weekStart = new Date(targetDate);
    weekStart.setUTCDate(targetDate.getUTCDate() - dayOfWeek);
    const weekStartTs = weekStart.getTime();
    const weekEndTs = weekStartTs + (7 * 24 * 60 * 60 * 1000) - 1;

    const db = getDbFromReq(req);

    // Fetch all trades for the relevant week
    const tradeRows = db.prepare(
      "SELECT executedGrossProfit, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, lastUpdateTime, creationTime, props, raw_data FROM completed_trades WHERE COALESCE(lastUpdateTime, creationTime) BETWEEN ? AND ?"
    ).all(weekStartTs, weekEndTs);

    const byHour = Array(24).fill(0).map((_, i) => ({ hour: i, netProfit: 0, sumCexSlip: 0, countCexSlip: 0, sumDexSlip: 0, countDexSlip: 0 }));
    const byDay = Array(7).fill(0).map((_, i) => ({ day: i, netProfit: 0, sumCexSlip: 0, countCexSlip: 0, sumDexSlip: 0, countDexSlip: 0 }));

    for (const r of tradeRows) {
      const tokens = extractTokensFromTrade(r);
      if (tokens.includes(token)) {
        const timestamp = r.lastUpdateTime || r.creationTime;
        if (!timestamp) continue;

        const date = new Date(timestamp);
        const props = normalizePropsRaw(r.props);
        const netProfit = (r.executedQtyDst * r.executedDstPrice) - (r.executedSrcPrice * r.executedQtySrc) - (0.0002 * r.executedQtyDst * r.executedDstPrice);

        // Accumulate for Day of Week chart (all trades in the week)
        const day = date.getUTCDay();
        if (day >= 0 && day < 7) {
            if (Number.isFinite(netProfit)) byDay[day].netProfit += netProfit;
            if (Number.isFinite(props.CexSlip)) { byDay[day].sumCexSlip += props.CexSlip; byDay[day].countCexSlip++; }
            if (Number.isFinite(props.DexSlip)) { byDay[day].sumDexSlip += props.DexSlip; byDay[day].countDexSlip++; }
        }

        // Accumulate for Hour of Day chart (only trades on the targetDate)
        if (timestamp >= dayStartTs && timestamp <= dayEndTs) {
            const hour = date.getUTCHours();
            if (hour >= 0 && hour < 24) {
                if (Number.isFinite(netProfit)) byHour[hour].netProfit += netProfit;
                if (Number.isFinite(props.CexSlip)) { byHour[hour].sumCexSlip += props.CexSlip; byHour[hour].countCexSlip++; }
                if (Number.isFinite(props.DexSlip)) { byHour[hour].sumDexSlip += props.DexSlip; byHour[hour].countDexSlip++; }
            }
        }
      }
    }

    const finalByHour = byHour.map(h => ({
        hour: h.hour,
        netProfit: h.netProfit,
        avgCexSlip: h.countCexSlip > 0 ? h.sumCexSlip / h.countCexSlip : null,
        avgDexSlip: h.countDexSlip > 0 ? h.sumDexSlip / h.countDexSlip : null,
    }));

    const finalByDay = byDay.map(d => ({
        day: d.day,
        netProfit: d.netProfit,
        avgCexSlip: d.countCexSlip > 0 ? d.sumCexSlip / d.countCexSlip : null,
        avgDexSlip: d.countDexSlip > 0 ? d.sumDexSlip / d.countDexSlip : null,
    }));

    res.json({ byHour: finalByHour, byDay: finalByDay, dateRange: { day: targetDate.toISOString().split('T')[0], weekStart: weekStart.toISOString().split('T')[0], weekEnd: new Date(weekEndTs).toISOString().split('T')[0] } });

  } catch (err) {
    console.error('[api:/analysis/token-time-patterns] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/analysis/token-time-series', (req, res) => {
  try {
    const token = req.query.token ? String(req.query.token) : null;
    if (!token) {
      return res.status(400).json({ error: 'Token parameter is required' });
    }

    const db = getDbFromReq(req);

    // 1. Get time-bucketed profits
    const tradeRows = db.prepare(
      "SELECT executedGrossProfit, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, lastUpdateTime, creationTime, props, raw_data FROM completed_trades"
    ).all();

    const profitByHour = new Map();
    for (const r of tradeRows) {
      const tokens = extractTokensFromTrade(r);
      if (tokens.includes(token)) {
        const timestamp = r.lastUpdateTime || r.creationTime;
        if (!timestamp) continue;

        const hour = new Date(timestamp);
        hour.setMinutes(0, 0, 0);

        const netProfit = (r.executedQtyDst * r.executedDstPrice) - (r.executedSrcPrice * r.executedQtySrc) - (0.0002 * r.executedQtyDst * r.executedDstPrice);
        if (!Number.isFinite(netProfit)) continue;

        const hourKey = hour.toISOString();
        profitByHour.set(hourKey, (profitByHour.get(hourKey) || 0) + netProfit);
      }
    }

    // 2. Get time-bucketed buy/sell
    const tokenSymbol = tokenSymbolFromCurId(token);
    const tokenRows = tokenSymbol
      ? db.prepare("SELECT timestamp, buy, sell FROM server_tokens WHERE lower(name) = ?").all(tokenSymbol.toLowerCase())
      : [];

    const buySellByHour = new Map();
    for (const r of tokenRows) {
        const hour = new Date(r.timestamp);
        hour.setMinutes(0, 0, 0);
        const hourKey = hour.toISOString();

        if (!buySellByHour.has(hourKey)) {
            buySellByHour.set(hourKey, { buys: [], sells: [] });
        }
        buySellByHour.get(hourKey).buys.push(r.buy);
        buySellByHour.get(hourKey).sells.push(r.sell);
    }

    // 3. Combine into a single time series
    const allHours = new Set([...profitByHour.keys(), ...buySellByHour.keys()]);
    const sortedHours = Array.from(allHours).sort();

    const result = sortedHours.map(hour => {
        const buySellData = buySellByHour.get(hour);
        let avgBuy = null;
        let avgSell = null;
        if (buySellData) {
            avgBuy = buySellData.buys.reduce((a, b) => a + b, 0) / buySellData.buys.length;
            avgSell = buySellData.sells.reduce((a, b) => a + b, 0) / buySellData.sells.length;
        }

        return {
            timestamp: hour,
            netProfit: profitByHour.get(hour) || 0,
            avgBuy,
            avgSell,
        };
    });

    res.json(result);

  } catch (err) {
    console.error('[api:/analysis/token-time-series] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Server configuration APIs
app.get('/servers', (req, res) => { res.json(loadServers()); });
app.get('/servers/active', (req, res) => { res.json(getActiveServer()); });
app.post('/servers', (req, res) => {
  try {
    const { label, baseUrl, balancesPath = '/balance', completedPath = '/completed', contractAddress, explorerSite, explorerApiBase, explorerApiKey, chainId, id } = req.body || {};
    if (!label || !baseUrl) return res.status(400).json({ error: 'label and baseUrl required' });

    let parsedChainId;
    if (chainId !== undefined && chainId !== null && String(chainId).trim() !== '') {
      const n = Number(chainId);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'chainId must be a number' });
      parsedChainId = n;
    }

    const cfg = loadServers();
    const newId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString(36);
    const entry = { id: newId, label, baseUrl, balancesPath, completedPath, contractAddress, explorerSite, explorerApiBase, explorerApiKey };
    if (parsedChainId !== undefined) entry.chainId = parsedChainId;
    cfg.servers.push(entry);
    if (!cfg.activeId) cfg.activeId = newId;
    saveServers(cfg);
    res.json({ ok: true, id: newId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/servers/:id', (req, res) => {
  try {
    const cfg = loadServers();
    const i = cfg.servers.findIndex(s => s.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'not found' });
    const s = cfg.servers[i];
    const { label, baseUrl, balancesPath, completedPath, contractAddress, explorerSite, explorerApiBase, explorerApiKey, chainId } = req.body || {};
    if (label != null) s.label = label;
    if (baseUrl != null) s.baseUrl = baseUrl;
    if (balancesPath != null) s.balancesPath = balancesPath;
    if (completedPath != null) s.completedPath = completedPath;
    if (contractAddress != null) s.contractAddress = contractAddress;
    if (explorerSite != null) s.explorerSite = explorerSite;
    if (explorerApiBase != null) s.explorerApiBase = explorerApiBase;
    if (explorerApiKey != null) s.explorerApiKey = explorerApiKey;
    if (chainId !== undefined) {
      if (chainId === null || String(chainId).trim() === '') {
        delete s.chainId;
      } else {
        const n = Number(chainId);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'chainId must be a number' });
        s.chainId = n;
      }
    }
    cfg.servers[i] = s; saveServers(cfg);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/servers/:id', (req, res) => {
  try {
    const cfg = loadServers();
    cfg.servers = cfg.servers.filter(s => s.id !== req.params.id);
    if (cfg.activeId === req.params.id) cfg.activeId = cfg.servers[0]?.id || null;
    saveServers(cfg);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/servers/:id/select', (req, res) => {
  try {
    const cfg = loadServers();
    if (!cfg.servers.find(s => s.id === req.params.id)) return res.status(404).json({ error: 'not found' });
    cfg.activeId = req.params.id; saveServers(cfg);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bot status summary endpoint
app.get('/status/summary', async (req, res) => {
  try {
    const server = getActiveServer();
    if (!server || !server.baseUrl) {
      return res.status(404).json({ error: 'Active server not configured' });
    }

    const resp = await axios.get(server.baseUrl, { timeout: 10000 });
    const text = resp.data;

    if (typeof text !== 'string') {
      return res.status(500).json({ error: 'Invalid status response from server' });
    }

    const lines = text.split(/\r?\n/);
    const sdiffLine = lines.find(l => l.startsWith('SDIFF_Uniswap_ckhvar2'));
    const blacklistLine = lines.find(l => l.startsWith('SDIFF Uniswap BlackList:'));

    let sdiffData = null;
    if (sdiffLine) {
      const parts = sdiffLine.split(/\s+/);
      const propsIndex = sdiffLine.indexOf('Mindiff:');
      const propsStr = propsIndex > -1 ? sdiffLine.substring(propsIndex) : '';

      sdiffData = {
        id: parts[0],
        addr: parts[1],
        errCnt: parts[2],
        state: parts[3],
        up: parts[4],
        lc: parts[5],
        clean: parts[6],
        ordSz: parts[7],
        mAvg: parts[8],
        tLmt: parts[9],
        vDur: parts[10],
        mxE: parts[11],
        pro50: parts[15],
        pro100: parts[16],
        total: parts[22],
        props: propsStr,
      };
    }

    let blacklistData = null;
    if (blacklistLine) {
      const str = blacklistLine.replace('SDIFF Uniswap BlackList:', '').trim();
      blacklistData = str.split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
          const [key, value] = item.split(':');
          if (key && value !== undefined) {
            const valNum = parseFloat(value);
            return { contract: key, gas: valNum, isLow: valNum < 2 };
          }
          return null;
        }).filter(Boolean);
    }

    res.json({ sdiff: sdiffData, blacklist: blacklistData });

  } catch (err) {
    console.error('[api:/status/summary] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch server status' });
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/logout', (req, res) => {
  res.clearCookie('loggedIn');
  res.clearCookie('username');
  res.clearCookie('userRole');
  res.json({ success: true });
});

// WARNING: Storing passwords in plain text is highly insecure and should NEVER be used in a production environment.
// This is implemented solely for demonstration purposes as per user request.
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  try {
    const users = JSON.parse(fs.readFileSync(SERVERS_FILE.replace('servers.json', 'users.json'), 'utf8'));
    if (users[username] === password) {
      // Insecure: For demonstration only. In production, use secure, signed, HTTP-only cookies.
      const role = username === 'admin' ? 'admin' : 'user';
      const cookieOptions = { httpOnly: false, secure: false, maxAge: 3600000 };
      res.cookie('loggedIn', 'true', cookieOptions); // 1 hour
      res.cookie('username', username, cookieOptions);
      res.cookie('userRole', role, cookieOptions);
      res.json({ success: true, role });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/status/server', async (req, res) => {
  try {
    const server = getActiveServer();
    if (!server || !server.baseUrl) {
      return res.status(404).json({ error: 'Active server not configured' });
    }

    const serverIp = server.baseUrl.split(':')[1].substring(2);
    const resp = await axios.get(`http://${serverIp}:3001/`, { timeout: 10000 });
    const text = resp.data;

    if (typeof text !== 'string') {
      return res.status(500).json({ error: 'Invalid status response from server' });
    }

    const lines = text.split(/\r?\n/);
    const sdiffLine = lines.find(l => l.startsWith('SDIFF_Uniswap_ckhvar2'));
    const blacklistLine = lines.find(l => l.startsWith('SDIFF Uniswap BlackList:'));

    let sdiffData = null;
    if (sdiffLine) {
      const parts = sdiffLine.split(/\s+/);
      const propsIndex = sdiffLine.indexOf('Mindiff:');
      const propsStr = propsIndex > -1 ? sdiffLine.substring(propsIndex) : '';

      const tokens = propsStr.match(/\w+\([\d.]+,[\d.]+\)/g)?.map(t => {
        const [name, values] = t.split('(');
        const [buy, sell] = values.slice(0, -1).split(',');
        return { name, buy, sell };
      });

      const m1Index = parts.findIndex(p => p === 'M1');
      const up = m1Index !== -1 && parts.length > m1Index + 1 ? parts[m1Index + 1] : null;

      sdiffData = {
        up: up,
        mindiff: propsStr.match(/Mindiff:([\d.]+)/)?.[1],
        maxOrderSize: propsStr.match(/MaxOrderSize: (\d+)/)?.[1],
        tokens: tokens,
      };
    }

    let blacklistData = null;
    if (blacklistLine) {
      const str = blacklistLine.replace('SDIFF Uniswap BlackList:', '').trim();
      blacklistData = str.split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
          const [key, value] = item.split(':');
          if (key && value !== undefined) {
            const valNum = parseFloat(value);
            return { contract: key, gas: valNum, isLow: valNum < 2 };
          }
          return null;
        }).filter(Boolean);
    }

    const db = getDbFromReq(req);
    const trades = db.prepare('SELECT * FROM completed_trades ORDER BY lastUpdateTime DESC LIMIT 5000').all();

    const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);

    // Time-based calculations
    const now = Date.now();
    const oneHourAgo = now - (1 * 60 * 60 * 1000);
    const fourHoursAgo = now - (4 * 60 * 60 * 1000);
    const eightHoursAgo = now - (8 * 60 * 60 * 1000);
    const twelveHoursAgo = now - (12 * 60 * 60 * 1000);
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

    // Filter trades by time periods from the larger dataset
    const tradesLast1h = trades.filter(t => t.lastUpdateTime >= oneHourAgo);
    const tradesLast4h = trades.filter(t => t.lastUpdateTime >= fourHoursAgo);
    const tradesLast8h = trades.filter(t => t.lastUpdateTime >= eightHoursAgo);
    const tradesLast12h = trades.filter(t => t.lastUpdateTime >= twelveHoursAgo);
    
    // For 24h, query database directly to ensure we get all trades in that period
    const tradesLast24h = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ? ORDER BY lastUpdateTime DESC').all(twentyFourHoursAgo);

    // Calculate profits for each time period
    const profitLast1h = tradesLast1h.reduce((acc, t) => acc + netProfit(t), 0);
    const profitLast4h = tradesLast4h.reduce((acc, t) => acc + netProfit(t), 0);
    const profitLast8h = tradesLast8h.reduce((acc, t) => acc + netProfit(t), 0);
    const profitLast12h = tradesLast12h.reduce((acc, t) => acc + netProfit(t), 0);
    const profitLast24h = tradesLast24h.reduce((acc, t) => acc + netProfit(t), 0);

    res.json({ 
      sdiff: sdiffData, 
      blacklist: blacklistData, 
      profit: {
        last1h: profitLast1h,
        last4h: profitLast4h,
        last8h: profitLast8h,
        last12h: profitLast12h,
        last24h: profitLast24h
      },
      trades: {
        last1h: tradesLast1h.length,
        last4h: tradesLast4h.length,
        last8h: tradesLast8h.length,
        last12h: tradesLast12h.length,
        last24h: tradesLast24h.length
      }
    });

  } catch (err) {
    console.error('[api:/status/server] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch server status' });
  }
});

// --- Throttled Etherscan Client ---
function maskEtherscanUrl(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('apikey')) {
      u.searchParams.set('apikey', '***');
    }
    return u.toString();
  } catch {
    return url;
  }
}

const etherscanQueue = [];
let isEtherscanProcessing = false;

async function processEtherscanQueue() {
  if (isEtherscanProcessing || etherscanQueue.length === 0) return;
  isEtherscanProcessing = true;

  const { url, resolve, reject } = etherscanQueue.shift();
  const masked = maskEtherscanUrl(url);
  try {
    console.log('[etherscan] ->', masked);
    const resp = await axios.get(url, { timeout: 15000 });
    console.log('[etherscan] <-', masked, 'status', resp.status, 'keys', Object.keys(resp.data || {}));
    resolve(resp.data);
  } catch (error) {
    console.error('[etherscan] x', masked, error.message);
    reject(error);
  }

  setTimeout(() => {
    isEtherscanProcessing = false;
    processEtherscanQueue();
  }, 1000); // 1 request per second
}

function fetchThrottledEtherscan(url) {
  return new Promise((resolve, reject) => {
    etherscanQueue.push({ url, resolve, reject });
    processEtherscanQueue();
  });
}

// Contract analysis for configured server
app.get('/contracts/analysis', async (req, res) => {
  try {
    const serverId = req.query.serverId || loadServers().activeId;
    const cfg = loadServers();
    const s = cfg.servers.find(x => x.id === serverId) || cfg.servers.find(x => x.id === cfg.activeId) || cfg.servers[0];
    if (!s) return res.status(404).json({ error: 'No server configured' });
    if (!s.contractAddress) {
      return res.status(400).json({ error: 'Server missing contractAddress' });
    }

    const addr = s.contractAddress;
    const chainId = Number(s.chainId);
    const apiKey = (s.explorerApiKey || ETHERSCAN_API_KEY || '').trim();
    const useUnifiedApi = Number.isFinite(chainId) && chainId > 0 && apiKey;
    console.log('[contracts/analysis] server', serverId, 'address', addr, 'chainId', chainId, 'useUnified', useUnifiedApi);

    const extractTxs = (payload) => {
      if (!payload) return [];
      if (Array.isArray(payload.result)) return payload.result;
      if (Array.isArray(payload.data)) return payload.data;
      if (payload.result && Array.isArray(payload.result.transactions)) return payload.result.transactions;
      return [];
    };

    const fetchLegacy = async () => {
      if (!s.explorerApiBase) return [];
      const legacyApi = s.explorerApiBase.replace(/\/?$/, '');
      const legacyUrl = `${legacyApi}/api?module=account&action=txlist&address=${encodeURIComponent(addr)}&sort=desc&page=1&offset=1000${s.explorerApiKey ? `&apikey=${encodeURIComponent(s.explorerApiKey)}` : ''}`;
      console.log('[contracts/analysis] legacy fetch', maskEtherscanUrl(legacyUrl));
      const data = await fetchThrottledEtherscan(legacyUrl);
      if (typeof (data && data.result) === 'string' && data.result.toLowerCase().includes('max rate limit')) {
        throw new Error(data.result);
      }
      const txs = extractTxs(data);
      console.log('[contracts/analysis] legacy results', Array.isArray(txs) ? txs.length : 0);
      return txs;
    };

    let txs = [];
    try {
      if (useUnifiedApi) {
        const params = new URLSearchParams({
          chainid: String(chainId),
          module: 'account',
          action: 'txlist',
          address: addr,
          sort: 'desc',
          page: '1',
          offset: '1000'
        });
        if (apiKey) params.append('apikey', apiKey);
        const unifiedUrl = `${ETHERSCAN_API_URL}/api?${params.toString()}`;
        const data = await fetchThrottledEtherscan(unifiedUrl);
        if (typeof (data && data.result) === 'string' && data.result.toLowerCase().includes('max rate limit')) {
          throw new Error(data.result);
        }
        txs = extractTxs(data);
        if ((!txs || txs.length === 0) && s.explorerApiBase && data && ((data.status === '0' && data.result) || data.message === 'NOTOK')) {
          txs = await fetchLegacy();
        }
      } else {
        txs = await fetchLegacy();
      }
    } catch (e) {
      console.error('[contracts/analysis] unified fetch error:', e.message);
      if (useUnifiedApi && s.explorerApiBase) {
        try {
          txs = await fetchLegacy();
        } catch (fallbackErr) {
          console.error('[contracts/analysis] legacy fallback error:', fallbackErr.message);
          return res.status(502).json({ error: 'Failed to fetch transactions from explorer API' });
        }
      } else {
        return res.status(502).json({ error: 'Failed to fetch transactions from explorer API' });
      }
    }

    console.log('[contracts/analysis] tx count', txs.length);

    const since24h = Date.now() - (24 * 60 * 60 * 1000);
    const recent = txs.filter(t => {
      const ts = Number(t.timeStamp) * 1000;
      return Number.isFinite(ts) && ts >= since24h;
    });

    function isSuccess(t) {
      return String(t.isError || t.errorCode || '0').trim() === '0';
    }

    const buckets = [1, 4, 8, 12, 24];
    const now = Date.now();
    const periods = {};
    for (const h of buckets) periods[`${h}h`] = { success: 0, fail: 0 };
    for (const t of recent) {
      const ts = Number(t.timeStamp) * 1000;
      const ageH = (now - ts) / (60 * 60 * 1000);
      for (const h of buckets) {
        if (ageH <= h) {
          if (isSuccess(t)) periods[`${h}h`].success++; else periods[`${h}h`].fail++;
        }
      }
    }

    const failed = recent.filter(t => !isSuccess(t)).slice(0, 100);

    const failedWithReasons = failed.map(t => {
      const ts = Number(t.timeStamp) * 1000;
      const reason = t.txreceipt_status === '0' ? 'Reverted' : (t.errDescription || t.revertReason || 'Unknown');
      return {
        hash: t.hash,
        time: Number.isFinite(ts) ? new Date(ts).toISOString() : '',
        reason,
        link: (s.explorerSite || '').replace(/\/?$/, '') + '/tx/' + t.hash
      };
    });

    res.json({ serverId, address: addr, periods, failed: failedWithReasons, totalAnalyzed: recent.length, chainId: Number.isFinite(chainId) ? chainId : undefined });
  } catch (err) {
    console.error('[api:/contracts/analysis] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


const { spawn } = require('child_process');

app.post('/ml/train', (req, res) => {
    const pythonProcess = spawn('python', ['train.py']);

    let dataToSend = '';
    pythonProcess.stdout.on('data', (data) => {
        dataToSend += data.toString();
    });

    let errorToSend = '';
    pythonProcess.stderr.on('data', (data) => {
        errorToSend += data.toString();
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`train.py stderr: ${errorToSend}`);
            return res.status(500).json({ message: 'Failed to train model.', details: errorToSend });
        }
        res.json({ message: 'Model trained successfully.', details: dataToSend });
    });
});

app.post('/ml/predict', (req, res) => {
    const { buyDiffBps, sellDiffBps, Diff, DexSlip, CexSlip } = req.body;

    if ([buyDiffBps, sellDiffBps, Diff, DexSlip, CexSlip].some(v => v === undefined)) {
        return res.status(400).json({ error: 'Missing one or more required features.' });
    }

    const pythonProcess = spawn('python', [
        'predict.py',
        buyDiffBps,
        sellDiffBps,
        Diff,
        DexSlip,
        CexSlip
    ]);

    let dataToSend = '';
    pythonProcess.stdout.on('data', (data) => {
        dataToSend += data.toString();
    });

    let errorToSend = '';
    pythonProcess.stderr.on('data', (data) => {
        errorToSend += data.toString();
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`predict.py stderr: ${errorToSend}`);
            return res.status(500).json({ error: 'Failed to get prediction.', details: errorToSend });
        }
        try {
            const result = JSON.parse(dataToSend);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse prediction output.', details: dataToSend });
        }
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  try { for (const d of dbCache.values()) d.close(); } catch (_) {}
  process.exit(0);
});
