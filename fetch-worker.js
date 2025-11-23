import { parentPort, workerData } from 'worker_threads';
import axios from 'axios';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Notifier } from './notifier.js';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let ethPrice = null;
async function getEthPrice() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
    ethPrice = parseFloat(response.data.price);
  } catch (error) {
    console.error('Error fetching ETH price:', error.message);
  }
}

let polPrice = null;
async function getPolPrice() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT');
    polPrice = parseFloat(response.data.price);
  } catch (error) {
    console.error('Error fetching POL price:', error.message);
  }
}

let bnbPrice = null;
async function getBnbPrice() {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
    bnbPrice = parseFloat(response.data.price);
  } catch (error) {
    console.error('Error fetching BNB price:', error.message);
  }
}

// Fetch the ETH, POL and BNB price once on startup
getEthPrice();
getPolPrice();
getBnbPrice();
// And then every 5 minutes
cron.schedule('*/5 * * * *', getEthPrice);
cron.schedule('*/5 * * * *', getPolPrice);
cron.schedule('*/5 * * * *', getBnbPrice);

// Configuration
const SERVERS_FILE = path.join(__dirname, 'servers.json');

let etherscanBase = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2';
if (etherscanBase) {
  while (etherscanBase.endsWith('/')) etherscanBase = etherscanBase.slice(0, -1);
}
const ETHERSCAN_API_URL = etherscanBase;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';

// Multi-server config
function loadServers() {
  if (!fs.existsSync(SERVERS_FILE)) {
    const defaults = {
      activeId: 'bnb',
      servers: [
        { id: 'bnb', label: 'BNB',baseUrl: 'http://195.201.178.120:3001', balancesPath: '/balance', completedPath: '/completed' },
        { id: 'arbitrum', label: 'ARBITRUM', baseUrl: 'http://168.119.69.230:3001', balancesPath: '/balance', completedPath: '/completed' },
        { id: 'base', label: 'BASE', baseUrl: 'http://95.216.27.101:3001', balancesPath: '/balance', completedPath: '/completed' },
      ],
      notificationRules: {
        "profit-trade": { "cooldownMinutes": 60 },
        "high-profit-trade": { "cooldownMinutes": 60, "threshold": 100, "channels": [] },
        "lowGas": { "cooldownMinutes": 60 },
        "pollFailed": { "cooldownMinutes": 60 },
        "lowCexVolume": { "threshold": 10, "cooldownMinutes": 5 },
        "hourlyDigest": { "cooldownMinutes": 60 },
        "dailyDigest": { "cooldownMinutes": 1440 }
      },
      notifications: {
        telegram: { enabled: false, botToken: '', chatId: '' },
        slack: { enabled: false, webhookUrl: '' },
        email: { enabled: false, smtpHost: '', smtpPort: 587, secure: false, user: '', pass: '', from: '', to: '' }
      }
    };
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  } catch {
    return { activeId: 'default', servers: [{ id: 'default', label: 'Default', baseUrl: (process.env.BALANCES_URL||"").replace(/\/(balance|balances).*/, ''), balancesPath: '/balance', completedPath: '/completed' }] };
  }
}

const dbCache = new Map();
const notifierCache = new Map();

function ensureNotifier(serverId) {
  if (notifierCache.has(serverId)) return notifierCache.get(serverId);
  const cfg = loadServers();
  const server = cfg.servers.find(s => s.id === serverId);
  const db = ensureDb(serverId);
  const notifier = new Notifier({
    serverId,
    serverLabel: server?.label,
    config: cfg.notifications,
    rules: cfg.notificationRules,
    db
  });
  notifierCache.set(serverId, notifier);
  return notifier;
}

const initialTradesSynced = new Set();
function dbPathFor(serverId) {
  if (serverId === 'default' && fs.existsSync(process.env.DB_PATH || path.join(__dirname, 'data.sqlite'))) return process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
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
    CREATE TABLE IF NOT EXISTS gas_balance_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      contract TEXT NOT NULL,
      gas_balance REAL,
      gas_deposit REAL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'auto',
      note TEXT
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
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_diff_history_curId_ts ON diff_history (curId, ts DESC);`);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS contract_transactions (
      hash TEXT NOT NULL,
      serverId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      isError INTEGER NOT NULL,
      reason TEXT,
      ethPrice REAL,
      polPrice REAL,
      bnbPrice REAL,
      raw_data TEXT,
      PRIMARY KEY (serverId, hash)
    );
  `);

  ensureDiffHistoryColumns(_db);
  ensureNotificationsLogColumns(_db);
  dbCache.set(serverId, _db);
  return _db;
}

function ensureDiffHistoryColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(diff_history)').all().map(col => col.name));
  const migrations = [];
  if (!columns.has('cexVol')) migrations.push('ALTER TABLE diff_history ADD COLUMN cexVol REAL');
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

function ensureNotificationsLogColumns(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(notifications_log)').all().map(col => col.name));
  const migrations = [];
  if (!columns.has('read')) migrations.push('ALTER TABLE notifications_log ADD COLUMN read INTEGER DEFAULT 0');
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      console.error('[db] notifications_log migration failed:', err.message);
    }
  }
}

function resolveProfitRule(notifier) {
  const fallback = {
    threshold: -5,
    cooldownMinutes: 30,
    channels: [],
  };
  if (!notifier || typeof notifier.getRuleConfig !== 'function') return fallback;
  const thresholdCfg = notifier.getRuleConfig('profit') || {};
  const dispatchCfg = notifier.getRuleConfig('profit-trade') || {};
  const thresholdRaw = dispatchCfg.thresholdAbsolute != null
    ? dispatchCfg.thresholdAbsolute
    : (thresholdCfg.thresholdAbsolute != null
      ? thresholdCfg.thresholdAbsolute
      : (thresholdCfg.thresholdPercent != null ? thresholdCfg.thresholdPercent : thresholdCfg.threshold));
  const thresholdNum = Number(thresholdRaw);
  const cooldownRaw = dispatchCfg.cooldownMinutes != null
    ? dispatchCfg.cooldownMinutes
    : (thresholdCfg.cooldownMinutes != null ? thresholdCfg.cooldownMinutes : thresholdCfg.cooldown);
  const cooldownNum = Number(cooldownRaw);
  const channelSource = Array.isArray(dispatchCfg.channels) && dispatchCfg.channels.length
    ? dispatchCfg.channels
    : (Array.isArray(thresholdCfg.channels) ? thresholdCfg.channels : []);
  const channels = channelSource.filter((ch) => typeof ch === 'string' && ch.trim());
  return {
    threshold: Number.isFinite(thresholdNum) ? thresholdNum : fallback.threshold,
    cooldownMinutes: Number.isFinite(cooldownNum) && cooldownNum > 0 ? cooldownNum : fallback.cooldownMinutes,
    channels,
  };
}

function resolveHighProfitRule(notifier) {
  const fallback = {
    threshold: 100,
    cooldownMinutes: 60,
    channels: [],
  };
  if (!notifier || typeof notifier.getRuleConfig !== 'function') return fallback;
  const thresholdCfg = notifier.getRuleConfig('high-profit') || {};
  const dispatchCfg = notifier.getRuleConfig('high-profit-trade') || {};
  const thresholdRaw = dispatchCfg.thresholdAbsolute != null
    ? dispatchCfg.thresholdAbsolute
    : (thresholdCfg.thresholdAbsolute != null
      ? thresholdCfg.thresholdAbsolute
      : (thresholdCfg.thresholdPercent != null ? thresholdCfg.thresholdPercent : thresholdCfg.threshold));
  const thresholdNum = Number(thresholdRaw);
  const cooldownRaw = dispatchCfg.cooldownMinutes != null
    ? dispatchCfg.cooldownMinutes
    : (thresholdCfg.cooldownMinutes != null ? thresholdCfg.cooldownMinutes : thresholdCfg.cooldown);
  const cooldownNum = Number(cooldownRaw);
  const channelSource = Array.isArray(dispatchCfg.channels) && dispatchCfg.channels.length
    ? dispatchCfg.channels
    : (Array.isArray(thresholdCfg.channels) ? thresholdCfg.channels : []);
  const channels = channelSource.filter((ch) => typeof ch === 'string' && ch.trim());
  return {
    threshold: Number.isFinite(thresholdNum) ? thresholdNum : fallback.threshold,
    cooldownMinutes: Number.isFinite(cooldownNum) && cooldownNum > 0 ? cooldownNum : fallback.cooldownMinutes,
    channels,
  };
}

