/* eslint-disable no-unused-vars */
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import expressStaticGzip from 'express-static-gzip';
import { Notifier } from './notifier.js';
import bcrypt from 'bcrypt';
import compression from 'compression';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Start worker thread for data fetching
const worker = new Worker(path.join(__dirname, 'fetch-worker.js'));
worker.postMessage('start');
worker.on('error', (err) => console.error('[worker] error:', err));
worker.on('exit', (code) => {
  if (code !== 0) console.error(`[worker] stopped with exit code ${code}`);
});
console.log('[app] Data fetch worker started');

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
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const BALANCES_URL = process.env.BALANCES_URL || 'http://195.201.178.120:3001/balance';
const SERVERS_FILE = path.join(__dirname, 'servers.json');

let etherscanBase = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2';
if (etherscanBase) {
  while (etherscanBase.endsWith('/')) etherscanBase = etherscanBase.slice(0, -1);
}
const ETHERSCAN_API_URL = etherscanBase;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';

// Ensure video directory exists
const VIDEO_DIR = path.join(__dirname, 'video');
if (!fs.existsSync(VIDEO_DIR)) {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, VIDEO_DIR);
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit
});

// App setup
const app = express();
app.use(cors()); // Allow all origins
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(compression());
app.use(expressStaticGzip(path.join(__dirname, 'public'), {
  enableBrotli: false, // Only use gzip
  orderPreference: ['gzip'],
}));

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    console.log(`[upload] File saved: ${req.file.originalname} (${req.file.size} bytes)`);
    res.json({ success: true, filename: req.file.originalname, path: req.file.path });
  } catch (err) {
    console.error('[upload] Error:', err.message);
    res.status(500).json({ error: 'File upload failed', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/consolidated-tracking.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'consolidated-tracking.html'));
});