function resolveLowCexVolumeRule(notifier) {
  const fallback = {
    threshold: 10,
    cooldownMinutes: 5,
    channels: [],
  };
  if (!notifier || typeof notifier.getRuleConfig !== 'function') return fallback;
  const cfg = notifier.getRuleConfig('lowCexVolume') || {};
  const thresholdNum = Number(cfg.threshold);
  const cooldownRaw = cfg.cooldownMinutes != null ? cfg.cooldownMinutes : cfg.cooldown;
  const cooldownNum = Number(cooldownRaw);
  const channels = Array.isArray(cfg.channels)
    ? cfg.channels.filter((ch) => typeof ch === 'string' && ch.trim())
    : [];
  return {
    threshold: Number.isFinite(thresholdNum) ? thresholdNum : fallback.threshold,
    cooldownMinutes: Number.isFinite(cooldownNum) && cooldownNum > 0 ? cooldownNum : fallback.cooldownMinutes,
    channels,
  };
}

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

function normalizePropsRaw(input) {
  try {
    const p = typeof input === 'string' ? JSON.parse(input) : (input || {});
    const out = {};
    if (p && (p.Diff != null || p.DexSlip != null || p.CexSlip != null || p.Dex != null || p.Exec != null)) {
      if (p.Diff != null) out.Diff = Number(p.Diff);
      if (p.DexSlip != null) out.DexSlip = Number(p.DexSlip);
      if (p.CexSlip != null) out.CexSlip = Number(p.CexSlip);
      if (p.Dex != null) out.Dex = String(p.Dex);
      if (p.Exec != null) out.Exec = String(p.Exec);
    } else {
      const execKey = ['Market','Limit','PostOnly','IOC','FOK'].find(k => Object.prototype.hasOwnProperty.call(p, k));
      if (execKey) { out.Exec = execKey; const v = Number(p[execKey]); if (Number.isFinite(v)) out.CexSlip = v; }
      for (const [k, v] of Object.entries(p)) {
        if (v === 'BUY' || v === 'SELL') {
          out.Dex = String(v);
          break;
        }
      }
      for (const [k, v] of Object.entries(p)) {
        const nk = Number(k); const nv = Number(v);
        if (Number.isFinite(nk) && Number.isFinite(nv)) { out.Diff = nk; out.DexSlip = nv; break; }
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

async function maybeNotifyLowProfitTrade({ server, notifier, trade, origin = 'store', ruleOverride }) {
  if (!notifier || !trade) {
    return { triggered: false, reason: 'missing_context' };
  }
  const serverId = server?.id || 'unknown';
  const serverLabel = server?.label || serverId;
  const rule = ruleOverride || resolveProfitRule(notifier);
  const executedProfit = safeNumber(trade.executedProfit);
  const profitValue = Number.isFinite(executedProfit) ? executedProfit : safeNumber(trade.estimatedProfit);
  
  if (!Number.isFinite(profitValue)) {
    return { triggered: false, reason: 'no_profit_value' };
  }
  if (profitValue >= rule.threshold) {
    return { triggered: false, reason: 'above_threshold' };
  }

  const pair = trade.pair || trade.token || 'unknown';
  const delta = profitValue - rule.threshold;
  const props = normalizePropsRaw(trade.props);
  const dexValue = props ? props.Dex : 'N/A';
  
  const title = profitValue < -30 ? `⚠️ Low profit trade: ${pair}` : `Low profit trade: ${pair}`;
  const message = `Server: ${serverLabel} | Profit: ${profitValue.toFixed(2)} | Dex: ${dexValue}`;

  const payload = {
    title,
    message,
    cooldownMinutes: rule.cooldownMinutes,
    uniqueKey: trade.id != null ? `low-profit-${trade.id}` : undefined,
    details: {
      tradeId: trade.id ?? null,
      pair,
      profit: profitValue,
      server: serverLabel,
      origin,
      threshold: rule.threshold,
      delta,
      dex: dexValue,
    },
  };
  if (rule.channels.length) {
    payload.channels = rule.channels;
  }

  try {
    const result = await notifier.notify('profit-trade', payload);
    if (result?.skipped === 'cooldown') {
      return { triggered: false, reason: 'cooldown', result };
    }
    return { triggered: true, result };
  } catch (err) {
    console.error(`[notify:profit:${origin}] notify error trade=${trade.id ?? 'unknown'} server=${serverLabel}:`, err?.message || err);
    return { triggered: false, error: err };
  }
}

async function maybeNotifyHighProfitTrade({ server, notifier, trade, origin = 'store', ruleOverride }) {
  if (!notifier || !trade) {
    return { triggered: false, reason: 'missing_context' };
  }
  const serverId = server?.id || 'unknown';
  const serverLabel = server?.label || serverId;
  const rule = ruleOverride || resolveHighProfitRule(notifier);
  const executedProfit = safeNumber(trade.executedProfit);
  const profitValue = Number.isFinite(executedProfit) ? executedProfit : safeNumber(trade.estimatedProfit);
  
  if (!Number.isFinite(profitValue)) {
    return { triggered: false, reason: 'no_profit_value' };
  }
  if (profitValue < rule.threshold) {
    return { triggered: false, reason: 'below_threshold' };
  }

  const pair = trade.pair || trade.token || 'unknown';
  const delta = profitValue - rule.threshold;
  const props = normalizePropsRaw(trade.props);
  const dexValue = props ? props.Dex : 'N/A';
  
  const title = profitValue > 30 ? `💸 High profit trade: ${pair}` : `High profit trade: ${pair}`;
  const message = `Server: ${serverLabel} | Profit: ${profitValue.toFixed(2)} | Dex: ${dexValue}`;

  const payload = {
    title,
    message,
    cooldownMinutes: rule.cooldownMinutes,
    uniqueKey: trade.id != null ? `high-profit-${trade.id}` : undefined,
    details: {
      tradeId: trade.id ?? null,
      pair,
      profit: profitValue,
      server: serverLabel,
      origin,
      threshold: rule.threshold,
      delta,
      dex: dexValue,
    },
  };
  if (rule.channels.length) {
    payload.channels = rule.channels;
  }
  try {
    const result = await notifier.notify('high-profit-trade', payload);
    if (result?.skipped === 'cooldown') {
      return { triggered: false, reason: 'cooldown', result };
    }
    return { triggered: true, result };
  } catch (err) {
    console.error(`[notify:high-profit:${origin}] notify error trade=${trade.id ?? 'unknown'} server=${serverLabel}:`, err?.message || err);
    return { triggered: false, error: err };
  }
}

function tokenNameFromCurId(curId) {
  if (typeof curId !== 'string') return null;
  const parts = curId.split('_').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return parts[0] || curId || null;
}

async function maybeNotifyLowCexVolume({ server, notifier, curId, volume, timestamp, origin = 'api', ruleOverride }) {
  if (!notifier) {
    return { triggered: false, reason: 'no_notifier' };
  }
  const serverId = server?.id || 'unknown';
  const serverLabel = server?.label || serverId;
  const rule = ruleOverride || resolveLowCexVolumeRule(notifier);
  const numericVolume = Number(volume);
  const hasVolume = Number.isFinite(numericVolume);
  
  if (!hasVolume || !Number.isFinite(rule.threshold) || numericVolume >= rule.threshold) {
    return { triggered: false, reason: hasVolume ? 'above_threshold' : 'invalid_volume' };
  }

  const tokenLabel = tokenNameFromCurId(curId) || curId;
  const delta = numericVolume - rule.threshold;
  const messageLines = [
    `Server: ${serverLabel}`,
    `Token: ${tokenLabel}`,
    `CEX Volume: ${numericVolume.toFixed(2)}`,
    `Threshold: ${rule.threshold.toFixed(2)}`,
    `Delta: ${delta.toFixed(2)}`,
  ];

  const payload = {
    title: `Low CEX Volume - ${tokenLabel}`,
    message: messageLines.join('\n'),
    cooldownMinutes: rule.cooldownMinutes,
    uniqueKey: curId,
    details: {
      serverId,
      server: serverLabel,
      token: tokenLabel,
      curId,
      timestamp,
      volume: numericVolume,
      threshold: rule.threshold,
      delta,
      origin,
    },
  };
  if (rule.channels.length) {
    payload.channels = rule.channels;
  }

  try {
    const result = await notifier.notify('lowCexVolume', payload);
    if (result?.skipped === 'cooldown') {
      return { triggered: false, reason: 'cooldown', result };
    }
    return { triggered: true, result };
  } catch (err) {
    console.error(`[notify:lowCexVolume:${origin}] error:`, err.message);
    return { triggered: false, error: err };
  }
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
  return {
    totalUsdt: Number.isFinite(totalUsdt) ? totalUsdt : null,
    totalCoin: null,
  };
}

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
  } catch (err) {
    const status = err?.response?.status;
    const notifier = ensureNotifier(server.id);
    if (status === 404) {
      if (notifier) {
        notifier.notify('pollFailed', {
          title: `Poll Failed: ${server.label}`,
          message: `Failed to fetch diffdata (404 Not Found)`,
          details: { server: server.label, error: '404 Not Found' },
          uniqueKey: 'diffdata-404'
        }).catch(err => console.error('Notifier error:', err.message));
      }
    } else {
      console.error(`[diffdata:${server.label}] Fetch/store error:`, err.message);
      if (notifier) {
        notifier.notify('pollFailed', {
          title: `Poll Failed: ${server.label}`,
          message: `Failed to fetch diffdata (${err.message})`,
          details: { server: server.label, error: err.message, type: 'connection-error' },
          uniqueKey: `diffdata-conn-error-${err.code || 'unknown'}`
        }).catch(err => console.error('Notifier error:', err.message));
      }
    }
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
    console.log(`[balances:${server.label}] Stored @ ${row.timestamp}`);
  } catch (err) {
    const status = err?.response?.status;
    const notifier = ensureNotifier(server.id);
    if (status === 404) {
      console.log(`[balances:${server.label}] 404 (not found). Skipping.`);
    } else {
      console.error(`[balances:${server.label}] Fetch/store error:`, err.message);
      if (notifier) {
        notifier.notify('pollFailed', {
          title: `Poll Failed: ${server.label}`,
          message: `Failed to fetch balances (${err.message})`,
          details: { server: server.label, error: err.message, type: 'connection-error' },
          uniqueKey: `balances-conn-error-${err.code || 'unknown'}`
        }).catch(err => console.error('Notifier error:', err.message));
      }
    }
  }
}

function storeCompletedTrades(server, trades, sourceLabel = 'recent') {
  if (!server) return 0;
  const arr = Array.isArray(trades) ? trades : [];
  if (!arr.length) {
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
      if (info.changes > 0) {
        inserted += 1;
        const notifier = ensureNotifier(server.id);
        if (notifier) {
          maybeNotifyLowProfitTrade({
            server,
            notifier,
            trade: t,
            origin: 'store',
          }).catch(err => console.error('[notify:profit:store] unhandled error:', err?.message || err));
          
           maybeNotifyHighProfitTrade({
            server,
            notifier,
            trade: t,
            origin: 'store',
          }).catch(err => console.error('[notify:high-profit:store] unhandled error:', err?.message || err));
        }
      }
    }
  });

  insert(arr);
  console.log(`[trades:${server.label}] Inserted ${inserted}/${arr.length} trades`);
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
    const notifier = ensureNotifier(server.id);
    if (notifier) {
      notifier.notify('pollFailed', {
        title: `Poll Failed: ${server.label}`,
        message: `Failed to fetch trades (${err.message})`,
        details: { server: server.label, error: err.message, type: 'connection-error' },
        uniqueKey: `trades-conn-error-${err.code || 'unknown'}`
      }).catch(err => console.error('Notifier error:', err.message));
    }
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
      }
    }

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

        const notifier = ensureNotifier(server.id);
        if (notifier) {
          const lowGasThreshold = notifier.getRuleConfig('lowGas')?.threshold ?? 2;
          const lowGasContracts = gasBalances.filter(b => b.gas < lowGasThreshold);
          if (lowGasContracts.length > 0) {
            const message = lowGasContracts.map(b => `Gas for ${b.contract} is ${b.gas}`).join('\n');
            notifier.notify('lowGas', {
              title: `Low Gas: ${server.label}`,
              message: message,
              details: { server: server.label, contracts: lowGasContracts }
            }).catch(err => console.error('Notifier error:', err.message));
          }
        }
      }
    }
  } catch (err) {
    console.error(`[status:${server?.label}] Fetch/store error:`, err.message);
    const notifier = ensureNotifier(server.id);
    if (notifier) {
      notifier.notify('pollFailed', {
        title: `Poll Failed: ${server.label}`,
        message: `Failed to fetch status (${err.message})`,
        details: { server: server.label, error: err.message, type: 'connection-error' },
        uniqueKey: `status-conn-error-${err.code || 'unknown'}`
      }).catch(err => console.error('Notifier error:', err.message));
    }
  }
}

async function fetchContractTxsAndStoreFor(server) {
  if (!server || !server.contractAddress) return;

  const { id: serverId, contractAddress, chainId, explorerApiKey, explorerApiBase } = server;
  const db = ensureDb(serverId);

  try {
    const apiKey = (explorerApiKey || ETHERSCAN_API_KEY || '').trim();
    const useUnifiedApi = Number.isFinite(chainId) && chainId > 0 && apiKey;

    const extractTxs = (payload) => {
      if (!payload) return [];
      if (Array.isArray(payload.result)) return payload.result;
      if (Array.isArray(payload.data)) return payload.data;
      if (payload.result && Array.isArray(payload.result.transactions)) return payload.result.transactions;
      return [];
    };

    const fetchLegacy = async () => {
      if (!explorerApiBase) return [];
      const legacyApi = explorerApiBase.replace(/\/?$/, '');
      const legacyUrl = `${legacyApi}/api?module=account&action=txlist&address=${encodeURIComponent(contractAddress)}&sort=desc&page=1&offset=1000${explorerApiKey ? `&apikey=${encodeURIComponent(explorerApiKey)}` : ''}`;
      const data = await fetchThrottledEtherscan(legacyUrl);
      if (typeof (data && data.result) === 'string' && data.result.toLowerCase().includes('max rate limit')) {
        throw new Error(data.result);
      }
      return extractTxs(data);
    };

    let txs = [];
    if (useUnifiedApi) {
      const params = new URLSearchParams({
        chainid: String(chainId),
        module: 'account',
        action: 'txlist',
        address: contractAddress,
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
      if ((!txs || txs.length === 0) && explorerApiBase && data && ((data.status === '0' && data.result) || data.message === 'NOTOK')) {
        txs = await fetchLegacy();
      }
    } else {
      txs = await fetchLegacy();
    }

    if (txs.length > 0) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO contract_transactions (hash, serverId, timestamp, isError, reason, ethPrice, polPrice, bnbPrice, raw_data)
        VALUES (@hash, @serverId, @timestamp, @isError, @reason, @ethPrice, @polPrice, @bnbPrice, @raw_data)
      `);

      db.transaction((items) => {
        for (const t of items) {
          const isError = String(t.isError || t.errorCode || '0').trim() !== '0';
          const reason = t.txreceipt_status === '0' ? 'Reverted' : (t.errDescription || t.revertReason || 'Unknown');
          let price = { ethPrice: null, polPrice: null, bnbPrice: null };
          if (server.explorerSite === 'https://polygonscan.com') {
            price.polPrice = polPrice;
          } else if (server.explorerSite === 'https://bscscan.com') {
            price.bnbPrice = bnbPrice;
          } else {
            price.ethPrice = ethPrice;
          }

          stmt.run({
            hash: t.hash,
            serverId: serverId,
            timestamp: Number(t.timeStamp) * 1000,
            isError: isError ? 1 : 0,
            reason: isError ? reason : null,
            ...price,
            raw_data: JSON.stringify(t)
          });
        }
      })(txs);
    }

  } catch (err) {
    console.error(`[contracts:${serverId}] Fetch/store error:`, err.message);
    const notifier = ensureNotifier(serverId);
    if (notifier) {
      notifier.notify('pollFailed', {
        title: `Poll Failed: ${serverId}`,
        message: `Failed to fetch contract transactions (${err.message})`,
        details: { server: serverId, error: err.message, type: 'connection-error' },
        uniqueKey: `contracts-conn-error-${err.code || 'unknown'}`
      }).catch(err => console.error('Notifier error:', err.message));
    }
  }
}

async function ensureInitialTradesSync(server) {
  if (!server) return;
  if (initialTradesSynced.has(server.id)) return;
  const ok = await fetchAllTradesAndStoreFor(server);
  if (ok) initialTradesSynced.add(server.id);
}

async function checkLowCexVolumeFor(server) {
  if (!server) return;
  const notifier = ensureNotifier(server.id);
  if (!notifier) return;
  try {
    const db = ensureDb(server.id);
    const latestRows = db.prepare(`
      SELECT dh.curId, dh.cexVol, dh.ts
      FROM diff_history dh
      INNER JOIN (
        SELECT curId, MAX(ts) AS maxTs
        FROM diff_history
        GROUP BY curId
      ) latest ON latest.curId = dh.curId AND latest.maxTs = dh.ts
    `).all();
    const rule = resolveLowCexVolumeRule(notifier);
    
    for (const row of latestRows) {
      await maybeNotifyLowCexVolume({
        server,
        notifier,
        curId: row.curId,
        volume: row.cexVol,
        timestamp: row.ts,
        origin: 'cron',
        ruleOverride: rule,
      });
    }
  } catch (err) {
    console.error(`[notify:lowCexVolume:${server.label || server.id}] evaluation error:`, err?.message || err);
  }
}

async function checkAllLowCexVolumes() {
  const cfg = loadServers();
  for (const server of cfg.servers) {
    await checkLowCexVolumeFor(server);
  }
}



async function sendHourlyDigest() {
  const cfg = loadServers();
  for (const server of cfg.servers) {
    const notifier = ensureNotifier(server.id);
    if (!notifier) continue;
    try {
      const serverIp = server.baseUrl.split(':')[1].substring(2);
      const resp = await axios.get(`http://${serverIp}:3001/`, { timeout: 10000 });
      const text = resp.data;
      let message = `📊 *Hourly Digest for ${server.label}*\n\n`;
       if (typeof text === 'string') {
         if (text.includes('SDIFF')) message += `Server online\n`;
       }

      const db = ensureDb(server.id);
      const now = Date.now();
      const oneHourAgo = now - (1 * 60 * 60 * 1000);
      const tradesLast1h = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ?').all(oneHourAgo);
      const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
      const profitLast1h = tradesLast1h.reduce((acc, t) => acc + netProfit(t), 0);

      message += `📈 *Last Hour Performance*\n`;
      message += `💼 Trades: ${tradesLast1h.length} | 💰 Profit: ${Number.isFinite(profitLast1h) ? profitLast1h.toFixed(2) : '0.00'}\n\n`;
      
      const ruleChannels = notifier.getRuleConfig('hourlyDigest')?.channels;
      const channels = ruleChannels || ['slack']; 
      
      await notifier.notify('hourlyDigest', {
        title: `Hourly Digest: ${server.label}`,
        message: message,
        channels: channels
      });

    } catch (err) {
      console.error(`Failed to send hourly digest for server ${server.label}:`, err.message);
    }
  }
}

async function sendDailyDigest() {
   const cfg = loadServers();
   for (const server of cfg.servers) {
    const notifier = ensureNotifier(server.id);
    if (!notifier) continue;
    try {
       const db = ensureDb(server.id);
       const now = Date.now();
       const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
       const tradesLast24h = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ?').all(twentyFourHoursAgo);
       const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
       const profitLast24h = tradesLast24h.reduce((acc, t) => acc + netProfit(t), 0);
       
       let message = `Daily digest for ${server.label}:\n24h P&L: ${profitLast24h.toFixed(2)}`;

      notifier.notify('dailyDigest', {
        title: `Daily Digest: ${server.label}`,
        message: message,
        channels: notifier.getRuleConfig('dailyDigest')?.channels
      }).catch(err => console.error('Notifier error (daily digest): ', err.message));
    } catch (err) {
       console.error('Failed to send daily digest:', err.message);
    }
   }
}

async function getBalanceUpdateData() {
  const cfg = loadServers();
  const result = [];
  for (const server of cfg.servers) {
    const db = ensureDb(server.id);
    const balanceRow = db.prepare('SELECT raw_data FROM balances_history ORDER BY id DESC LIMIT 1').get();
    let totalUSDT = null;
    let binanceFUSDT = null;
    let dexUSDT = null;
    if (balanceRow) {
      const snapshot = safeJsonParse(balanceRow.raw_data);
      const { combined, cexTotal, dexTotal } = computeDexCex(snapshot);
      totalUSDT = combined;
      binanceFUSDT = cexTotal;
      dexUSDT = dexTotal;
    }
    result.push({
      server: server.label,
      totalUSDT: totalUSDT,
      binanceFUSDT: binanceFUSDT,
      dexUSDT: dexUSDT,
      periodData: {}
    });
  }
  return result;
}

async function sendBalanceUpdate() {
  const cfg = loadServers();
  const data = await getBalanceUpdateData();
  let message = '';
  for (const serverData of data) {
    message += `📊 *SERVER: ${serverData.server}*\n`;
    message += `Total (USDT): ${serverData.totalUSDT?.toLocaleString() || 'N/A'}\n\n`;
  }
  if (cfg.servers.length > 0) {
    const firstServerNotifier = ensureNotifier(cfg.servers[0].id);
    if (firstServerNotifier) {
      const ruleChannels = firstServerNotifier.getRuleConfig('balanceUpdate')?.channels;
      const channels = ruleChannels || ['slack']; 
      await firstServerNotifier.notify('balanceUpdate', {
        title: `Balance Update for All Servers`,
        message: message,
        channels: channels
      });
    }
  }
}

const etherscanQueue = [];
let isEtherscanProcessing = false;

async function processEtherscanQueue() {
  if (isEtherscanProcessing || etherscanQueue.length === 0) return;
  isEtherscanProcessing = true;

  const { url, resolve, reject } = etherscanQueue.shift();
  try {
    const resp = await axios.get(url, { timeout: 15000 });
    resolve(resp.data);
  } catch (error) {
    reject(error);
  }

  setTimeout(() => {
    isEtherscanProcessing = false;
    processEtherscanQueue();
  }, 1000);
}

function fetchThrottledEtherscan(url) {
  return new Promise((resolve, reject) => {
    etherscanQueue.push({ url, resolve, reject });
    processEtherscanQueue();
  });
}

async function checkNotificationConditions(server) {
  const notifier = ensureNotifier(server.id);
  if (!notifier) return;

  const db = ensureDb(server.id);
  
  try {
    const recentTrades = db.prepare(
      'SELECT * FROM completed_trades WHERE lastUpdateTime >= ? ORDER BY lastUpdateTime DESC'
    ).all(Date.now() - (2 * 60 * 1000)); 

    const profitRule = resolveProfitRule(notifier);
    for (const trade of recentTrades) {
      await maybeNotifyLowProfitTrade({
        server,
        notifier,
        trade,
        origin: 'cron',
        ruleOverride: profitRule,
      });
    }

    const highProfitRule = resolveHighProfitRule(notifier);
    for (const trade of recentTrades) {
      await maybeNotifyHighProfitTrade({
        server,
        notifier,
        trade,
        origin: 'cron',
        ruleOverride: highProfitRule,
      });
    }
  } catch (err) {
    console.error(`[notifications:${server.label}] Error checking notification conditions:`, err.message);
  }
}

async function checkAllNotifications() {
  const cfg = loadServers();
  for (const server of cfg.servers) {
    await checkNotificationConditions(server);
  }
}

async function fetchAllAndStore() {
  const cfg = loadServers();
  for (const s of cfg.servers) {
    await ensureInitialTradesSync(s);
    await Promise.allSettled([fetchStatusAndStoreFor(s), fetchBalancesAndStoreFor(s), fetchTradesAndStoreFor(s), fetchDiffDataAndStoreFor(s), fetchContractTxsAndStoreFor(s)]);
  }
}

parentPort.on('message', async (message) => {
  if (message === 'start') {
    console.log('[worker] Starting initial fetch...');
    await fetchAllAndStore();
    console.log('[worker] Initial fetch complete.');
    
    cron.schedule('*/2 * * * *', async () => {
      console.log('[worker] Running scheduled fetch...');
      await fetchAllAndStore();
      await checkAllNotifications();
      await checkAllLowCexVolumes();
    });


    cron.schedule('0 * * * *', async () => {
      console.log('[worker] Running hourly digest...');
      await sendHourlyDigest();
    });
    cron.schedule('0 8 * * *', async () => {
      console.log('[worker] Running daily digest...');
      await sendDailyDigest();
    });
    cron.schedule('0 * * * *', async () => {
      console.log('[worker] Running balance update notification...');
      await sendBalanceUpdate();
    });
  }
});