// Multi-server config
function loadServers() {
  if (!fs.existsSync(SERVERS_FILE)) {
    const defaults = {
      activeId: 'bnb',
      servers: [
        { id: 'bnb', label: 'BNB', baseUrl: 'http://195.201.178.120:3001', balancesPath: '/balance', completedPath: '/completed' },
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
    return { activeId: 'default', servers: [{ id: 'default', label: 'Default', baseUrl: (BALANCES_URL||'').replace(/\/(balance|balances).*/, ''), balancesPath: '/balance', completedPath: '/completed' }] };
  }
}
function saveServers(cfg) { fs.writeFileSync(SERVERS_FILE, JSON.stringify(cfg, null, 2)); }
function getActiveServer() { const cfg = loadServers(); return cfg.servers.find(s => s.id === cfg.activeId) || cfg.servers[0]; }

const dbCache = new Map();
const notifierCache = new Map();
const diffHistoryPruneTracker = new Map();

const DIFF_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DIFF_HISTORY_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REPORT_DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT_TIME_PRESETS = {
  today: () => {
    const end = Date.now();
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return { start: start.getTime(), end };
  },
  '24h': () => {
    const end = Date.now();
    return { start: end - (24 * 60 * 60 * 1000), end };
  },
  '7d': () => {
    const end = Date.now();
    return { start: end - (7 * 24 * 60 * 60 * 1000), end };
  },
  '30d': () => {
    const end = Date.now();
    return { start: end - (30 * 24 * 60 * 60 * 1000), end };
  },
  ytd: () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start: start.getTime(), end: now.getTime() };
  },
  all: () => ({ start: 0, end: Date.now() })
};
const REPORT_TRADE_TIME_EXPR = 'COALESCE(t.lastUpdateTime, t.executedTime, t.creationTime)';

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
function maybePruneDiffHistory(serverId, db) {
  if (!db) return;
  const now = Date.now();
  const last = diffHistoryPruneTracker.get(serverId) || 0;
  if (now - last < DIFF_HISTORY_PRUNE_INTERVAL_MS) return;
  const cutoff = now - DIFF_HISTORY_RETENTION_MS;
  try {
    const info = db.prepare('DELETE FROM diff_history WHERE ts < ?').run(cutoff);
    diffHistoryPruneTracker.set(serverId, now);
    if (info.changes > 0) {
      console.log(`[diffdata:${serverId}] Pruned ${info.changes} rows older than ${new Date(cutoff).toISOString()}`);
    }
  } catch (err) {
    console.error(`[diffdata:${serverId}] Failed to prune history:`, err?.message || err);
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
    // Query to find the server token settings effective at (or just before) the diff timestamp
    const lookupStmt = db.prepare('SELECT buy, sell FROM server_tokens WHERE name = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1');

    const rows = data.map((raw) => {
      if (!raw || raw.curId == null || raw.ts == null) return null;
      const curId = String(raw.curId);
      const ts = parseInt(raw.ts, 10);
      if (!Number.isFinite(ts)) return null;
      const tokenName = tokenNameFromCurId(curId);
      const isoTs = new Date(ts).toISOString();

      let tokenRow = null;
      if (tokenName) {
        tokenRow = lookupStmt.get(tokenName, isoTs);
        if (!tokenRow) {
          const upper = tokenName.toUpperCase();
          if (upper !== tokenName) tokenRow = lookupStmt.get(upper, isoTs);
        }
        if (!tokenRow) {
          const lower = tokenName.toLowerCase();
          if (lower !== tokenName) tokenRow = lookupStmt.get(lower, isoTs);
        }
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
    maybePruneDiffHistory(server.id, db);
  } catch (err) {
    const status = err?.response?.status;
    const notifier = ensureNotifier(server.id);
    if (status === 404) {
      console.log(`[diffdata:${server.label}] 404 (not found). Skipping.`);
      if (notifier) {
        notifier.notify('pollFailed', {
          title: `Poll Failed: ${server.label}`,
          message: `Failed to fetch diffdata (404 Not Found)`,
          details: { server: server.label, error: '404 Not Found' },
          uniqueKey: 'diffdata-404'  // Add unique key to differentiate from other poll failures
        }).catch(err => console.error('Notifier error:', err.message));
      }
    } else {
      // Handle other types of errors, such as connection failures
      console.error(`[diffdata:${server.label}] Fetch/store error:`, err.message);
      if (notifier) {
        notifier.notify('pollFailed', {
          title: `Poll Failed: ${server.label}`,
          message: `Failed to fetch diffdata (${err.message})`,
          details: { server: server.label, error: err.message, type: 'connection-error' },
          uniqueKey: `diffdata-conn-error-${err.code || 'unknown'}`  // Unique key based on error code
        }).catch(err => console.error('Notifier error:', err.message));
      }
    }
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

function getMlServiceBaseUrl() {
  const base = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8100';
  return (typeof base === 'string' ? base : '').replace(/\/$/, '');
}

function sanitizeMlPayload(payload) {
  const clean = {};
  if (!payload || typeof payload !== 'object') return clean;
  for (const [key, value] of Object.entries(payload)) {
    if (value === '' || value === undefined || value === null) {
      clean[key] = null;
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        clean[key] = null;
        continue;
      }
      const lowered = trimmed.toLowerCase();
      if (lowered === 'true' || lowered === 'false') {
        clean[key] = lowered === 'true';
        continue;
      }
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        clean[key] = num;
        continue;
      }
      clean[key] = trimmed;
      continue;
    }
    if (typeof value === 'number') {
      clean[key] = Number.isFinite(value) ? value : null;
      continue;
    }
    if (typeof value === 'boolean') {
      clean[key] = value;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}


async function proxyMlServicePredict(baseUrl, payloads, includeProbabilities, modelPath) {
  if (!baseUrl) {
    throw new Error('ML service base URL is not configured.');
  }
  const response = await axios.post(`${baseUrl}/predict`, {
    payloads,
    include_probabilities: includeProbabilities,
    model_path: modelPath,
  }, { timeout: 15000 });
  const data = normalizePredictionResponse(response.data, payloads.length);
  data.source = data.source || 'ml-service';
  return data;
}

function normalizePredictionResponse(raw, payloadCount) {
  const data = raw && typeof raw === 'object' ? { ...raw } : {};
  if (payloadCount === 1 && data.success_probability == null) {
    const probability = extractSuccessProbability(data.probabilities);
    if (probability != null) data.success_probability = probability;
  }
  return data;
}

function extractSuccessProbability(probabilities) {
  if (!Array.isArray(probabilities) || !probabilities.length) return null;
  const first = probabilities[0];
  if (Array.isArray(first) && first.length > 1 && Number.isFinite(first[1])) return Number(first[1]);
  if (Number.isFinite(first)) return Number(first);
  return null;
}

async function runLocalPredictBatch(payloads) {
  const scriptPath = path.join(__dirname, 'predict.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('predict.py script is missing; cannot run local predictions.');
  }
  const results = [];
  for (const payload of payloads) {
    results.push(await runPredictScriptOnce(scriptPath, payload));
  }
  return buildLocalPredictResponse(results, payloads.length);
}

function buildLocalPredictResponse(results, payloadCount) {
  const probabilities = results.map((entry) => {
    const prob = Number.isFinite(entry.success_probability) ? entry.success_probability : 0;
    const clamped = prob < 0 ? 0 : prob > 1 ? 1 : prob;
    return [Number((1 - clamped).toFixed(6)), Number(clamped.toFixed(6))];
  });
  const predictions = results.map((entry) => {
    if (Number.isFinite(entry.prediction)) return entry.prediction;
    const prob = Number.isFinite(entry.success_probability) ? entry.success_probability : 0;
    return prob >= 0.5 ? 1 : 0;
  });
  const response = { predictions, probabilities, source: 'local-script' };
  if (payloadCount === 1 && Number.isFinite(results[0]?.success_probability)) {
    response.success_probability = results[0].success_probability;
  }
  return response;
}

function getPythonCommandCandidates() {
  const candidates = [];
  if (process.env.PYTHON_BIN) candidates.push(process.env.PYTHON_BIN);
  if (process.platform === 'win32') {
    candidates.push('python', 'python3');
  } else {
    candidates.push('python3', 'python');
  }
  const unique = [];
  for (const cmd of candidates) {
    if (cmd && !unique.includes(cmd)) unique.push(cmd);
  }
  return unique;
}

async function runPredictScriptOnce(scriptPath, payload) {
  const values = [
    payload.buyDiffBps,
    payload.sellDiffBps,
    payload.Diff,
    payload.DexSlip,
    payload.CexSlip,
  ].map((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  });

  const args = [scriptPath, ...values.map((value) => String(value))];
  const candidates = getPythonCommandCandidates();
  let lastErr = null;

  for (const cmd of candidates) {
    try {
      const result = await spawnPredictProcess(cmd, args);
      const successProbability = Number(result.success_probability);
      if (!Number.isFinite(successProbability)) {
        throw new Error('predict.py did not return a numeric success_probability');
      }
      return {
        success_probability: successProbability,
        prediction: Number.isFinite(result.prediction) ? Number(result.prediction) : undefined,
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Unable to locate a usable Python interpreter for predict.py');
}

function spawnPredictProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: __dirname });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`predict.py exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        return reject(error);
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        const error = new Error('predict.py returned empty output');
        error.stdout = stdout;
        error.stderr = stderr;
        return reject(error);
      }
      try {
        const parsed = JSON.parse(trimmed);
        resolve(parsed);
      } catch (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

function shouldFallbackToLocal(err) {
  if (!err) return false;
  if (err.code && ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(err.code)) return true;
  if (err.response?.status >= 500) return true;
  if (err.isAxiosError && !err.response) return true;
  return false;
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

async function maybeNotifyLowProfitTrade({ server, notifier, trade, origin = 'store', ruleOverride }) {
  if (!notifier || !trade) {
    return { triggered: false, reason: 'missing_context' };
  }
  const serverId = server?.id || 'unknown';
  const serverLabel = server?.label || serverId;
  const rule = ruleOverride || resolveProfitRule(notifier);
  const profitValue = (Number(trade.executedQtyDst) * Number(trade.executedDstPrice)) - (Number(trade.executedSrcPrice) * Number(trade.executedQtySrc)) - (0.0002 * Number(trade.executedQtyDst) * Number(trade.executedDstPrice));
  console.log(`[notify:profit:${origin}] evaluate trade=${trade.id ?? 'unknown'} server=${serverId} profit=${Number.isFinite(profitValue) ? profitValue : 'null'} threshold=${rule.threshold}`);
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
    title: title,
    message: message,
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
      console.log(`[notify:profit:${origin}] skipped by cooldown trade=${trade.id ?? 'unknown'} server=${serverLabel}`);
      return { triggered: false, reason: 'cooldown', result };
    }
    console.log(`[notify:profit:${origin}] dispatched trade=${trade.id ?? 'unknown'} server=${serverLabel} profit=${profitValue}`);
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
  const profitValue = (Number(trade.executedQtyDst) * Number(trade.executedDstPrice)) - (Number(trade.executedSrcPrice) * Number(trade.executedQtySrc)) - (0.0002 * Number(trade.executedQtyDst) * Number(trade.executedDstPrice));
  console.log(`[notify:high-profit:${origin}] evaluate trade=${trade.id ?? 'unknown'} server=${serverId} profit=${Number.isFinite(profitValue) ? profitValue : 'null'} threshold=${rule.threshold}`);
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
    title: title,
    message: message,
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
      console.log(`[notify:high-profit:${origin}] skipped by cooldown trade=${trade.id ?? 'unknown'} server=${serverLabel}`);
      return { triggered: false, reason: 'cooldown', result };
    }
    console.log(`[notify:high-profit:${origin}] dispatched trade=${trade.id ?? 'unknown'} server=${serverLabel} profit=${profitValue}`);
    return { triggered: true, result };
  } catch (err) {
    console.error(`[notify:high-profit:${origin}] notify error trade=${trade.id ?? 'unknown'} server=${serverLabel}:`, err?.message || err);
    return { triggered: false, error: err };
  }
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
  console.log(
    `[notify:lowCexVolume:${origin}] evaluate server=${serverId} curId=${curId} volume=${hasVolume ? numericVolume : 'null'} threshold=${rule.threshold}`
  );
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

  console.log(
    `[notify:lowCexVolume:${origin}] triggering server=${serverLabel} token=${tokenLabel} volume=${numericVolume} threshold=${rule.threshold} delta=${delta}`
  );

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
      console.log(
        `[notify:lowCexVolume:${origin}] skipped by cooldown server=${serverLabel} token=${tokenLabel} volume=${numericVolume}`
      );
      return { triggered: false, reason: 'cooldown', result };
    }
    console.log(
      `[notify:lowCexVolume:${origin}] dispatched server=${serverLabel} token=${tokenLabel} volume=${numericVolume}`
    );
    return { triggered: true, result };
  } catch (err) {
    console.error(
      `[notify:lowCexVolume:${origin}] notify error server=${serverLabel} token=${tokenLabel}:`,
      err?.message || err
    );
    return { triggered: false, error: err };
  }
}

function calculateTotals(snapshot) {
  let totalUsdt = 0;
  let hasValidData = false;

  if (!snapshot || typeof snapshot !== 'object' || Object.keys(snapshot).length === 0) {
    return { totalUsdt: null, totalCoin: null };
  }

  for (const [name, ex] of Object.entries(snapshot)) {
    if (!ex || typeof ex !== 'object') continue;

    if (name === 'BinanceF') {
      if (ex.usdtVal != null && Number.isFinite(Number(ex.usdtVal))) {
        totalUsdt += Number(ex.usdtVal);
        hasValidData = true;
      }
    } else {
      if (ex.coinVal != null && Number.isFinite(Number(ex.coinVal))) {
        totalUsdt += Number(ex.coinVal);
        hasValidData = true;
      }
    }
  }

  if (!hasValidData) {
    return { totalUsdt: null, totalCoin: null };
  }

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

    const assignToken = (value) => {
      if (value != null && value !== '') {
        out.Token = String(value);
      }
    };
    const assignLhd = (value) => {
      const num = Number(value);
      if (Number.isFinite(num)) out.LHdelta = num;
    };

    if (p && typeof p === 'object') {
      for (const key of Object.keys(p)) {
        const lower = key.toLowerCase();
        if (!out.Token && (lower === 'token' || lower === 'pair' || lower === 'asset')) {
          assignToken(p[key]);
        }
        if (lower === 'lhdelta' || lower === 'lhd' || lower === 'lh') {
          assignLhd(p[key]);
        }
      }
    }

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
      const execKey = ['Market', 'Limit', 'PostOnly', 'IOC', 'FOK'].find((k) =>
        Object.prototype.hasOwnProperty.call(p, k)
      );
      if (execKey) {
        out.Exec = execKey;
        const v = Number(p[execKey]);
        if (Number.isFinite(v)) out.CexSlip = v;
      }
      // Find Dex as value of any key whose value is 'BUY' or 'SELL'
      for (const [_k, v] of Object.entries(p)) {
        if (String(v) === 'SELL' || String(v) === 'BUY') {
          out.Dex = String(v);
          if (!out.Token) assignToken(_k);
          break;
        }
      }
      // Find numeric key/value pair -> key = Diff, value = DexSlip
      for (const [__k, v] of Object.entries(p)) {
        const nk = Number(__k);
        const nv = Number(v);
        if (Number.isFinite(nk) && Number.isFinite(nv)) {
          out.Diff = nk;
          out.DexSlip = nv;
          break;
        }
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
    if (totalUsdt === null || !Number.isFinite(totalUsdt)) {
      console.warn(`[balances:${server.label}] Skipping storing balance because totalUsdt is null or not a finite number.`);
      return;
    }
    const row = { timestamp: new Date().toISOString(), total_usdt: totalUsdt, total_coin: totalCoin, raw_data: JSON.stringify(data) };
    const db = ensureDb(server.id);
    db.prepare(`INSERT INTO balances_history (timestamp, total_usdt, total_coin, raw_data) VALUES (@timestamp,@total_usdt,@total_coin,@raw_data)`).run(row);
    console.log(`[balances:${server.label}] Stored @ ${row.timestamp} | total_usdt=${totalUsdt}${totalCoin != null ? ` total_coin=${totalCoin}` : ''}`);
  } catch (err) {
    const status = err?.response?.status;
    const notifier = ensureNotifier(server.id);
    if (status === 404) {
      console.log(`[balances:${server.label}] 404 (not found). Skipping.`);
    } else {
      // Handle other types of errors, such as connection failures
      console.error(`[balances:${server.label}] Fetch/store error:`, err.message);
      if (notifier) {
        notifier.notify('pollFailed', {
          title: `Poll Failed: ${server.label}`,
          message: `Failed to fetch balances (${err.message})`,
          details: { server: server.label, error: err.message, type: 'connection-error' },
          uniqueKey: `balances-conn-error-${err.code || 'unknown'}`  // Unique key based on error code
        }).catch(err => console.error('Notifier error:', err.message));
      }
    }
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
    const notifier = ensureNotifier(server.id);
    if (notifier) {
      notifier.notify('pollFailed', {
        title: `Poll Failed: ${server.label}`,
        message: `Failed to fetch trades (${err.message})`,
        details: { server: server.label, error: err.message, type: 'connection-error' },
        uniqueKey: `trades-conn-error-${err.code || 'unknown'}`  // Unique key based on error code
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

    // Robust token parser (matching /status/server logic)
    const parseTokens = (str) => {
      const tokenMatches = [...str.matchAll(/\b([A-Za-z0-9_]+)\(([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\)/g)];
      return tokenMatches.map(match => ({
        name: match[1],
        buy: safeNumber(match[2]),
        sell: safeNumber(match[3]),
      }));
    };

    const lines = text.split(/\r?\n/);
    let tokens = [];

    // Try to find SDIFF line
    const sdiffDataLine = lines.find(l => l.trim().startsWith('SDIFF_'));
    
    if (sdiffDataLine) {
      // Try to parse tokens from this line first
      const propsIndex = sdiffDataLine.indexOf('Mindiff:');
      if (propsIndex > -1) {
        const propsStr = sdiffDataLine.substring(propsIndex);
        tokens = parseTokens(propsStr);
      }
      
      // If multi-line format is suspected or tokens not found, try looking in adjacent lines or full text if needed
      // But sticking to the /status/server logic, it primarily looks at the propsLine found via 'Mindiff:' check
      if (!tokens.length) {
         const propsLine = lines.find(l => l.includes('Mindiff:'));
         if (propsLine) {
             tokens = parseTokens(propsLine);
         }
      }
    } else {
        // Fallback: search for any line with Mindiff
        const propsLine = lines.find(l => l.includes('Mindiff:'));
        if (propsLine) {
            tokens = parseTokens(propsLine);
        }
    }

    if (tokens && tokens.length) {
      const stmt = db.prepare('INSERT INTO server_tokens (timestamp, name, buy, sell) VALUES (@timestamp, @name, @buy, @sell)');
      db.transaction((items) => {
        for (const item of items) stmt.run({ timestamp, ...item });
      })(tokens);
      console.log(`[status:${server.label}] Stored ${tokens.length} tokens.`);
    }

    // Parse and store gas balances
    const blacklistLine = lines.find(l => l.startsWith('SDIFF Uniswap BlackList:'));
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
        const insertGasStmt = db.prepare('INSERT INTO gas_balances (timestamp, contract, gas, is_low) VALUES (@timestamp, @contract, @gas, @is_low)');
        const insertTrackingStmt = db.prepare('INSERT INTO gas_balance_tracking (timestamp, contract, gas_balance, gas_deposit, source) VALUES (@timestamp, @contract, @gas_balance, @gas_deposit, @source)');
        
        const uniqueGasBalances = new Map();
        for (const item of gasBalances) {
          if (item.contract.toLowerCase() !== 'total') {
            uniqueGasBalances.set(item.contract, item);
          }
        }
        const processedBalances = Array.from(uniqueGasBalances.values());

        if (processedBalances.length > 0) {
            db.transaction((items) => {
              let totalGas = 0;
              let hasFiniteGas = false;
              for (const item of items) {
                insertGasStmt.run({ timestamp, ...item });
                const numericGas = Number(item.gas);
                if (Number.isFinite(numericGas)) {
                  totalGas += numericGas;
                  hasFiniteGas = true;
                }
              }
              if (hasFiniteGas) {
                insertTrackingStmt.run({
                  timestamp,
                  contract: '__total__',
                  gas_balance: totalGas,
                  gas_deposit: 0,
                  source: 'auto-total'
                });
              }
            })(processedBalances);
            console.log(`[status:${server.label}] Stored ${processedBalances.length} gas balances.`);
        }

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
        uniqueKey: `status-conn-error-${err.code || 'unknown'}`  // Unique key based on error code
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
      console.log(`[contracts:${serverId}] Stored ${txs.length} transactions.`);
    }

  } catch (err) {
    console.error(`[contracts:${serverId}] Fetch/store error:`, err.message);
    const notifier = ensureNotifier(serverId);
    if (notifier) {
      notifier.notify('pollFailed', {
        title: `Poll Failed: ${serverId}`,
        message: `Failed to fetch contract transactions (${err.message})`,
        details: { server: serverId, error: err.message, type: 'connection-error' },
        uniqueKey: `contracts-conn-error-${err.code || 'unknown'}`  // Unique key based on error code
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

async function fetchAllAndStore() {
  const cfg = loadServers();
  for (const s of cfg.servers) {
    await ensureInitialTradesSync(s);
    // Ensure server status (tokens) is updated first
    await fetchStatusAndStoreFor(s);
    // Then fetch balances, trades, diff data, etc. in parallel
    await Promise.allSettled([fetchBalancesAndStoreFor(s), fetchTradesAndStoreFor(s), fetchDiffDataAndStoreFor(s), fetchContractTxsAndStoreFor(s)]);
  }
}

async function sendHourlyDigest() {
  const cfg = loadServers();
  const servers = cfg.servers;

  // Process each server to send hourly digest
  for (const server of servers) {
    const notifier = ensureNotifier(server.id);
    if (!notifier) continue;

    try {
      const serverIp = server.baseUrl.split(':')[1].substring(2);
      const resp = await axios.get(`http://${serverIp}:3001/`, { timeout: 10000 });
      const text = resp.data;

      if (typeof text !== 'string') {
        throw new Error('Invalid status response from server');
      }

      let message = `📊 *Hourly Digest for ${server.label}*\n\n`;

      const lines = text.split(/\r?\n/);
      const sdiffLine = lines.find(l => l.startsWith('SDIFF_Uniswap_ckhvar2'));
      if (sdiffLine) {
        const parts = sdiffLine.split(/\s+/);
        const propsIndex = sdiffLine.indexOf('Mindiff:');
        const propsStr = propsIndex > -1 ? sdiffLine.substring(propsIndex) : '';
        const up = parts.length > 4 ? parts[4] : 'N/A';
        const mindiff = propsStr.match(/Mindiff:([\d.]+)/)?.[1];
        const maxOrderSize = propsStr.match(/MaxOrderSize: (\d+)/)?.[1];
        const tokens = propsStr.match(/\w+\([\d.]+,[\d.]+\)/g) || [];
        message += `🔄 *Server Status*\n`;
        message += `⏱️ Uptime: ${up} | 🎯 Mindiff: ${mindiff} | 📦 MaxOrderSize: ${maxOrderSize}\n`;
        message += `🪙 Tokens: ${tokens.join(', ')}\n\n`;
      }

      const gasStatusLine = lines.find(l => l.startsWith('SDIFF Uniswap BlackList:'));
      if (gasStatusLine) {
        const gasStr = gasStatusLine.replace('SDIFF Uniswap BlackList:', '').trim();
        const gasEntries = gasStr.split(',').map(item => item.trim()).filter(Boolean);
        
        if (gasEntries.length > 0) {
          message += `⛽ *Gas Status*\n`;
          gasEntries.forEach(entry => {
            const [key, value] = entry.split(':');
            if (key && value !== undefined) {
              const gasValue = parseFloat(value);
              if (!isNaN(gasValue)) {
                // Format gas values less than 2 in red (using a red indicator)
                const gasDisplay = gasValue < 2 ? `🔴 ${key}:${gasValue}` : `🟢 ${key}:${gasValue}`;
                message += `${gasDisplay}\n`;
              } else {
                message += `🟡 ${entry}\n`;
              }
            } else {
              message += `🟡 ${entry}\n`;
            }
          });
          message += `\n`;
        }
      }

      const db = ensureDb(server.id);
      const now = Date.now();
      const oneHourAgo = now - (1 * 60 * 60 * 1000);
      const tradesLast1h = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ?').all(oneHourAgo);
      const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
      const profitLast1h = tradesLast1h.reduce((acc, t) => acc + netProfit(t), 0);

      message += `📈 *Last Hour Performance*\n`;
      message += `💼 Trades: ${tradesLast1h.length} | 💰 Profit: ${Number.isFinite(profitLast1h) ? profitLast1h.toFixed(2) : '0.00'}\n\n`;

      const balanceRow = db.prepare('SELECT raw_data FROM balances_history ORDER BY id DESC LIMIT 1').get();
      if (balanceRow) {
        const snapshot = safeJsonParse(balanceRow.raw_data);
        const { dexTotal, cexTotal, combined } = computeDexCex(snapshot);
        message += `💰 *Balance*\n`;
        message += `🪙 Total USDT (DEX + BinanceF): ${Number.isFinite(combined) ? combined.toFixed(2) : '0.00'}\n`;
        message += `🏦 BinanceF Total USDT: ${Number.isFinite(cexTotal) ? cexTotal.toFixed(2) : '0.00'}\n`;
        message += `🔗 DEX Total USDT: ${Number.isFinite(dexTotal) ? dexTotal.toFixed(2) : '0.00'}`;
      }

      // Use channels specified in the rule configuration
      const ruleChannels = notifier.getRuleConfig('hourlyDigest')?.channels;
      const channels = ruleChannels || ['slack']; // Default to slack only if not specified
      
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
  const servers = cfg.servers;
  let message = '📊 *Daily Digest for All Servers*\n\n';

  for (const server of servers) {
    const notifier = ensureNotifier(server.id);
    if (!notifier) continue;

    try {
      const db = ensureDb(server.id);
      const now = Date.now();
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

      const tradesLast24h = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ?').all(twentyFourHoursAgo);
      const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
      const profitLast24h = tradesLast24h.reduce((acc, t) => acc + netProfit(t), 0);

      const txsLast24h = db.prepare('SELECT * FROM contract_transactions WHERE timestamp >= ?').all(twentyFourHoursAgo);
      const successCount = txsLast24h.filter(t => !t.isError).length;
      const errorCount = txsLast24h.length - successCount;
      const successRate = txsLast24h.length > 0 ? (successCount / txsLast24h.length) * 100 : 100;

      const topPairs = db.prepare('SELECT pair, COUNT(*) as count, SUM(executedGrossProfit) as totalProfit FROM completed_trades WHERE lastUpdateTime >= ? GROUP BY pair ORDER BY totalProfit DESC LIMIT 5').all(twentyFourHoursAgo);

      const totalFeeSpend = tradesLast24h.reduce((acc, t) => acc + (t.executedFeeTotal || 0), 0);

      const gasLowOccurrences = db.prepare('SELECT COUNT(*) as count FROM gas_balances WHERE timestamp >= ? AND is_low = 1').get(new Date(twentyFourHoursAgo).toISOString()).count;

      message += `*${server.label}*:\n`;
      message += `  - 24h P&L: ${Number.isFinite(profitLast24h) ? profitLast24h.toFixed(2) : '0.00'}\n`;
      message += `  - Success Rate: ${Number.isFinite(successRate) ? successRate.toFixed(2) : '0.00'}%\n`;
      message += `  - Error Count: ${Number.isFinite(errorCount) ? errorCount : '0'}\n`;
      message += `  - Top Pairs (by profit):\n`;
      for (const pair of topPairs) {
        message += `    - ${pair.pair}: ${Number.isFinite(pair.totalProfit) ? pair.totalProfit.toFixed(2) : '0.00'}\n`;
      }
      message += `  - Total Fee Spend: ${Number.isFinite(totalFeeSpend) ? totalFeeSpend.toFixed(2) : '0.00'}\n`;
      message += `  - Low Gas Occurrences: ${Number.isFinite(gasLowOccurrences) ? gasLowOccurrences : '0'}\n\n`;

    } catch (err) {
      console.error(`Failed to gather daily digest data for server ${server.label}:`, err.message);
    }
  }

  if (servers.length > 0) {
    const firstServerNotifier = ensureNotifier(servers[0].id);
    if (firstServerNotifier) {
      firstServerNotifier.notify('dailyDigest', {
        title: `Daily Digest for All Servers`,
        message: message,
        channels: firstServerNotifier.getRuleConfig('dailyDigest')?.channels
      }).catch(err => console.error('Notifier error (daily digest): ', err.message));
    }
  }
}



// Schedule: every 2 minutes
// cron.schedule('*/2 * * * *', async () => {
//   console.log('[cron] Running scheduled fetch...');
//   try {
//     await fetchAllAndStore();
//   } catch (err) {
//     console.error('[cron] fetchAllAndStore error:', err?.message || err);
//   }
//   try {
//     await checkAllNotifications();
//   } catch (err) {
//     console.error('[cron] Error checking notifications:', err?.message || err);
//   }
//   try {
//     await checkAllLowCexVolumes();
//   } catch (err) {
//     console.error('[cron] Error checking low CEX volumes:', err?.message || err);
//   }
// });

// Initial data fetch on startup to populate data faster
setTimeout(async () => {
  console.log('[startup] Running initial liquidity data fetch...');
  // await fetchLiquidityData();
}, 5000); // Run 5 seconds after startup

cron.schedule('0 * * * *', () => {
  console.log('[cron] Running hourly digest...');
  sendHourlyDigest();
});

cron.schedule('0 8 * * *', () => {
  console.log('[cron] Running daily digest...');
  sendDailyDigest();
});


// Function to check notification conditions for a server
async function checkNotificationConditions(server) {
  const notifier = ensureNotifier(server.id);
  if (!notifier) return;

  const db = ensureDb(server.id);
  
  try {
    // Check for recent trades with low profit
    const recentTrades = db.prepare(
      'SELECT * FROM completed_trades WHERE lastUpdateTime >= ? ORDER BY lastUpdateTime DESC'
    ).all(Date.now() - (2 * 60 * 1000)); // Last 2 minutes worth of trades

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

    // Check for low gas conditions (gas balance checks are already handled in fetchStatusAndStoreFor)
    // Other potential checks could go here
    
  } catch (err) {
    console.error(`[notifications:${server.label}] Error checking notification conditions:`, err.message);
  }
}

// Function to systematically check notifications for all servers
async function checkAllNotifications() {
  const cfg = loadServers();
  for (const server of cfg.servers) {
    await checkNotificationConditions(server);
  }
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
    console.log(
      `[notify:lowCexVolume:cron] server=${server.id} tokens=${latestRows.length} threshold=${rule.threshold}`
    );
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

// Kick off initial fetch on startup (non-blocking)
// fetchAllAndStore();

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
    const cfg = loadServers();
    let serverId = req.query.serverId || cfg.activeId;
    let server = cfg.servers?.find((s) => s.id === serverId);
    if (!server && Array.isArray(cfg.servers) && cfg.servers.length) {
      server = cfg.servers[0];
      serverId = server.id;
    }
    const db = ensureDb(serverId);
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

    const normalizedRows = diffRows.map((row) => {
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

    const buyDiffValues = [];
    const sellDiffValues = [];
    const cexVolValues = [];
    const serverBuyValues = [];
    const serverSellValues = [];
    const dexVolumeValues = [];
    const median = (arr) => {
      const filtered = arr.filter((val) => Number.isFinite(val)).sort((a, b) => a - b);
      if (!filtered.length) return null;
      const mid = Math.floor(filtered.length / 2);
      return filtered.length % 2 === 0 ? (filtered[mid - 1] + filtered[mid]) / 2 : filtered[mid];
    };

    for (const row of normalizedRows) {
      if (Number.isFinite(row.buyDiffBps)) buyDiffValues.push(row.buyDiffBps);
      if (Number.isFinite(row.sellDiffBps)) sellDiffValues.push(row.sellDiffBps);
      if (Number.isFinite(row.cexVol)) cexVolValues.push(row.cexVol);
      if (Number.isFinite(row.serverBuy)) serverBuyValues.push(row.serverBuy);
      if (Number.isFinite(row.serverSell)) serverSellValues.push(row.serverSell);
      if (Number.isFinite(row.dexVolume)) dexVolumeValues.push(row.dexVolume);
    }

    let latestBuyDiffBps = null;
    let latestSellDiffBps = null;
    let latestCexVol = null;
    let latestServerBuy = null;
    let latestServerSell = null;
    let latestDexVolume = null;
    for (let i = normalizedRows.length - 1; i >= 0; i -= 1) {
      const row = normalizedRows[i];
      if (latestBuyDiffBps === null && Number.isFinite(row.buyDiffBps)) latestBuyDiffBps = row.buyDiffBps;
      if (latestSellDiffBps === null && Number.isFinite(row.sellDiffBps)) latestSellDiffBps = row.sellDiffBps;
      if (latestCexVol === null && Number.isFinite(row.cexVol)) latestCexVol = row.cexVol;
      if (latestServerBuy === null && Number.isFinite(row.serverBuy)) latestServerBuy = row.serverBuy;
      if (latestServerSell === null && Number.isFinite(row.serverSell)) latestServerSell = row.serverSell;
      if (latestDexVolume === null && Number.isFinite(row.dexVolume)) latestDexVolume = row.dexVolume;
      if (
        latestBuyDiffBps !== null &&
        latestSellDiffBps !== null &&
        latestCexVol !== null &&
        latestServerBuy !== null &&
        latestServerSell !== null &&
        latestDexVolume !== null
      ) break;
    }

    const diffStats = {
      latestBuyDiffBps,
      latestSellDiffBps,
      medianBuyDiffBps: median(buyDiffValues),
      medianSellDiffBps: median(sellDiffValues),
      latestCexVol,
      medianCexVol: median(cexVolValues),
      latestServerBuy,
      medianServerBuy: median(serverBuyValues),
      latestServerSell,
      medianServerSell: median(serverSellValues),
      latestDexVolume,
      medianDexVolume: median(dexVolumeValues),
    };

    if (offset === 0 && normalizedRows.length) {
      const notifier = ensureNotifier(serverId);
      const latestNormalizedRow = normalizedRows[normalizedRows.length - 1];
      if (notifier && latestNormalizedRow) {
        const notifyArgs = {
          server,
          notifier,
          curId,
          volume: latestNormalizedRow.cexVol,
          timestamp: latestNormalizedRow.ts,
          origin: 'api',
        };
        setImmediate(() => {
          maybeNotifyLowCexVolume(notifyArgs).catch((err) =>
            console.error('[notify:lowCexVolume:api] unhandled error:', err?.message || err)
          );
        });
      }
    }

    let featureInsights = null;
    if (normalizedRows.length) {
      const timestamps = normalizedRows.map(row => row.ts).filter(ts => Number.isFinite(ts));
      if (timestamps.length) {
        const minTs = Math.min(...timestamps);
        const maxTs = Math.max(...timestamps);
        const windowMs = 15 * 60 * 1000;
        const tradeLimit = Math.min(2000, Math.max(500, normalizedRows.length * 2));
        const trades = db.prepare(`
          SELECT id, lastUpdateTime, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, executedGrossProfit, props, raw_data
          FROM completed_trades
          WHERE lastUpdateTime BETWEEN ? AND ?
            AND (
              instr(COALESCE(props, ''), ?) > 0
              OR instr(COALESCE(raw_data, ''), ?) > 0
            )
          ORDER BY lastUpdateTime ASC
          LIMIT ?
        `).all(minTs - windowMs, maxTs + windowMs, curId, curId, tradeLimit);

        const tradeFeatures = [];
        for (const trade of trades) {
          const tradeTs = safeNumber(trade.lastUpdateTime);
          if (!Number.isFinite(tradeTs)) continue;
          let mergedProps = normalizePropsRaw(trade.props);
          const rawProps = getTradeRawProps(trade);
          if (rawProps) {
            const normalizedRaw = normalizePropsRaw(rawProps);
            mergedProps = { ...normalizedRaw, ...mergedProps };
          }
          const diffVal = Number.isFinite(mergedProps?.Diff) ? mergedProps.Diff : null;
          const dexSlipVal = Number.isFinite(mergedProps?.DexSlip) ? mergedProps.DexSlip : null;
          const cexSlipVal = Number.isFinite(mergedProps?.CexSlip) ? mergedProps.CexSlip : null;
          if (diffVal == null && dexSlipVal == null && cexSlipVal == null) continue;

          const qtyDst = Number(trade.executedQtyDst);
          const dstPrice = Number(trade.executedDstPrice);
          const srcPrice = Number(trade.executedSrcPrice);
          const qtySrc = Number(trade.executedQtySrc);
          let netProfit = null;
          if ([qtyDst, dstPrice, srcPrice, qtySrc].every(v => Number.isFinite(v))) {
            netProfit = (qtyDst * dstPrice) - (srcPrice * qtySrc) - (0.0002 * qtyDst * dstPrice);
          }
          const grossProfit = Number(trade.executedGrossProfit);
          tradeFeatures.push({
            ts: tradeTs,
            diff: diffVal,
            dexSlip: dexSlipVal,
            cexSlip: cexSlipVal,
            netProfit: Number.isFinite(netProfit) ? netProfit : null,
            grossProfit: Number.isFinite(grossProfit) ? grossProfit : null,
          });
        }

        if (tradeFeatures.length) {
          const matchWindowMs = 10 * 60 * 1000;
          let featureIdx = 0;
          for (const row of normalizedRows) {
            const ts = row.ts;
            if (!Number.isFinite(ts)) continue;
            while (featureIdx + 1 < tradeFeatures.length && tradeFeatures[featureIdx + 1].ts <= ts) {
              featureIdx += 1;
            }
            const candidates = [];
            if (tradeFeatures[featureIdx]) candidates.push(tradeFeatures[featureIdx]);
            if (tradeFeatures[featureIdx + 1]) candidates.push(tradeFeatures[featureIdx + 1]);
            let best = null;
            let bestDelta = Infinity;
            for (const cand of candidates) {
              const delta = Math.abs(cand.ts - ts);
              if (delta <= matchWindowMs && delta < bestDelta) {
                best = cand;
                bestDelta = delta;
              }
            }
            if (best) {
              if (best.diff != null) row.Diff = best.diff;
              if (best.dexSlip != null) row.DexSlip = best.dexSlip;
              if (best.cexSlip != null) row.CexSlip = best.cexSlip;
              row.featureTimestamp = best.ts;
              row.featureSource = 'trade-props';
            }
          }

          const diffBuckets = new Map();
          const buyBuckets = new Map();
          const sellBuckets = new Map();
          const accumulateBucket = (map, rawValue, netValue) => {
            const bucket = Math.round(rawValue);
            let rec = map.get(bucket);
            if (!rec) {
              rec = { value: bucket, total: 0, wins: 0, sumProfit: 0 };
              map.set(bucket, rec);
            }
            rec.total += 1;
            if (Number.isFinite(netValue)) {
              if (netValue > 0) rec.wins += 1;
              rec.sumProfit += netValue;
            }
          };

          for (const feat of tradeFeatures) {
            if (feat.diff != null) accumulateBucket(diffBuckets, Math.round(feat.diff * 100) / 100, feat.netProfit);
          }

          for (const row of normalizedRows) {
            if (row.featureSource !== 'trade-props') continue;
            const matched = tradeFeatures.find((feat) => feat.ts === row.featureTimestamp);
            const netProfit = matched?.netProfit;
            if (Number.isFinite(row.buyDiffBps)) accumulateBucket(buyBuckets, row.buyDiffBps, netProfit);
            if (Number.isFinite(row.sellDiffBps)) accumulateBucket(sellBuckets, row.sellDiffBps, netProfit);
          }

          const summarizeBuckets = (map) => Array.from(map.values()).map((rec) => ({
            value: rec.value,
            wins: rec.wins,
            total: rec.total,
            winRate: rec.total ? rec.wins / rec.total : null,
            avgProfit: rec.total ? rec.sumProfit / rec.total : null,
          })).sort((a, b) => a.value - b.value);

          const diffSummary = summarizeBuckets(diffBuckets);
          const buySummary = summarizeBuckets(buyBuckets);
          const sellSummary = summarizeBuckets(sellBuckets);

          let bestBucket = null;
          for (const rec of diffSummary) {
            const candidate = { ...rec };
            if (
              !bestBucket ||
              candidate.wins > bestBucket.wins ||
              (candidate.wins === bestBucket.wins && (candidate.winRate ?? 0) > (bestBucket.winRate ?? 0)) ||
              (candidate.wins === bestBucket.wins && candidate.winRate === bestBucket.winRate && (candidate.avgProfit ?? 0) > (bestBucket.avgProfit ?? 0))
            ) {
              bestBucket = candidate;
            }
          }

          featureInsights = featureInsights || {};
          if (bestBucket) {
            featureInsights.optimalDiff = {
              value: bestBucket.value,
              wins: bestBucket.wins,
              total: bestBucket.total,
              winRate: bestBucket.winRate,
              avgProfit: bestBucket.avgProfit,
            };
          }
          featureInsights.buckets = diffSummary;
          featureInsights.buyBuckets = buySummary;
          featureInsights.sellBuckets = sellSummary;
        }
      }
    }

    const normalizedServerToken = serverToken ? {
      buy: safeNumber(serverToken.buy),
      sell: safeNumber(serverToken.sell),
    } : null;

    res.json({
      diffData: normalizedRows,
      serverToken: normalizedServerToken,
      featureInsights,
      diffStats,
    });
  } catch (err) {
    console.error('[api:/diffdata/history] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/admin/fetch-all', async (req, res) => {
  try {
    await fetchAllAndStore();
    res.json({ status: 'ok', runAt: Date.now() });
  } catch (err) {
    console.error('[api:/admin/fetch-all] error:', err.message);
    res.status(500).json({ error: 'Failed to trigger fetch', details: err.message });
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

app.get('/gas-balance/tracking', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const contract = req.query.contract ? String(req.query.contract).trim() : '';
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 1000));
    let sql = 'SELECT id, timestamp, contract, gas_balance, gas_deposit, source, note FROM gas_balance_tracking';
    const params = [];
    if (contract) {
      sql += ' WHERE contract = ?';
      params.push(contract);
    }
    sql += ' ORDER BY datetime(timestamp) DESC, id DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    console.error('[api:/gas-balance/tracking] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/gas-balance/deposit', (req, res) => {
  try {
    const body = req.body || {};
    let contract = typeof body.contract === 'string' ? body.contract.trim() : '';
    const deposit = Number(body.amount);
    let gasBalance = body.gasBalance;
    const note = typeof body.note === 'string' ? body.note.trim() : '';

    if (!contract) {
      contract = '__total__';
    }
    if (!Number.isFinite(deposit) || deposit <= 0) {
      return res.status(400).json({ error: 'Deposit amount must be a positive number' });
    }

    if (gasBalance !== undefined && gasBalance !== null && gasBalance !== '') {
      gasBalance = Number(gasBalance);
      if (!Number.isFinite(gasBalance)) {
        return res.status(400).json({ error: 'Gas balance must be a valid number' });
      }
    } else {
      gasBalance = null;
    }

    const db = getDbFromReq(req);
    let previousBalance = null;
    if (gasBalance == null) {
      if (contract === '__total__') {
        const latestTracking = db.prepare('SELECT gas_balance FROM gas_balance_tracking WHERE contract = ? ORDER BY datetime(timestamp) DESC LIMIT 1').get(contract);
        if (latestTracking && latestTracking.gas_balance != null && Number.isFinite(Number(latestTracking.gas_balance))) {
          previousBalance = Number(latestTracking.gas_balance);
        } else {
          const latestTimestampRow = db.prepare('SELECT timestamp FROM gas_balances ORDER BY datetime(timestamp) DESC LIMIT 1').get();
          if (latestTimestampRow?.timestamp) {
            const totalRow = db.prepare('SELECT SUM(gas) AS total FROM gas_balances WHERE timestamp = ?').get(latestTimestampRow.timestamp);
            const totalVal = Number(totalRow?.total);
            if (Number.isFinite(totalVal)) previousBalance = totalVal;
          }
        }
      } else {
        const latest = db.prepare('SELECT gas FROM gas_balances WHERE contract = ? ORDER BY datetime(timestamp) DESC LIMIT 1').get(contract);
        if (latest && latest.gas != null && Number.isFinite(Number(latest.gas))) {
          previousBalance = Number(latest.gas);
        }
      }
      if (Number.isFinite(previousBalance)) {
        gasBalance = previousBalance + deposit;
      }
    }

    const timestamp = new Date().toISOString();
    const insert = db.prepare('INSERT INTO gas_balance_tracking (timestamp, contract, gas_balance, gas_deposit, source, note) VALUES (?, ?, ?, ?, ?, ?)');
    const info = insert.run(timestamp, contract, gasBalance, deposit, 'manual', note || null);

    res.json({
      id: info.lastInsertRowid,
      timestamp,
      contract,
      gas_balance: gasBalance,
      gas_deposit: deposit,
      source: 'manual',
      note: note || null
    });
  } catch (err) {
    console.error('[api:/gas-balance/deposit] error:', err.message);
    res.status(500).json({ error: 'Failed to record gas deposit' });
  }
});

app.get('/gas-balance/consumption', (req, res) => {
  try {
    const hoursParam = parseInt(req.query.hours, 10);
    const hours = Math.max(1, Math.min(Number.isFinite(hoursParam) ? hoursParam : 48, 168));
    const db = getDbFromReq(req);
    const result = computeGasConsumptionSeries(db, hours);
    res.json(result);
  } catch (err) {
    console.error('[api:/gas-balance/consumption] error:', err.message);
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

app.get('/trades/daily-profit', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const start = req.query.start ? new Date(req.query.start) : null;
    const end = req.query.end ? new Date(req.query.end) : null;

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end date parameters are required' });
    }

    const rows = db.prepare(
      `SELECT lastUpdateTime, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc FROM completed_trades WHERE lastUpdateTime BETWEEN ? AND ?`
    ).all(start.getTime(), end.getTime());

    const dailyProfits = {};

    for (const row of rows) {
      const date = new Date(row.lastUpdateTime).toISOString().split('T')[0];
      const netProfit = (row.executedQtyDst * row.executedDstPrice) - (row.executedSrcPrice * row.executedQtySrc) - (0.0002 * row.executedQtyDst * row.executedDstPrice);
      if (!dailyProfits[date]) {
        dailyProfits[date] = 0;
      }
      dailyProfits[date] += netProfit;
    }

    const result = Object.keys(dailyProfits).map(date => ({
      date: date,
      profit: dailyProfits[date]
    }));

    res.json(result);
  } catch (err) {
    console.error('[api:/trades/daily-profit] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/notifications/recent', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 100, 500));
    // Map the database field 'created_at' to 'createdAt' for JavaScript convention
    const items = db.prepare(`
      SELECT
        id,
        server_id as serverId,
        rule,
        title,
        channel,
        status,
        message,
        details,
        created_at as createdAt,
        read
      FROM notifications_log
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    const itemsWithBooleanRead = items.map(item => ({
      ...item,
      read: item.read === 1
    }));
    res.json({ items: itemsWithBooleanRead });
  } catch (err) {
    console.error('[api:/notifications/recent] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/notifications/mark-read', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of notification IDs is required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE notifications_log SET read = 1 WHERE id IN (${placeholders})`);
    const info = stmt.run(ids);
    res.json({ success: true, changes: info.changes });
  } catch (err) {
    console.error('[api:/notifications/mark-read] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/notifications/mark-unread', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of notification IDs is required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE notifications_log SET read = 0 WHERE id IN (${placeholders})`);
    const info = stmt.run(ids);
    res.json({ success: true, changes: info.changes });
  } catch (err) {
    console.error('[api:/notifications/mark-unread] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/notifications/delete', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of notification IDs is required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM notifications_log WHERE id IN (${placeholders})`);
    const info = stmt.run(ids);
    res.json({ success: true, changes: info.changes });
  } catch (err) {
    console.error('[api:/notifications/delete] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/notifications/delete', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of notification IDs is required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM notifications_log WHERE id IN (${placeholders})`);
    const info = stmt.run(ids);
    res.json({ success: true, changes: info.changes });
  } catch (err) {
    console.error('[api:/notifications/delete] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Consolidated Tracking Endpoints
app.get('/consolidated/total-balance-history', async (req, res) => {
  try {
    const cfg = loadServers();
    const allServersRawBalances = new Map(); // Map<serverId, [{timestamp, total_usdt}]>
    const allTimestamps = new Set();

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const rows = db.prepare(
          'SELECT timestamp, total_usdt FROM balances_history ORDER BY timestamp ASC'
        ).all();
        allServersRawBalances.set(server.id, rows);
        rows.forEach(row => allTimestamps.add(row.timestamp));
      } catch (serverErr) {
        console.error(`[api:/consolidated/total-balance-history] server:${server.id} ${serverErr.message}`);
      }
    }

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const consolidatedBalances = {};

    // Pre-process each server's balances with LOCF
    const filledServerBalances = new Map(); // Map<serverId, Map<timestamp, total_usdt>>
    for (const server of cfg.servers) {
      const serverId = server.id;
      const rawBalances = allServersRawBalances.get(serverId) || [];
      const serverFilledMap = new Map(); // Map<timestamp, total_usdt> for this server
      let lastKnownBalance = 0; // Default to 0 if no prior balance

      let rawIdx = 0;
      for (const timestamp of sortedTimestamps) {
        let currentBalance = null;

        // Find the balance for the current timestamp or the most recent one before it
        while (rawIdx < rawBalances.length && new Date(rawBalances[rawIdx].timestamp).getTime() <= new Date(timestamp).getTime()) {
          currentBalance = rawBalances[rawIdx].total_usdt;
          rawIdx++;
        }

        if (currentBalance !== null && currentBalance !== 0) {
          lastKnownBalance = currentBalance;
        }
        serverFilledMap.set(timestamp, lastKnownBalance);
      }
      filledServerBalances.set(serverId, serverFilledMap);
    }

    // Aggregate across all servers for each timestamp
    for (const timestamp of sortedTimestamps) {
      let currentConsolidatedTotal = 0;
      for (const server of cfg.servers) {
        const serverId = server.id;
        const serverBalance = filledServerBalances.get(serverId)?.get(timestamp) || 0;
        currentConsolidatedTotal += serverBalance;
      }
      consolidatedBalances[timestamp] = currentConsolidatedTotal;
    }

    const result = sortedTimestamps.map(timestamp => {
      const perServer = cfg.servers.map(server => ({
        serverId: server.id,
        serverLabel: server.label,
        totalUsdt: filledServerBalances.get(server.id)?.get(timestamp) || 0,
      }));
      return {
        timestamp,
        totalUsdt: consolidatedBalances[timestamp] || 0,
        servers: perServer,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[api:/consolidated/total-balance-history] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/consolidated/balances/history', async (req, res) => {
  try {
    const cfg = loadServers();
    const allServersBalances = [];

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const rows = db.prepare(
          'SELECT timestamp, total_usdt, raw_data FROM balances_history ORDER BY timestamp ASC'
        ).all();

        const enriched = rows.map(r => {
          let snapshot;
          try { snapshot = JSON.parse(r.raw_data); } catch { snapshot = null; }
          const parts = computeDexCex(snapshot);
          const combined = Number.isFinite(parts.combined) && parts.combined !== 0 ? parts.combined : r.total_usdt;
          return {
            timestamp: r.timestamp,
            total_usdt: combined,
            total_dex_usdt: parts.dexTotal,
            total_cex_usdt: parts.cexTotal,
            serverId: server.id,
            serverLabel: server.label
          };
        });
        allServersBalances.push(...enriched);
      } catch (serverErr) {
        console.error(`[api:/consolidated/balances/history] server:${server.id} ${serverErr.message}`);
      }
    }

    // Aggregate balances by timestamp
    const consolidated = {};
    for (const item of allServersBalances) {
      if (!consolidated[item.timestamp]) {
        consolidated[item.timestamp] = { timestamp: item.timestamp, total_usdt: 0, total_dex_usdt: 0, total_cex_usdt: 0 };
      }
      consolidated[item.timestamp].total_usdt += item.total_usdt || 0;
      consolidated[item.timestamp].total_dex_usdt += item.total_dex_usdt || 0;
      consolidated[item.timestamp].total_cex_usdt += item.total_cex_usdt || 0;
    }

    const sortedConsolidated = Object.values(consolidated).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json(sortedConsolidated);
  } catch (err) {
    console.error('[api:/consolidated/balances/history] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/consolidated/daily-profit', async (req, res) => {
  try {
    const cfg = loadServers();
    const allServersDailyProfits = {};

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const rows = db.prepare(
          `SELECT
            STRFTIME('%Y-%m-%d', DATETIME(lastUpdateTime / 1000, 'unixepoch')) AS trade_date,
            SUM((executedQtyDst * executedDstPrice) - (executedSrcPrice * executedQtySrc) - (0.0002 * executedQtyDst * executedDstPrice)) AS daily_profit
          FROM completed_trades
          GROUP BY trade_date
          ORDER BY trade_date ASC`
        ).all();

        for (const row of rows) {
          if (!allServersDailyProfits[row.trade_date]) {
            allServersDailyProfits[row.trade_date] = 0;
          }
          allServersDailyProfits[row.trade_date] += row.daily_profit || 0;
        }
      } catch (serverErr) {
        console.error(`[api:/consolidated/daily-profit] server:${server.id} ${serverErr.message}`);
      }
    }

    const result = Object.keys(allServersDailyProfits).map(date => ({
      date: date,
      profit: allServersDailyProfits[date]
    })).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    res.json(result);
  } catch (err) {
    console.error('[api:/consolidated/daily-profit] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/consolidated/balances/latest', async (req, res) => {
  try {
    const cfg = loadServers();
    const latestBalances = [];

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const row = db.prepare(
          'SELECT timestamp, total_usdt, raw_data FROM balances_history ORDER BY id DESC LIMIT 1'
        ).get();

        if (row) {
          let snapshot;
          try { snapshot = JSON.parse(row.raw_data); } catch { snapshot = null; }
          const parts = computeDexCex(snapshot);
          const combined = Number.isFinite(parts.combined) && parts.combined !== 0 ? parts.combined : row.total_usdt;
          latestBalances.push({
            serverId: server.id,
            serverLabel: server.label,
            timestamp: row.timestamp,
            totalUsdt: combined,
            dexTotalUsdt: parts.dexTotal,
            cexTotalUsdt: parts.cexTotal
          });
        }
      } catch (serverErr) {
        console.error(`[api:/consolidated/balances/latest] server:${server.id} ${serverErr.message}`);
      }
    }
    res.json(latestBalances);
  } catch (err) {
    console.error('[api:/consolidated/balances/latest] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/consolidated/daily-profit/latest', async (req, res) => {
  try {
    const cfg = loadServers();
    const latestDailyProfits = [];
    const today = new Date();
    // Set to start of current day in UTC (00:00:00 UTC)
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const startOfDayTimestamp = startOfDay.getTime();

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        // Query trades from start of UTC day to current time
        const tradesToday = db.prepare(`
          SELECT executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, lastUpdateTime 
          FROM completed_trades 
          WHERE lastUpdateTime >= ?
        `).all(startOfDayTimestamp);
        
        const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
        const profitToday = tradesToday.reduce((acc, t) => acc + netProfit(t), 0);

        latestDailyProfits.push({
          serverId: server.id,
          serverLabel: server.label,
          profit: profitToday
        });
      } catch (serverErr) {
        console.error(`[api:/consolidated/daily-profit/latest] server:${server.id} ${serverErr.message}`);
      }
    }
    
    // Add total row
    const totalProfit = latestDailyProfits.reduce((total, item) => total + item.profit, 0);
    latestDailyProfits.push({
      serverLabel: 'Total',
      profit: totalProfit
    });
    
    res.json(latestDailyProfits);
  } catch (err) {
    console.error('[api:/consolidated/daily-profit/latest] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/consolidated/balances/distribution', async (req, res) => {
  try {
    const cfg = loadServers();
    const distribution = {}; // { serverId: totalUsdt }

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const row = db.prepare(
          'SELECT total_usdt, raw_data FROM balances_history ORDER BY id DESC LIMIT 1'
        ).get();

        if (row) {
          let snapshot;
          try { snapshot = JSON.parse(row.raw_data); } catch { snapshot = null; }
          const parts = computeDexCex(snapshot);
          const combined = Number.isFinite(parts.combined) && parts.combined !== 0 ? parts.combined : row.total_usdt;
          distribution[server.id] = {
            label: server.label,
            totalUsdt: combined || 0
          };
        }
      } catch (serverErr) {
        console.error(`[api:/consolidated/balances/distribution] server:${server.id} ${serverErr.message}`);
      }
    }

    const result = Object.values(distribution);
    res.json(result);
  } catch (err) {
    console.error('[api:/consolidated/balances/distribution] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/consolidated/token-performance', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000; // Default to 1000 trades
    const cfg = loadServers();
    const allTrades = [];

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const trades = db.prepare(
          'SELECT pair, executedQtyDst, executedDstPrice, executedSrcPrice, executedQtySrc, props, raw_data FROM completed_trades ORDER BY lastUpdateTime DESC LIMIT ?'
        ).all(limit);
        allTrades.push(...trades);
      } catch (serverErr) {
        console.error(`[api:/consolidated/token-performance] server:${server.id} ${serverErr.message}`);
      }
    }

    const metrics = aggregateTokenMetrics(allTrades);

    const result = Array.from(metrics.values()).map(r => ({
      token: r.token,
      trades: r.trades,
      wins: r.wins,
      losses: r.losses,
      totalNetProfit: r.totalNetProfit,
      avgNetProfit: r.trades ? r.totalNetProfit / r.trades : null,
    }));

    const topPerformers = [...result].sort((a, b) => b.totalNetProfit - a.totalNetProfit).slice(0, 10);
    const worstPerformers = [...result].sort((a, b) => a.totalNetProfit - b.totalNetProfit).slice(0, 10);

    res.json({ limit, topPerformers, worstPerformers });
  } catch (err) {
    console.error('[api:/consolidated/token-performance] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New endpoint to get consolidated gas consumption data for all servers
app.get('/consolidated/gas-consumption', async (req, res) => {
  try {
    const cfg = loadServers();
    const allServersGasConsumption = {};

    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        const rows = db.prepare(
          `SELECT
            STRFTIME('%Y-%m-%d', DATETIME(timestamp / 1000, 'unixepoch')) AS gas_date,
            SUM(gas_balance) AS daily_gas_balance
          FROM gas_balances
          WHERE contract != '__total__'
          GROUP BY gas_date
          ORDER BY gas_date ASC`
        ).all();

        for (const row of rows) {
          if (!allServersGasConsumption[row.gas_date]) {
            allServersGasConsumption[row.gas_date] = 0;
          }
          allServersGasConsumption[row.gas_date] += row.daily_gas_balance || 0;
        }
      } catch (serverErr) {
        console.error(`[api:/consolidated/gas-consumption] server:${server.id} ${serverErr.message}`);
      }
    }

    const result = Object.keys(allServersGasConsumption).map(date => ({
      date: date,
      consumption: allServersGasConsumption[date]
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    res.json(result);
  } catch (err) {
    console.error('[api:/consolidated/gas-consumption] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New endpoint to get consolidated gas tracking statistics for different time periods
app.get('/consolidated/gas-tracking', async (req, res) => {
  try {
    const cfg = loadServers();
    const now = Date.now();
    
    // Define time periods in milliseconds
    const periods = [
      { label: 'Last 1h', cutoff: now - (1 * 60 * 60 * 1000) },
      { label: 'Last 4h', cutoff: now - (4 * 60 * 60 * 1000) },
      { label: 'Last 8h', cutoff: now - (8 * 60 * 60 * 1000) },
      { label: 'Last 12h', cutoff: now - (12 * 60 * 60 * 1000) },
      { label: 'Last 24h', cutoff: now - (24 * 60 * 60 * 1000) },
      { label: 'Last 2 Days', cutoff: now - (2 * 24 * 60 * 60 * 1000) },
      { label: 'Last 7 Days', cutoff: now - (7 * 24 * 60 * 60 * 1000) },
    ];

    // Object to store stats for each period
    const allStats = periods.map(period => ({
      label: period.label,
      consumption: 0,
      deposit: 0
    }));

    // For each server, gather its gas tracking data
    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        
        // Get all gas balance tracking data for this server ordered by timestamp
        const trackingRows = db.prepare(`
          SELECT timestamp, gas_balance, gas_deposit, source
          FROM gas_balance_tracking
          WHERE contract = '__total__'
          ORDER BY datetime(timestamp) ASC
        `).all();

        if (trackingRows.length === 0) continue;

        // Process each time period for this server
        for (let i = 0; i < periods.length; i++) {
          const period = periods[i];
          const periodStats = allStats[i];
          
          // Find all tracking entries that occurred after the cutoff time
          for (const row of trackingRows) {
            const itemTimestamp = new Date(row.timestamp).getTime();
            
            if (itemTimestamp >= period.cutoff) {
              const depositVal = Number(row.gas_deposit);
              if (Number.isFinite(depositVal) && depositVal !== 0) {
                periodStats.deposit += depositVal;
              }
            }
          }
        }
      } catch (serverErr) {
        console.error(`[api:/consolidated/gas-tracking] server:${server.id} ${serverErr.message}`);
      }
    }

    // Now let's calculate real consumption using the same logic as in the script.js file
    // which calculates consumption based on differences between auto-total entries
    for (const server of cfg.servers) {
      try {
        const db = ensureDb(server.id);
        
        // Get gas balance tracking records for the server
        const series = db.prepare(
          `SELECT timestamp, gas_balance, gas_deposit, source
           FROM gas_balance_tracking
           WHERE contract = '__total__'
           ORDER BY datetime(timestamp) ASC`
        ).all();

        if (series.length <= 1) continue; // Not enough data to calculate consumption

        let previousAutoTotalBalance = null;

        // Initialize previousAutoTotalBalance from the first entry if it's an auto-total entry
        if (series.length > 0 && series[0].source === 'auto-total') {
          previousAutoTotalBalance = Number(series[0].gas_balance);
        }

        for (let i = 1; i < series.length; i += 1) {
          const prevEntry = series[i - 1];
          const currEntry = series[i];
          const prevBalance = Number(prevEntry.gas_balance);
          const currBalance = Number(currEntry.gas_balance);
          const _currDeposit = Number(currEntry.gas_deposit);

          if (!Number.isFinite(prevBalance) || !Number.isFinite(currBalance)) continue;

          const entryTime = new Date(currEntry.timestamp).getTime();
          if (Number.isNaN(entryTime)) continue;

          // Calculate consumption for each period
          for (let j = 0; j < periods.length; j++) {
            if (entryTime >= periods[j].cutoff) {
              if (currEntry.source === 'auto-total') {
                if (previousAutoTotalBalance !== null && Number.isFinite(previousAutoTotalBalance)) {
                  let consumption = previousAutoTotalBalance - currBalance;
                  if (consumption < 0) consumption = 0; // Consumption cannot be negative
                  allStats[j].consumption += consumption;
                }
                previousAutoTotalBalance = currBalance;
              }
            }
          }
        }
      } catch (serverErr) {
        console.error(`[api:/consolidated/gas-tracking] server:${server.id} gas processing error ${serverErr.message}`);
      }
    }

    res.json(allStats);
  } catch (err) {
    console.error('[api:/consolidated/gas-tracking] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/trades/:id', (req, res) => {  try {
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
    const { label, baseUrl, balancesPath = '/balance', completedPath = '/completed', contractAddress, explorerSite, explorerApiBase, explorerApiKey, chainId } = req.body || {};
    if (!label || !baseUrl) return res.status(400).json({ error: 'label and baseUrl required' });

    let parsedChainId;
    if (chainId !== undefined && chainId !== null && String(chainId).trim() !== '') {
      const n = Number(chainId);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'chainId must be a number' });
      parsedChainId = n;
    }

    const cfg = loadServers();
    const serverIndex = cfg.servers.findIndex(s => s.id === req.params.id);
    if (serverIndex === -1) return res.status(404).json({ error: 'server not found' });

    // Update the server details
    cfg.servers[serverIndex] = {
      ...cfg.servers[serverIndex],  // Keep existing properties not being updated
      id: req.params.id,  // Keep the same ID
      label,
      baseUrl,
      balancesPath,
      completedPath,
      contractAddress,
      explorerSite,
      explorerApiBase,
      explorerApiKey
    };

    // Only add chainId if it was provided and is valid
    if (parsedChainId !== undefined) cfg.servers[serverIndex].chainId = parsedChainId;

    saveServers(cfg);
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

// Notification settings APIs
app.get('/notifications/settings', (req, res) => {
  try {
    const cfg = loadServers();
    res.json(cfg.notifications || {});
  } catch (err) {
    console.error('[api:/notifications/settings] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/notifications/settings', (req, res) => {
  try {
    const cfg = loadServers();
    cfg.notifications = req.body;
    saveServers(cfg);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api:/notifications/settings PUT] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to update notification rules
app.put('/notifications/rules', (req, res) => {
  try {
    const cfg = loadServers();
    cfg.notificationRules = req.body;
    saveServers(cfg);
    res.json({ ok: true });
  } catch (err) {
    console.error('[api:/notifications/rules PUT] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Function to get balance update data for all servers
async function getBalanceUpdateData() {
  const cfg = loadServers();
  const result = [];
  
  for (const server of cfg.servers) {
    const db = ensureDb(server.id);
    
    // Get latest balance snapshot
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
    
    // Calculate profit and trade counts for different periods
    const now = Date.now();
    const periods = {
      '1h': now - (1 * 60 * 60 * 1000),
      '4h': now - (4 * 60 * 60 * 1000),
      '8h': now - (8 * 60 * 60 * 1000),
      '12h': now - (12 * 60 * 60 * 1000),
      '24h': now - (24 * 60 * 60 * 1000)
    };
    
    const periodData = {};
    for (const [label, startTimestamp] of Object.entries(periods)) {
      const trades = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ?').all(startTimestamp);
      const netProfit = trades.reduce((sum, t) => {
        const profit = (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
        return sum + (Number.isFinite(profit) ? profit : 0);
      }, 0);
      
      periodData[label] = {
        profit: netProfit,
        trades: trades.length
      };
    }
    
    result.push({
      server: server.label,
      totalUSDT: totalUSDT,
      binanceFUSDT: binanceFUSDT,
      dexUSDT: dexUSDT,
      periodData: periodData
    });
  }
  
  return result;
}

// Endpoint to retrieve balance update data
app.get('/notifications/balance-update-data', async (req, res) => {
  try {
    const data = await getBalanceUpdateData();
    res.json(data);
  } catch (err) {
    console.error('[api:/notifications/balance-update-data] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Function to send balance update notifications
async function sendBalanceUpdate() {
  const cfg = loadServers();
  const data = await getBalanceUpdateData();
  
  // Format the message containing data for all servers
  let message = '';
  for (const serverData of data) {
    message += `📊 *SERVER: ${serverData.server}*\n`;
    message += `Total (USDT)    : ${serverData.totalUSDT?.toLocaleString() || 'N/A'}\n`;
    message += `BinanceF (USDT) : ${serverData.binanceFUSDT?.toLocaleString() || 'N/A'}\n`;
    message += `DEX (USDT)      : ${serverData.dexUSDT?.toLocaleString() || 'N/A'}\n\n`;
    
    message += `Period       Profit (USD)   Number of Trades\n`;
    for (const [period, stats] of Object.entries(serverData.periodData)) {
      message += `Last ${period.padEnd(2, ' ')}     ${stats.profit.toFixed(2).padStart(7, ' ')}      ${stats.trades.toString().padStart(3, ' ')}\n`;
    }
    message += '\n';
  }
  
  // Since this is a global notification for all servers, we'll use the rule configuration
  // from the first server's notifier, but the config is shared across all servers
  if (cfg.servers.length > 0) {
    // Get configuration from the first server's notifier
    const firstServerNotifier = ensureNotifier(cfg.servers[0].id);
    if (firstServerNotifier) {
      // Use channels specified in the rule configuration
      const ruleChannels = firstServerNotifier.getRuleConfig('balanceUpdate')?.channels;
      const channels = ruleChannels || ['slack']; // Default to slack
      
      // Send notification once for all servers with data for all servers
      await firstServerNotifier.notify('balanceUpdate', {
        title: `Balance Update for All Servers`,
        message: message,
        channels: channels
      });
    }
  }
}

// Schedule balance update notifications (default every hour)
/*
cron.schedule('0 * * * *', () => {
  console.log('[cron] Running balance update notification...');
  sendBalanceUpdate();
});
*/

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
    if (users[username] && bcrypt.compareSync(password, users[username])) {
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
    let sdiffData = null;

    // Universal token parser
    const parseTokens = (str) => {
        const tokenMatches = [...str.matchAll(/\b([A-Za-z0-9_]+)\(([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\)/g)];
        return tokenMatches.map(match => ({
            name: match[1],
            buy: match[2],
            sell: match[3],
        }));
    };

    // Check for new multi-line format
    const headerLineIndex = lines.findIndex(l => l.includes("Addr") && l.includes("State") && l.includes("Up"));
    const sdiffDataLine = lines.find(l => l.trim().startsWith('SDIFF_'));

    if (headerLineIndex !== -1 && sdiffDataLine) {
        // New format
        const headerParts = lines[headerLineIndex].trim().split(/\s+/);
        const upIndex = headerParts.indexOf('Up');
        
        const dataParts = sdiffDataLine.trim().split(/\s+/);
        const up = (upIndex !== -1 && dataParts.length > upIndex) ? dataParts[upIndex] : null;

        const propsLine = lines.find(l => l.includes('Mindiff:'));
        if (propsLine) {
            sdiffData = {
                up: up,
                mindiff: propsLine.match(/Mindiff:([\d.]+)/)?.[1],
                maxOrderSize: propsLine.match(/MaxOrderSize:\s*(\d+)/)?.[1],
                tokens: parseTokens(propsLine),
            };
        }
    }

    // Fallback to old single-line format if new one fails
    if (!sdiffData && sdiffDataLine) {
        const parts = sdiffDataLine.split(/\s+/);
        const propsIndex = sdiffDataLine.indexOf('Mindiff:');
        const propsStr = propsIndex > -1 ? sdiffDataLine.substring(propsIndex) : '';

        const m1Index = parts.findIndex(p => p === 'M1');
        const up = m1Index !== -1 && parts.length > m1Index + 1 ? parts[m1Index + 1] : null;

        sdiffData = {
            up: up,
            mindiff: propsStr.match(/Mindiff:([\d.]+)/)?.[1],
            maxOrderSize: propsStr.match(/MaxOrderSize:\s*(\d+)/)?.[1],
            tokens: parseTokens(propsStr),
        };
    }

    const blacklistLine = lines.find(l => l.startsWith('SDIFF Uniswap BlackList:'));
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
    const db = ensureDb(serverId);

    // Fetch latest transactions and store them
    const server = (loadServers().servers.find(s => s.id === serverId)) || getActiveServer();
    await fetchContractTxsAndStoreFor(server);

    const rows = db.prepare('SELECT * FROM contract_transactions WHERE serverId = ? ORDER BY timestamp DESC').all(serverId);

    const since24h = Date.now() - (24 * 60 * 60 * 1000);
    const recent = rows.filter(t => t.timestamp >= since24h);

    const buckets = [1, 4, 8, 12, 24];
    const now = Date.now();
    const periods = {};
    for (const h of buckets) periods[`${h}h`] = { success: 0, fail: 0 };
    for (const t of recent) {
      const ageH = (now - t.timestamp) / (60 * 60 * 1000);
      for (const h of buckets) {
        if (ageH <= h) {
          if (!t.isError) periods[`${h}h`].success++; else periods[`${h}h`].fail++;
        }
      }
    }

    const failed = recent.filter(t => t.isError).slice(0, 100);

    const failedWithReasons = failed.map(t => {
      const raw = safeJsonParse(t.raw_data);
      const gasPrice = raw ? safeNumber(raw.gasPrice) : 0;
      const gasUsed = raw ? safeNumber(raw.gasUsed) : 0;
      const l1Fee = raw ? safeNumber(raw.L1FeesPaid) : 0;
      const gasFee = (gasPrice * gasUsed) + l1Fee;

      const gasFeeInEth = gasFee / 1e18;
      let price = 0;
      if (t.ethPrice) {
        price = t.ethPrice;
      } else if (t.polPrice) {
        price = t.polPrice;
      } else if (t.bnbPrice) {
        price = t.bnbPrice;
      } else {
        if (server.explorerSite === 'https://polygonscan.com') {
          price = polPrice;
        } else if (server.explorerSite === 'https://bscscan.com') {
          price = bnbPrice;
        } else {
          price = ethPrice;
        }
      }
      const gasFeeInUsdt = price ? gasFeeInEth * price : 0;

      const explorerBase = (server.explorerSite || '').replace(/\/?$/, '');
      const traceUrl = explorerBase ? `${explorerBase}/vmtrace?txhash=${t.hash}&type=gethtrace2` : null;
      return {
        hash: t.hash,
        time: new Date(t.timestamp).toISOString(),
        reason: t.reason,
        gasFee: gasFeeInUsdt,
        link: explorerBase ? `${explorerBase}/tx/${t.hash}` : null,
        traceUrl
      };
    });

    res.json({ serverId, address: server.contractAddress, periods, failed: failedWithReasons, totalAnalyzed: recent.length, chainId: Number.isFinite(server.chainId) ? server.chainId : undefined });
  } catch (err) {
    console.error('[api:/contracts/analysis] error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});




// Endpoint to get the latest trades for ML training
app.get('/ml/training-data', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20000; // Default to 20000 trades
    const serverId = req.query.serverId || loadServers().activeId;
    const db = ensureDb(serverId);
    
    // Get the latest trades from completed_trades table
    const trades = db.prepare(
      "SELECT * FROM completed_trades ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT ?"
    ).all(limit);
    
    // Process trades to extract features and outcomes for ML
    const processedTrades = trades.map(trade => {
      // Extract features from trade props
      const props = normalizePropsRaw(trade.props);
      const rawProps = getTradeRawProps(trade);
      const rawPropsNormalized = rawProps ? normalizePropsRaw(rawProps) : {};
      
      // Calculate net profit as outcome
      const netProfit = (trade.executedQtyDst * trade.executedDstPrice) - 
                       (trade.executedSrcPrice * trade.executedQtySrc) - 
                       (0.0002 * trade.executedQtyDst * trade.executedDstPrice);
      
      return {
        id: trade.id,
        pair: trade.pair,
        serverId: serverId,
        buyDiffBps: props.Diff || rawPropsNormalized.Diff || 0,  // Use Diff as proxy for buyDiffBps
        sellDiffBps: 0, // Not directly available from props, using 0 as placeholder
        // Use extracted features
        Diff: props.Diff || rawPropsNormalized.Diff || 0,
        DexSlip: props.DexSlip || rawPropsNormalized.DexSlip || 0,
        CexSlip: props.CexSlip || rawPropsNormalized.CexSlip || 0,
        // Outcome variable
        netProfit: netProfit,
        isProfitable: netProfit > 0 ? 1 : 0,
        // Timestamp for matching with diff data if needed
        timestamp: trade.lastUpdateTime || trade.creationTime,
        // Additional features from trade
        executedQtyDst: trade.executedQtyDst,
        executedDstPrice: trade.executedDstPrice,
        executedQtySrc: trade.executedQtySrc,
        executedSrcPrice: trade.executedSrcPrice
      };
    });
    
    res.json({
      count: processedTrades.length,
      trades: processedTrades,
      message: `Retrieved ${processedTrades.length} trades for ML training`
    });
  } catch (err) {
    console.error('[api:/ml/training-data] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch training data', details: err.message });
  }
});

app.post('/ml/train', (req, res) => {
    // First, fetch the last 20000 trades for training
    const serverId = req.body.serverId || loadServers().activeId;
    const db = ensureDb(serverId);
    
    // Get the latest trades from completed_trades table
    const trades = db.prepare(
      "SELECT * FROM completed_trades ORDER BY COALESCE(lastUpdateTime, creationTime) DESC LIMIT 20000"
    ).all();
    
    // Process trades to extract features and outcomes for ML
    const processedTrades = trades.map(trade => {
      // Extract features from trade props
      const props = normalizePropsRaw(trade.props);
      const rawProps = getTradeRawProps(trade);
      const rawPropsNormalized = rawProps ? normalizePropsRaw(rawProps) : {};
      
      // Calculate net profit as outcome
      const netProfit = (trade.executedQtyDst * trade.executedDstPrice) - 
                       (trade.executedSrcPrice * trade.executedQtySrc) - 
                       (0.0002 * trade.executedQtyDst * trade.executedDstPrice);
      
      return {
        id: trade.id,
        pair: trade.pair,
        buyDiffBps: props.Diff || rawPropsNormalized.Diff || 0,  // Use Diff as proxy for buyDiffBps
        sellDiffBps: 0, // Not directly available from props, using 0 as placeholder
        // Use extracted features
        Diff: props.Diff || rawPropsNormalized.Diff || 0,
        DexSlip: props.DexSlip || rawPropsNormalized.DexSlip || 0,
        CexSlip: props.CexSlip || rawPropsNormalized.CexSlip || 0,
        // Outcome variable
        netProfit: netProfit,
        isProfitable: netProfit > 0 ? 1 : 0,
        // Timestamp for matching with diff data if needed
        timestamp: trade.lastUpdateTime || trade.creationTime,
        // Additional features from trade
        executedQtyDst: trade.executedQtyDst,
        executedDstPrice: trade.executedDstPrice,
        executedQtySrc: trade.executedQtySrc,
        executedSrcPrice: trade.executedSrcPrice
      };
    });
    
    // Save the processed training data to a temporary file for the Python script to use
    const fs = require('fs');
    const path = require('path');
    
    // Create directory if it doesn't exist
    const dataDir = path.join(__dirname, 'data_exports', serverId);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Write training data to a file
    const trainingDataPath = path.join(dataDir, 'trades_for_ml.json');
    fs.writeFileSync(trainingDataPath, JSON.stringify(processedTrades));
    
    // Also write to CSV format for the Python ML pipeline
    const csvHeader = 'buyDiffBps,sellDiffBps,Diff,DexSlip,CexSlip,netProfit,isProfitable,executedQtyDst,executedDstPrice,executedQtySrc,executedSrcPrice\n';
    const csvRows = processedTrades.map(trade => 
      [
        trade.buyDiffBps, trade.sellDiffBps, trade.Diff, 
        trade.DexSlip, trade.CexSlip, trade.netProfit, 
        trade.isProfitable, trade.executedQtyDst, trade.executedDstPrice, 
        trade.executedQtySrc, trade.executedSrcPrice
      ].join(',')
    ).join('\n');
    
    const csvPath = path.join(dataDir, 'trades_for_ml.csv');
    fs.writeFileSync(csvPath, csvHeader + csvRows);
    
    // Create subdirectories for the expected structure
    const _tradesDir = path.join(dataDir, 'trades_with_diff.parquet');
    
    // Write training data in parquet format (expected by the training script)
    // We'll write a simplified version with the required columns
    
    // Write the trades data in a format more compatible with the training script
    const formattedTrades = processedTrades.map(trade => ({
      ...trade,
      trade_ts: new Date(trade.timestamp).toISOString(), // Ensure proper timestamp
      label_regression: trade.netProfit, // Use net profit as regression target
      label_class: trade.isProfitable, // Use profitability as classification target
    }));
    
    // Write the data in a format compatible with the training script
    // Since the original training script expects a parquet file, we'll create both
    const _parquetPath = path.join(dataDir, 'trades_with_diff.parquet');
    const csvPathDetailed = path.join(dataDir, 'trades_with_diff.csv');
    
    // Write as CSV since we may not have pyarrow installed
    const csvHeaderDetailed = 'id,pair,buyDiffBps,sellDiffBps,Diff,DexSlip,CexSlip,netProfit,isProfitable,executedQtyDst,executedDstPrice,executedQtySrc,executedSrcPrice,trade_ts,label_regression,label_class\n';
    const csvRowsDetailed = formattedTrades.map(trade => 
      [
        trade.id, `"${trade.pair}"`, trade.buyDiffBps, trade.sellDiffBps, trade.Diff, 
        trade.DexSlip, trade.CexSlip, trade.netProfit, trade.isProfitable, 
        trade.executedQtyDst, trade.executedDstPrice, trade.executedQtySrc, 
        trade.executedSrcPrice, trade.trade_ts || new Date(trade.timestamp).toISOString(), 
        trade.label_regression, trade.label_class
      ].join(',')
    ).join('\n');
    
    fs.writeFileSync(csvPathDetailed, csvHeaderDetailed + csvRowsDetailed);
    
    // Create empty context files with headers to avoid pandas empty data error
    // These files are expected by the training script 
    const contextFiles = [
        { name: 'balances_history.csv', header: 'id,timestamp,total_usdt,total_coin,raw_data\n' },
        { name: 'gas_balances.csv', header: 'id,timestamp,contract,gas,is_low\n' },
        { name: 'contract_transactions.csv', header: 'hash,serverId,timestamp,isError,reason,ethPrice,polPrice,raw_data\n' },
        { name: 'server_tokens.csv', header: 'id,timestamp,name,buy,sell\n' }
    ];
    
    for (const file of contextFiles) {
        const filePath = path.join(dataDir, file.name);
        // Only create if it doesn't exist to avoid overwriting
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.header);
        }
    }
    
    // Now run the training script with appropriate parameters
    // Get the actual server ID from the request body or use the active server
    const actualServerId = req.body.serverId || loadServers().activeId || serverId;
    
    const pythonProcess = spawn('python', [
      'train.py', 
      '--data-root', 'data_exports', 
      '--servers', actualServerId, 
      '--task', 'classification',  // Use classification for profitable/not profitable
      '--model-type', 'random_forest',
      '--export-formats', 'csv',
      '--n-jobs', '1'  // Use single job to avoid resource issues
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
            console.error(`train.py stderr: ${errorToSend}`);
            return res.status(500).json({ message: 'Failed to train model.', details: errorToSend });
        }
        res.json({ message: 'Model trained successfully.', details: dataToSend });
    });
});

app.post('/ml/predict', async (req, res) => {
  try {
    let payloads = Array.isArray(req.body?.payloads) ? req.body.payloads : null;

    if (!payloads) {
      const { buyDiffBps, sellDiffBps, Diff, DexSlip, CexSlip } = req.body || {};
      const legacyValues = [buyDiffBps, sellDiffBps, Diff, DexSlip, CexSlip];
      const hasLegacy = legacyValues.some(v => v !== undefined);
      if (hasLegacy) {
        if (legacyValues.some(v => v === undefined)) {
          return res.status(400).json({ error: 'Missing one or more required features.' });
        }
        payloads = [{
          buyDiffBps: safeNumber(buyDiffBps),
          sellDiffBps: safeNumber(sellDiffBps),
          Diff: safeNumber(Diff),
          DexSlip: safeNumber(DexSlip),
          CexSlip: safeNumber(CexSlip),
        }];
      }
    }

    if (!payloads || !Array.isArray(payloads) || !payloads.length) {
      return res.status(400).json({ error: 'payloads array is required.' });
    }

    const sanitizedPayloads = payloads.map(sanitizeMlPayload);
    const includeProbabilities = req.body?.includeProbabilities !== false;
    const modelPath = req.body?.modelPath || null;
    const preferMode = (process.env.ML_PREDICT_MODE || '').toLowerCase();
    const preferLocal = preferMode === 'local';
    const forceRemote = preferMode === 'remote';
    const baseUrl = getMlServiceBaseUrl();
    let result = null;

    if (!preferLocal) {
      try {
        result = await proxyMlServicePredict(baseUrl, sanitizedPayloads, includeProbabilities, modelPath);
      } catch (serviceErr) {
        if (forceRemote || !shouldFallbackToLocal(serviceErr)) {
          throw serviceErr;
        }
        console.warn('[api:/ml/predict] Remote ML service unavailable, falling back to local script:', serviceErr.message);
      }
    }

    if (!result) {
      result = await runLocalPredictBatch(sanitizedPayloads);
    }

    if (sanitizedPayloads.length === 1 && result.success_probability == null) {
      const probability = extractSuccessProbability(result.probabilities);
      if (probability != null) {
        result.success_probability = probability;
      }
    }

    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || err.message || 'Prediction request failed';
    console.error('[api:/ml/predict] error:', detail);
    res.status(status).json({ error: 'Failed to proxy prediction', details: detail });
  }
});

app.get('/ml/metadata', async (req, res) => {
  try {
    const baseUrl = getMlServiceBaseUrl();
    const response = await axios.get(`${baseUrl}/metadata`, {
      params: { model_path: req.query?.modelPath || null },
      timeout: 10000,
    });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || err.message || 'Metadata request failed';
    console.error('[api:/ml/metadata] error:', detail);
    res.status(status).json({ error: 'Failed to fetch metadata', details: detail });
  }
});



// Reports analytics helpers
function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(v => (v == null ? '' : String(v).trim())).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function numericOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeRangeInput(range) {
  if (!range || typeof range !== 'object') return { min: null, max: null };
  const min = numericOrNull(range.min ?? range.start ?? range.from);
  const max = numericOrNull(range.max ?? range.end ?? range.to);
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
}

function hasRangeValue(range) {
  if (!range) return false;
  return Number.isFinite(range.min) || Number.isFinite(range.max);
}

function normalizeReportFilters(payload = {}) {
  const now = Date.now();
  const timeRange = payload.timeRange || {};
  let end = numericOrNull(timeRange.end ?? payload.endTime);
  let start = numericOrNull(timeRange.start ?? payload.startTime);
  const presetKey = typeof timeRange.preset === 'string'
    ? timeRange.preset.toLowerCase()
    : (typeof payload.timePreset === 'string' ? payload.timePreset.toLowerCase() : null);

  if (!Number.isFinite(end)) end = now;
  if (!Number.isFinite(start)) {
    const presetFactory = presetKey && REPORT_TIME_PRESETS[presetKey];
    if (presetFactory) {
      const derived = presetFactory();
      start = derived.start;
      if (!Number.isFinite(end) && Number.isFinite(derived.end)) {
        end = derived.end;
      }
    } else {
      start = end - REPORT_DEFAULT_RANGE_MS;
    }
  }
  if (!Number.isFinite(start) || start >= end) {
    start = Math.max(0, end - REPORT_DEFAULT_RANGE_MS);
  }

  const minNotional = numericOrNull(payload?.thresholds?.minNotional ?? payload.minNotional);
  const minAbsPnl = numericOrNull(payload?.thresholds?.minAbsPnl ?? payload.minAbsPnl);
  const normalizedHedge = typeof payload.hedgeMode === 'string' ? payload.hedgeMode.toLowerCase() : 'all';

  const filters = {
    start,
    end,
    pairs: toStringArray(payload.pairs),
    srcExchanges: toStringArray(payload.srcExchanges),
    dstExchanges: toStringArray(payload.dstExchanges),
    statuses: toStringArray(payload.statuses),
    nwIds: toStringArray(payload.nwIds),
    fsmTypes: toStringArray(payload.fsmTypes),
    hedgeMode: ['hedge', 'non-hedge'].includes(normalizedHedge) ? normalizedHedge : 'all',
    thresholds: {
      minNotional: Number.isFinite(minNotional) && minNotional > 0 ? minNotional : null,
      minAbsPnl: Number.isFinite(minAbsPnl) && minAbsPnl > 0 ? minAbsPnl : null,
    }
  };

  const propsFiltersRaw = payload.propsFilters || {};
  const propsFilters = {
    tokens: toStringArray(propsFiltersRaw.tokens),
    execs: toStringArray(propsFiltersRaw.execs),
    dexes: toStringArray(propsFiltersRaw.dexes),
    ranges: {
      Diff: normalizeRangeInput(propsFiltersRaw.diff || propsFiltersRaw.Diff),
      DexSlip: normalizeRangeInput(propsFiltersRaw.dexSlip || propsFiltersRaw.DexSlip),
      CexSlip: normalizeRangeInput(propsFiltersRaw.cexSlip || propsFiltersRaw.CexSlip),
      LHdelta: normalizeRangeInput(propsFiltersRaw.lhDelta || propsFiltersRaw.LHdelta || propsFiltersRaw.lhd),
    }
  };

  const hasPropsEquals = propsFilters.tokens.length || propsFilters.execs.length || propsFilters.dexes.length;
  const hasPropsRanges = Object.values(propsFilters.ranges).some(hasRangeValue);
  if (hasPropsEquals || hasPropsRanges) {
    filters.props = propsFilters;
  }

  return filters;
}

function reportTradeTimeExpr(alias = 't') {
  return REPORT_TRADE_TIME_EXPR.replace(/t\./g, `${alias}.`);
}

function reportNetPnlExpr(alias = 't') {
  const qtyDst = `COALESCE(${alias}.executedQtyDst, 0)`;
  const dstPrice = `COALESCE(${alias}.executedDstPrice, 0)`;
  const qtySrc = `COALESCE(${alias}.executedQtySrc, 0)`;
  const srcPrice = `COALESCE(${alias}.executedSrcPrice, 0)`;
  return `((${qtyDst} * ${dstPrice}) * 0.9998) - (${qtySrc} * ${srcPrice})`;
}

function reportNotionalExpr(alias = 't') {
  const price = `COALESCE(${alias}.executedSrcPrice, 0)`;
  const qty = `COALESCE(${alias}.executedQtySrc, 0)`;
  return `ABS(${price} * ${qty})`;
}

function extractDexVenues(pair) {
  if (!pair) return [];
  const segments = String(pair).split('->');
  const venues = new Set();
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const code = trimmed.split('_')[0]?.toUpperCase();
    if (['U3', 'U4', 'P3', 'P4', 'A3', 'A4', 'C3', 'C4'].includes(code)) {
      venues.add(code);
    }
  }
  return Array.from(venues);
}

function buildReportTradeFilterClause(filters, alias = 't') {
  const clauses = [];
  const params = [];
  const timeExpr = reportTradeTimeExpr(alias);

  if (Number.isFinite(filters.start) && Number.isFinite(filters.end)) {
    clauses.push(`${timeExpr} BETWEEN ? AND ?`);
    params.push(filters.start, filters.end);
  }

  const addInClause = (values, column) => {
    if (!values || !values.length) return;
    const placeholders = values.map(() => '?').join(', ');
    clauses.push(`${alias}.${column} IN (${placeholders})`);
    params.push(...values);
  };

  addInClause(filters.pairs, 'pair');
  addInClause(filters.srcExchanges, 'srcExchange');
  addInClause(filters.dstExchanges, 'dstExchange');
  addInClause(filters.statuses, 'status');
  addInClause(filters.nwIds, 'nwId');
  addInClause(filters.fsmTypes, 'fsmType');

  if (filters.hedgeMode === 'hedge') {
    clauses.push(`COALESCE(${alias}.hedge, 0) = 1`);
  } else if (filters.hedgeMode === 'non-hedge') {
    clauses.push(`COALESCE(${alias}.hedge, 0) = 0`);
  }

  if (filters.thresholds?.minNotional != null) {
    clauses.push(`ABS(COALESCE(${alias}.executedSrcPrice, 0) * COALESCE(${alias}.executedQtySrc, 0)) >= ?`);
    params.push(filters.thresholds.minNotional);
  }
  if (filters.thresholds?.minAbsPnl != null) {
    clauses.push(`ABS(COALESCE(${alias}.executedGrossProfit, 0) - COALESCE(${alias}.executedFeeTotal, 0) - COALESCE(${alias}.txFee, 0)) >= ?`);
    params.push(filters.thresholds.minAbsPnl);
  }

  if (filters.props) {
    const jsonExpr = (field) => `json_extract(${alias}.props, '$.${field}')`;
    const addJsonInClause = (values, field) => {
      if (!values || !values.length) return;
      const placeholders = values.map(() => '?').join(', ');
      clauses.push(`${jsonExpr(field)} IN (${placeholders})`);
      params.push(...values);
    };
    addJsonInClause(filters.props.tokens, 'Token');
    addJsonInClause(filters.props.execs, 'Exec');
    addJsonInClause(filters.props.dexes, 'Dex');

    const addRangeClause = (range, field) => {
      if (!hasRangeValue(range)) return;
      const expr = `CAST(${jsonExpr(field)} AS REAL)`;
      if (Number.isFinite(range.min)) {
        clauses.push(`${expr} >= ?`);
        params.push(range.min);
      }
      if (Number.isFinite(range.max)) {
        clauses.push(`${expr} <= ?`);
        params.push(range.max);
      }
    };

    if (filters.props.ranges) {
      addRangeClause(filters.props.ranges.Diff, 'Diff');
      addRangeClause(filters.props.ranges.DexSlip, 'DexSlip');
      addRangeClause(filters.props.ranges.CexSlip, 'CexSlip');
      addRangeClause(filters.props.ranges.LHdelta, 'LHdelta');
    }
  }

  const clause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return { clause, params };
}

function fetchReportTrades(db, filters, options = {}) {
  const alias = options.alias || 't';
  const columns = options.columns || `${alias}.*`;
  const { clause, params } = buildReportTradeFilterClause(filters, alias);
  let sql = `SELECT ${columns} FROM completed_trades ${alias}${clause}`;
  if (options.orderBy) {
    sql += ` ${options.orderBy}`;
  }
  if (Number.isInteger(options.limit)) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (Number.isInteger(options.offset)) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }
  return db.prepare(sql).all(params);
}

function countReportTrades(db, filters) {
  const { clause, params } = buildReportTradeFilterClause(filters, 't');
  const row = db.prepare(`SELECT COUNT(1) as cnt FROM completed_trades t${clause}`).get(params);
  return row?.cnt || 0;
}

function fetchReportBreakdown(db, filters, options = {}) {
  const alias = 't';
  const { clause, params } = buildReportTradeFilterClause(filters, alias);
  const rawLimit = Math.min(Math.max(parseInt(options?.pairLimit, 10) || 50, 1), 500);
  const applyLimit = !options?.allPairs;
  const netExpr = reportNetPnlExpr(alias);
  const notionalExpr = reportNotionalExpr(alias);
  const extendClause = (base, extra) => (base ? `${base} AND ${extra}` : ` WHERE ${extra}`);

  const pairClause = extendClause(clause, `${alias}.pair IS NOT NULL AND TRIM(${alias}.pair) <> ''`);
  const pairBase = `FROM completed_trades ${alias}${pairClause}`;
  const pairParams = [...params];
  let pairSql = `
    SELECT
      ${alias}.pair AS pair,
      COUNT(1) AS trades,
      SUM(CASE WHEN ${netExpr} > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ${netExpr} < 0 THEN 1 ELSE 0 END) AS losses,
      SUM(${netExpr}) AS netPnl,
      AVG(${netExpr}) AS avgPnl,
      SUM(${notionalExpr}) AS notional
    ${pairBase}
    GROUP BY ${alias}.pair
    ORDER BY netPnl DESC
  `;
  if (applyLimit) {
    pairSql += ' LIMIT ?';
    pairParams.push(rawLimit);
  }
  const pairRows = db.prepare(pairSql).all(pairParams);
  const pairTotal = db.prepare(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT ${alias}.pair ${pairBase}
      GROUP BY ${alias}.pair
    )
  `).get(params)?.cnt || 0;

  return {
    generatedAt: new Date().toISOString(),
    pairs: pairRows,
    totalPairs: pairTotal
  };
}

function fetchReportTimePatterns(db, filters) {
  const alias = 't';
  const { clause, params } = buildReportTradeFilterClause(filters, alias);
  const timeExpr = reportTradeTimeExpr(alias);
  const netExpr = reportNetPnlExpr(alias);
  const timeClause = clause ? `${clause} AND ${timeExpr} IS NOT NULL` : ` WHERE ${timeExpr} IS NOT NULL`;
  const base = `FROM completed_trades ${alias}${timeClause}`;

  const dayRows = db.prepare(`
    SELECT
      CAST(strftime('%w', datetime(${timeExpr} / 1000.0, 'unixepoch')) AS INTEGER) AS dow,
      COUNT(1) AS trades,
      SUM(CASE WHEN ${netExpr} > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ${netExpr} < 0 THEN 1 ELSE 0 END) AS losses,
      SUM(${netExpr}) AS netPnl,
      AVG(${netExpr}) AS avgPnl
    ${base}
    GROUP BY dow
    ORDER BY dow ASC
  `).all(params);

  const hourRows = db.prepare(`
    SELECT
      CAST(strftime('%H', datetime(${timeExpr} / 1000.0, 'unixepoch')) AS INTEGER) AS hour,
      COUNT(1) AS trades,
      SUM(CASE WHEN ${netExpr} > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ${netExpr} < 0 THEN 1 ELSE 0 END) AS losses,
      SUM(${netExpr}) AS netPnl,
      AVG(${netExpr}) AS avgPnl
    ${base}
    GROUP BY hour
    ORDER BY hour ASC
  `).all(params);

  const dailyRows = db.prepare(`
    SELECT
      date(datetime(${timeExpr} / 1000.0, 'unixepoch')) AS day,
      COUNT(1) AS trades,
      SUM(${netExpr}) AS netPnl
    ${base}
    GROUP BY day
    ORDER BY day ASC
  `).all(params);

  const totalTrades = dayRows.reduce((sum, row) => sum + (row?.trades || 0), 0);
  const normalizedDays = [];
  for (let i = 0; i < 7; i += 1) {
    const found = dayRows.find(row => Number(row.dow) === i);
    normalizedDays.push({
      dow: i,
      trades: found?.trades || 0,
      wins: found?.wins || 0,
      losses: found?.losses || 0,
      netPnl: found?.netPnl || 0,
      avgPnl: found?.avgPnl || 0,
    });
  }
  const normalizedHours = [];
  for (let i = 0; i < 24; i += 1) {
    const found = hourRows.find(row => Number(row.hour) === i);
    normalizedHours.push({
      hour: i,
      trades: found?.trades || 0,
      wins: found?.wins || 0,
      losses: found?.losses || 0,
      netPnl: found?.netPnl || 0,
      avgPnl: found?.avgPnl || 0,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totalTrades,
    totalDays: dailyRows.length,
    dayOfWeek: normalizedDays,
    hourOfDay: normalizedHours,
    daily: dailyRows
  };
}

function computeTradeNetPnl(row) {
  const qtyDst = safeNumber(row.executedQtyDst) ?? 0;
  const dstPrice = safeNumber(row.executedDstPrice) ?? 0;
  const qtySrc = safeNumber(row.executedQtySrc) ?? 0;
  const srcPrice = safeNumber(row.executedSrcPrice) ?? 0;
  const grossValue = qtyDst * dstPrice;
  const srcCost = qtySrc * srcPrice;
  const estFee = 0.0002 * grossValue;
  const net = grossValue - srcCost - estFee;
  return Number.isFinite(net) ? net : 0;
}

function computeTradeNotional(row) {
  const price = safeNumber(row.executedSrcPrice) ?? 0;
  const qty = safeNumber(row.executedQtySrc) ?? 0;
  const notional = price * qty;
  return Number.isFinite(notional) ? Math.abs(notional) : 0;
}

function mapReportTrades(rows) {
  return rows.map((row) => {
    const timestamp = Number(row.lastUpdateTime ?? row.executedTime ?? row.creationTime ?? null);
    const netPnl = computeTradeNetPnl(row);
    const notional = computeTradeNotional(row);
    const ret = Number.isFinite(notional) && Math.abs(notional) > 0 ? netPnl / notional : null;
    const propsParsed = safeJsonParse(row.props, null);
    return {
      ...row,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      netPnl,
      notional,
      ret,
      propsParsed,
    };
  });
}

function computeMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function computeReportHistogram(values, bucketCount = 20) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { bins: [], counts: [] };
  let min = clean[0];
  let max = clean[0];
  for (const val of clean) {
    if (val < min) min = val;
    if (val > max) max = val;
  }
  if (min === max) {
    return {
      bins: [{ label: min.toFixed(2), start: min, end: max }],
      counts: [clean.length]
    };
  }
  const range = max - min || 1;
  const step = range / bucketCount;
  const bins = [];
  const counts = Array(bucketCount).fill(0);
  for (let i = 0; i < bucketCount; i++) {
    const start = min + (i * step);
    const end = i === bucketCount - 1 ? max : start + step;
    bins.push({ label: `${start.toFixed(2)} to ${end.toFixed(2)}`, start, end });
  }
  for (const value of clean) {
    let idx = Math.floor((value - min) / step);
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    if (idx >= bucketCount) idx = bucketCount - 1;
    counts[idx]++;
  }
  return { bins, counts, min, max };
}

function buildTradeCurve(trades) {
  const sorted = [...trades].sort((a, b) => {
    const tsA = Number.isFinite(a.timestamp) ? a.timestamp : 0;
    const tsB = Number.isFinite(b.timestamp) ? b.timestamp : 0;
    return tsA - tsB;
  });
  const points = [];
  let cumulative = 0;
  for (const trade of sorted) {
    if (!Number.isFinite(trade.timestamp)) continue;
    cumulative += trade.netPnl || 0;
    points.push({ t: trade.timestamp, value: cumulative });
  }
  return points;
}

function computeMaxDrawdownFromCurve(curve) {
  let peak = null;
  let maxDrawdown = 0;
  for (const point of curve) {
    if (peak == null || point.value > peak) {
      peak = point.value;
    }
    const drawdown = (peak ?? 0) - point.value;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}

function computeSharpeRatio(trades, startEquity) {
  if (!Number.isFinite(startEquity) || startEquity === 0) return 0;
  const daily = new Map();
  for (const trade of trades) {
    if (!Number.isFinite(trade.timestamp)) continue;
    const dateKey = new Date(trade.timestamp).toISOString().slice(0, 10);
    daily.set(dateKey, (daily.get(dateKey) || 0) + (trade.netPnl || 0));
  }
  if (!daily.size) return 0;
  const returns = Array.from(daily.values())
    .map(val => val / startEquity)
    .filter(Number.isFinite);
  if (!returns.length) return 0;
  const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
  if (returns.length === 1) return mean;
  const variance = returns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (returns.length - 1 || 1);
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std === 0) return 0;
  return mean / std;
}

function getStartingEquityForFilters(db, filters) {
  const startIso = new Date(filters.start).toISOString();
  const endIso = new Date(filters.end).toISOString();
  let row = db.prepare(
    'SELECT timestamp, total_usdt, total_coin, raw_data FROM balances_history WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC LIMIT 1'
  ).get(startIso, endIso);
  if (!row) {
    row = db.prepare(
      'SELECT timestamp, total_usdt, total_coin, raw_data FROM balances_history ORDER BY timestamp ASC LIMIT 1'
    ).get();
  }
  const parsed = row ? parseBalanceRowValue(row) : null;
  return parsed?.equity ?? null;
}

function parseBalanceRowValue(row) {
  let equity = safeNumber(row.total_usdt);
  let dex = null;
  let cex = null;
  if (row.raw_data) {
    const snapshot = safeJsonParse(row.raw_data, null);
    if (snapshot) {
      const totals = computeDexCex(snapshot);
      if (Number.isFinite(totals.dexTotal)) dex = totals.dexTotal;
      if (Number.isFinite(totals.cexTotal)) cex = totals.cexTotal;
      if (Number.isFinite(totals.combined) && totals.combined !== 0) {
        equity = totals.combined;
      }
    }
  }
  if (!Number.isFinite(equity)) {
    const fallback = safeNumber(row.total_coin);
    if (Number.isFinite(fallback)) equity = fallback;
  }
  return { equity: Number.isFinite(equity) ? equity : null, dex, cex };
}

function parseTimestampValue(value) {
  if (value == null) return null;
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fetchBalanceSeries(db, filters) {
  const startIso = new Date(filters.start).toISOString();
  const endIso = new Date(filters.end).toISOString();
  let rows = db.prepare(
    'SELECT timestamp, total_usdt, total_coin, raw_data FROM balances_history WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC'
  ).all(startIso, endIso);
  if (!rows.length) {
    rows = db.prepare(
      'SELECT timestamp, total_usdt, total_coin, raw_data FROM balances_history ORDER BY timestamp DESC LIMIT 500'
    ).all().reverse();
  }
  return rows.map(row => {
    const parsed = parseBalanceRowValue(row);
    return {
      t: parseTimestampValue(row.timestamp),
      equity: parsed.equity,
      dex: parsed.dex,
      cex: parsed.cex
    };
  }).filter(point => Number.isFinite(point.t) && Number.isFinite(point.equity));
}

function buildReportSummary(trades, filters, startEquity) {
  const netPnls = trades.map(t => t.netPnl).filter(Number.isFinite);
  const returns = trades.map(t => t.ret).filter(Number.isFinite);
  const totalNetPnl = netPnls.reduce((sum, val) => sum + val, 0);
  const wins = trades.filter(t => t.netPnl > 0).length;
  const losses = trades.filter(t => t.netPnl < 0).length;
  const totalTrades = trades.length;
  const avgPnl = totalTrades ? totalNetPnl / totalTrades : 0;
  const medianPnl = computeMedian(netPnls);
  const tradeCurve = buildTradeCurve(trades);
  const maxDrawdown = computeMaxDrawdownFromCurve(tradeCurve);
  const sharpe = computeSharpeRatio(trades, startEquity);
  return {
    timeRange: { start: filters.start, end: filters.end },
    totals: {
      netPnl: totalNetPnl,
      trades: totalTrades,
      wins,
      losses,
    },
    stats: {
      avgPnl,
      medianPnl,
      winRate: totalTrades ? wins / totalTrades : 0,
      maxDrawdown,
      sharpe,
      startEquity: Number.isFinite(startEquity) ? startEquity : null,
    },
    histograms: {
      netPnl: computeReportHistogram(netPnls),
      returns: computeReportHistogram(returns),
    }
  };
}

function buildTradesCsv(trades) {
  const headers = [
    'timestamp',
    'token',
    'netProfit',
    'LHdelta',
    'Exec',
    'CexSlip',
    'Dex',
    'Diff',
    'DexSlip'
  ];
  const rows = trades.map(t => ([
    t.timestamp ? new Date(t.timestamp).toISOString() : '',
    (t.propsParsed?.Token || t.pair || ''),
    Number.isFinite(t.netPnl) ? t.netPnl : '',
    t.propsParsed?.LHdelta != null ? t.propsParsed.LHdelta : '',
    t.propsParsed?.Exec ?? '',
    t.propsParsed?.CexSlip != null ? t.propsParsed.CexSlip : '',
    t.propsParsed?.Dex ?? '',
    t.propsParsed?.Diff != null ? t.propsParsed.Diff : '',
    t.propsParsed?.DexSlip != null ? t.propsParsed.DexSlip : '',
  ]));
  const formatValue = (value) => {
    if (value == null) return '';
    const str = String(value).replace(/"/g, '""');
    if (/[",\n]/.test(str)) {
      return `"${str}"`;
    }
    return str;
  };
  const csvLines = [headers.join(',')];
  for (const row of rows) {
    csvLines.push(row.map(formatValue).join(','));
  }
  return csvLines.join('\n');
}

function buildPairBreakdownCsv(rows) {
  const headers = ['pair', 'trades', 'wins', 'losses', 'winRate', 'netPnl', 'avgPnl', 'notional'];
  const formatValue = (value) => {
    if (value == null) return '';
    const str = String(value).replace(/"/g, '""');
    if (/[",\n]/.test(str)) {
      return `"${str}"`;
    }
    return str;
  };
  const csvLines = [headers.join(',')];
  for (const row of rows || []) {
    const trades = Number(row.trades) || 0;
    const wins = Number(row.wins) || 0;
    const losses = Number(row.losses) || 0;
    const winRate = trades ? wins / trades : 0;
    csvLines.push([
      row.pair || '',
      trades,
      wins,
      losses,
      winRate,
      Number(row.netPnl || 0),
      Number(row.avgPnl || 0),
      Number(row.notional || 0)
    ].map(formatValue).join(','));
  }
  return csvLines.join('\n');
}

app.get('/api/reports/options', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const distinct = (column, table = 'completed_trades') => db.prepare(
      `SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND TRIM(${column}) <> '' ORDER BY ${column} COLLATE NOCASE`
    ).all().map(row => row.value);
    const distinctJson = (jsonPath) => db.prepare(
      `SELECT DISTINCT value FROM (
        SELECT json_extract(props, ?) AS value FROM completed_trades WHERE props IS NOT NULL
      ) WHERE value IS NOT NULL AND TRIM(CAST(value AS TEXT)) <> '' ORDER BY value COLLATE NOCASE`
    ).all(jsonPath).map(row => row.value);
    res.json({
      pairs: distinct('pair'),
      srcExchanges: distinct('srcExchange'),
      dstExchanges: distinct('dstExchange'),
      statuses: distinct('status'),
      nwIds: distinct('nwId'),
      fsmTypes: distinct('fsmType'),
      tokens: distinctJson('$.Token'),
      execs: distinctJson('$.Exec'),
      dexes: distinctJson('$.Dex'),
      contracts: db.prepare('SELECT DISTINCT contract FROM gas_balance_tracking ORDER BY contract').all().map(row => row.contract),
    });
  } catch (err) {
    console.error('[api:/reports/options] error:', err.message);
    res.status(500).json({ error: 'Failed to load report options' });
  }
});

app.post('/api/reports/summary', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const filters = normalizeReportFilters(req.body || {});
    const rows = fetchReportTrades(db, filters, {
      columns: [
        't.id',
        't.pair',
        't.srcExchange',
        't.dstExchange',
        't.status',
        't.nwId',
        't.fsmType',
        't.hedge',
        't.executedGrossProfit',
        't.executedFeeTotal',
        't.txFee',
        't.executedSrcPrice',
        't.executedDstPrice',
        't.executedQtySrc',
        't.executedQtyDst',
        't.lastUpdateTime',
        't.executedTime',
        't.creationTime'
      ].join(', ')
    });
    const trades = mapReportTrades(rows);
    const startEquity = getStartingEquityForFilters(db, filters);
    const summary = buildReportSummary(trades, filters, startEquity);
    res.json(summary);
  } catch (err) {
    console.error('[api:/reports/summary] error:', err.message);
    res.status(500).json({ error: 'Failed to compute report summary' });
  }
});

app.post('/api/reports/equity', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const filters = normalizeReportFilters(req.body || {});
    const timeExpr = reportTradeTimeExpr('t');
    const rows = fetchReportTrades(db, filters, {
      columns: [
        't.executedGrossProfit',
        't.executedFeeTotal',
        't.txFee',
        't.executedSrcPrice',
        't.executedDstPrice',
        't.executedQtySrc',
        't.executedQtyDst',
        't.lastUpdateTime',
        't.executedTime',
        't.creationTime'
      ].join(', '),
      orderBy: `ORDER BY ${timeExpr} ASC`
    });
    const trades = mapReportTrades(rows);
    const tradeCurve = buildTradeCurve(trades);
    const balancesCurve = fetchBalanceSeries(db, filters);
    res.json({ balancesCurve, tradeCurve });
  } catch (err) {
    console.error('[api:/reports/equity] error:', err.message);
    res.status(500).json({ error: 'Failed to build equity curves' });
  }
});

app.post('/api/reports/breakdown', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const filters = normalizeReportFilters(req.body || {});
    const format = typeof req.body?.format === 'string' ? req.body.format.toLowerCase() : '';
    const breakdown = fetchReportBreakdown(db, filters, {
      pairLimit: req.body?.pairLimit,
      allPairs: format === 'csv' && !req.body?.pairLimit
    });
    if (format === 'csv') {
      const csv = buildPairBreakdownCsv(breakdown.pairs);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="reports-pairs.csv"');
      return res.send(csv);
    }
    res.json(breakdown);
  } catch (err) {
    console.error('[api:/reports/breakdown] error:', err.message);
    res.status(500).json({ error: 'Failed to load breakdown data' });
  }
});

app.post('/api/reports/time', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const filters = normalizeReportFilters(req.body || {});
    const patterns = fetchReportTimePatterns(db, filters);
    res.json(patterns);
  } catch (err) {
    console.error('[api:/reports/time] error:', err.message);
    res.status(500).json({ error: 'Failed to load time patterns' });
  }
});

app.post('/api/reports/market', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const filters = normalizeReportFilters(req.body || {});
    const context = fetchReportMarketContext(db, filters);
    res.json(context);
  } catch (err) {
    console.error('[api:/reports/market] error:', err.message);
    res.status(500).json({ error: 'Failed to load market context' });
  }
});

app.post('/api/reports/gas-ops', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const hours = Math.max(1, Math.min(parseInt(req.body?.hours, 10) || 72, 168));
    const windowDefs = [
      { label: '1h', hours: 1 },
      { label: '4h', hours: 4 },
      { label: '8h', hours: 8 },
      { label: '12h', hours: 12 },
      { label: '24h', hours: 24 },
      { label: '7d', hours: 24 * 7 },
    ];
    const maxWindowHours = windowDefs.reduce((max, window) => Math.max(max, window.hours), 0);
    const effectiveHours = Math.max(hours, maxWindowHours);
    const consumptionFull = computeGasConsumptionSeries(db, effectiveHours);
    const chartCutoff = Date.now() - (hours * 60 * 60 * 1000);
    const consumption = consumptionFull.filter((entry) => {
      const ts = Date.parse(entry.timestamp);
      return Number.isFinite(ts) && ts >= chartCutoff;
    });
    const profitWindows = computeProfitWindows(db, windowDefs, consumptionFull);
    const lastDeposit = fetchLastGasDepositEntry(db);
    const summary = buildGasOpsSummary(consumptionFull, lastDeposit);
    res.json({ summary, consumption, profitWindows });
  } catch (err) {
    console.error('[api:/reports/gas-ops] error:', err.message);
    res.status(500).json({ error: 'Failed to load gas & ops data' });
  }
});

app.post('/api/reports/trades', (req, res) => {
  try {
    const db = getDbFromReq(req);
    const filters = normalizeReportFilters(req.body || {});
    const format = typeof req.body?.format === 'string' ? req.body.format.toLowerCase() : '';
    const pageSize = Math.min(Math.max(parseInt(req.body?.pageSize, 10) || 50, 1), 500);
    const page = Math.max(parseInt(req.body?.page, 10) || 1, 1);
    const offset = (page - 1) * pageSize;
    const timeExpr = reportTradeTimeExpr('t');

    if (format === 'csv') {
      const exportRows = fetchReportTrades(db, filters, {
        columns: [
          't.id',
          't.pair',
          't.srcExchange',
          't.dstExchange',
          't.status',
          't.nwId',
          't.fsmType',
          't.hedge',
          't.executedGrossProfit',
          't.executedFeeTotal',
          't.txFee',
          't.executedSrcPrice',
          't.executedQtySrc',
          't.executedDstPrice',
          't.executedQtyDst',
          't.props',
          't.raw_data',
          't.lastUpdateTime',
          't.executedTime',
          't.creationTime'
        ].join(', '),
        orderBy: `ORDER BY ${timeExpr} ASC`
      });
      const exportTrades = mapReportTrades(exportRows);
      const csv = buildTradesCsv(exportTrades);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="reports-trades.csv"');
      return res.send(csv);
    }

    const total = countReportTrades(db, filters);
    const rows = fetchReportTrades(db, filters, {
      columns: [
        't.id',
        't.pair',
        't.srcExchange',
        't.dstExchange',
        't.status',
        't.nwId',
        't.fsmType',
        't.hedge',
        't.executedGrossProfit',
        't.executedFeeTotal',
        't.txFee',
        't.executedSrcPrice',
        't.executedDstPrice',
        't.executedQtySrc',
        't.executedQtyDst',
        't.props',
        't.raw_data',
        't.lastUpdateTime',
        't.executedTime',
        't.creationTime'
      ].join(', '),
      orderBy: `ORDER BY ${timeExpr} DESC`,
      limit: pageSize,
      offset
    });
    const trades = mapReportTrades(rows);
    res.json({
      rows: trades,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total ? Math.ceil(total / pageSize) : 0,
      }
    });
  } catch (err) {
    console.error('[api:/reports/trades] error:', err.message);
    res.status(500).json({ error: 'Failed to load trade ledger' });
  }
});

app.get('/ml/explain', async (req, res) => {
  try {
    const baseUrl = getMlServiceBaseUrl();
    const topK = Number.parseInt(req.query?.topK, 10);
    const body = {
      top_k: Number.isFinite(topK) && topK > 0 ? topK : 15,
      model_path: req.query?.modelPath || null,
    };
    const response = await axios.post(`${baseUrl}/explain`, body, { timeout: 15000 });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || err.message || 'Explain request failed';
    console.error('[api:/ml/explain] error:', detail);
    res.status(status).json({ error: 'Failed to fetch explanation', details: detail });
  }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
server.timeout = 1800000; // 30 minutes timeout for large uploads

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  try { for (const d of dbCache.values()) d.close(); } catch (__e) { /* ignore */ }
  process.exit(0);
});
function fetchReportMarketContext(db, filters) {
  const alias = 't';
  const { clause, params } = buildReportTradeFilterClause(filters, alias);
  const base = `FROM completed_trades ${alias}${clause}`;
  const netExpr = reportNetPnlExpr(alias);
  const notionalExpr = reportNotionalExpr(alias);
  const timeExpr = reportTradeTimeExpr(alias);
  const tokenExpr = `json_extract(${alias}.props, '$.Token')`;
  const extendClause = (baseClause, extra) => (baseClause ? `${baseClause} AND ${extra}` : ` WHERE ${extra}`);
  const totalsRow = db.prepare(`SELECT COUNT(1) as trades FROM completed_trades ${alias}${clause}`).get(params);

  const tokenClause = extendClause(clause, `${tokenExpr} IS NOT NULL AND TRIM(${tokenExpr}) <> ''`);
  const tokenBase = `FROM completed_trades ${alias}${tokenClause}`;
  const tokenRows = db.prepare(`
    SELECT
      ${tokenExpr} AS token,
      COUNT(1) AS trades,
      SUM(CASE WHEN ${netExpr} > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN ${netExpr} < 0 THEN 1 ELSE 0 END) AS losses,
      SUM(${netExpr}) AS netPnl,
      AVG(${netExpr}) AS avgPnl,
      SUM(${notionalExpr}) AS notional
    ${tokenBase}
    GROUP BY token
    ORDER BY trades DESC
    LIMIT 25
  `).all(params);

  const timelineClause = extendClause(clause, `${timeExpr} IS NOT NULL AND ${alias}.pair IS NOT NULL`);
  const timelineRows = db.prepare(`
    SELECT
      date(datetime(${timeExpr} / 1000.0, 'unixepoch')) AS day,
      ${alias}.pair AS pair,
      ${netExpr} AS netPnl
    FROM completed_trades ${alias}${timelineClause}
  `).all(params);

  const timelineMap = new Map();
  for (const row of timelineRows) {
    const venues = extractDexVenues(row.pair);
    if (!venues.length || !row.day) continue;
    if (!timelineMap.has(row.day)) {
      timelineMap.set(row.day, { day: row.day, venues: {} });
    }
    const entry = timelineMap.get(row.day);
    for (const venue of venues) {
      entry.venues[venue] = (entry.venues[venue] || 0) + (Number(row.netPnl) || 0);
    }
  }
  const timeline = Array.from(timelineMap.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  return {
    generatedAt: new Date().toISOString(),
    tokens: tokenRows,
    timeline,
    totals: {
      trades: totalsRow?.trades || 0,
      tokens: tokenRows.length
    }
  };
}
function computeGasConsumptionSeries(db, hoursInput) {
  const hours = Math.max(1, Math.min(Number.isFinite(hoursInput) ? hoursInput : 48, 168));
  const now = Date.now();
  const windowStart = new Date(now - hours * 60 * 60 * 1000).toISOString();

  const totals = db.prepare(
    `SELECT timestamp, gas_balance, gas_deposit, source
     FROM gas_balance_tracking
     WHERE contract = '__total__' AND datetime(timestamp) >= datetime(?)
     ORDER BY datetime(timestamp)`
  ).all(windowStart);

  const prev = db.prepare(
    `SELECT timestamp, gas_balance, gas_deposit, source
     FROM gas_balance_tracking
     WHERE contract = '__total__' AND datetime(timestamp) < datetime(?)
     ORDER BY datetime(timestamp) DESC
     LIMIT 1`
  ).get(windowStart);

  const series = [];
  if (prev) series.push(prev);
  series.push(...totals);
  if (series.length <= 1) {
    return [];
  }

  const buckets = new Map();
  let previousAutoTotalBalance = null;
  if (series[0]?.source === 'auto-total') {
    previousAutoTotalBalance = Number(series[0].gas_balance);
  }

  for (let i = 0; i < series.length; i += 1) {
    const currEntry = series[i];
    const currBalance = Number(currEntry.gas_balance);
    const currDeposit = Number(currEntry.gas_deposit);
    if (!Number.isFinite(currBalance)) continue;

    const entryTime = new Date(currEntry.timestamp);
    if (Number.isNaN(entryTime.getTime())) continue;

    const hourStart = new Date(entryTime);
    hourStart.setMinutes(0, 0, 0);
    hourStart.setSeconds(0, 0);
    const bucketKey = hourStart.toISOString();
    const bucket = buckets.get(bucketKey) || {
      timestamp: bucketKey,
      consumption: 0,
      deposit: 0,
      latestTotal: null,
    };

    if (currEntry.source === 'auto-total') {
      if (previousAutoTotalBalance !== null && Number.isFinite(previousAutoTotalBalance)) {
        let consumption = previousAutoTotalBalance - currBalance;
        if (consumption < 0) consumption = 0;
        bucket.consumption += consumption;
      }
      previousAutoTotalBalance = currBalance;
    } else if (currEntry.source === 'manual') {
      if (Number.isFinite(currDeposit) && currDeposit > 0) {
        bucket.deposit += currDeposit;
      }
      // Reset the baseline to the new balance after deposit so next auto-total
      // calculates consumption from this higher level instead of the old lower level.
      if (Number.isFinite(currBalance)) {
        previousAutoTotalBalance = currBalance;
      }
    }

    bucket.latestTotal = currBalance;
    buckets.set(bucketKey, bucket);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((entry) => ({
      timestamp: entry.timestamp,
      consumption: entry.consumption,
      deposit: entry.deposit,
      latestTotal: entry.latestTotal
    }));
}

function fetchLastGasDepositEntry(db) {
  return db.prepare(
    `SELECT timestamp, contract, gas_deposit
     FROM gas_balance_tracking
     WHERE gas_deposit IS NOT NULL AND gas_deposit > 0
     ORDER BY datetime(timestamp) DESC
     LIMIT 1`
  ).get();
}

function buildGasOpsSummary(consumption, lastDepositEntry) {
  let lastTotal = null;
  for (let i = consumption.length - 1; i >= 0; i -= 1) {
    const value = Number(consumption[i].latestTotal);
    if (Number.isFinite(value)) {
      lastTotal = value;
      break;
    }
  }
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const consumption24h = consumption.reduce((sum, entry) => {
    const ts = Date.parse(entry.timestamp);
    if (Number.isFinite(ts) && ts >= cutoff) {
      return sum + (Number(entry.consumption) || 0);
    }
    return sum;
  }, 0);
  const lastDeposit = lastDepositEntry && Number(lastDepositEntry.gas_deposit) > 0
    ? {
      amount: Number(lastDepositEntry.gas_deposit),
      timestamp: lastDepositEntry.timestamp,
      contract: lastDepositEntry.contract
    }
    : null;
  return {
    lastTotal,
    consumption24h,
    lastDeposit
  };
}

function sumConsumptionSince(entries, startMs) {
  return entries.reduce((sum, entry) => {
    const ts = Date.parse(entry.timestamp);
    if (Number.isFinite(ts) && ts >= startMs) {
      return sum + (Number(entry.consumption) || 0);
    }
    return sum;
  }, 0);
}

function computeProfitWindows(db, windows, consumption) {
  const now = Date.now();
  const netExpr = reportNetPnlExpr('t');
  const timeExpr = reportTradeTimeExpr('t');
  return windows.map((window) => {
    const startMs = now - (window.hours * 60 * 60 * 1000);
    const row = db.prepare(`
      SELECT COUNT(1) AS trades, SUM(${netExpr}) AS profit
      FROM completed_trades t
      WHERE ${timeExpr} >= ?
    `).get(startMs);
    const profit = Number(row?.profit) || 0;
    const trades = row?.trades || 0;
    const gasUsed = sumConsumptionSince(consumption, startMs);
    return {
      label: window.label,
      hours: window.hours,
      trades,
      profit,
      gasUsed,
      netAfterGas: profit - gasUsed
    };
  });
}
