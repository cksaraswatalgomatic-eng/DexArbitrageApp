const { parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { Notifier } = require('./notifier');
const { spawn } = require('child_process');

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
        "lowGas": { "cooldownMinutes": 60 },
        "pollFailed": { "cooldownMinutes": 60 },
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
  return (typeof base === 'string' ? base : '').replace(///$/, '');
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
          const profitThreshold = notifier.getRuleConfig('profit')?.thresholdPercent ?? -5;
          if (t.executedProfitNormalized != null && t.executedProfitNormalized < profitThreshold) {
            notifier.notify('profit-trade', {
              title: `Low profit trade: ${t.pair}`,
              message: `Profit: ${(t.executedProfitNormalized || 0).toFixed(2)}%`,
              details: { tradeId: t.id, pair: t.pair, profit: t.executedProfitNormalized },
              uniqueKey: `low-profit-${t.id}`  // Unique key to prevent duplicate notifications for same trade
            });
          }
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
      const legacyUrl = `${legacyApi}/api?module=account&action=txlist&address=${encodeURIComponent(contractAddress)}&sort=desc&page=1&offset=1000${explorerApiKey ? `&apikey=${encodeURIComponent(explorerApiKey)}` : ''}`; // Added apikey
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
        const mindiff = propsStr.match(/Mindiff:[\d.]+/)?.[
1];
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
  const servers = cfg.servers; // Iterate over all servers
  
  for (const server of servers) { // Loop through each server
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

      let message = `Daily digest for ${server.label}:
`;
      message += `24h P&L: ${Number.isFinite(profitLast24h) ? profitLast24h.toFixed(2) : '0.00'}
`;
      message += `Success Rate: ${Number.isFinite(successRate) ? successRate.toFixed(2) : '0.00'}%
`;
      message += `Error Count: ${Number.isFinite(errorCount) ? errorCount : '0'}
`;
      message += `Top Pairs (by profit):
`;
      for (const pair of topPairs) {
        message += `  - ${pair.pair}: ${Number.isFinite(pair.totalProfit) ? pair.totalProfit.toFixed(2) : '0.00'}
`;
      }
      message += `Total Fee Spend: ${Number.isFinite(totalFeeSpend) ? totalFeeSpend.toFixed(2) : '0.00'}
`;
      message += `Low Gas Occurrences: ${Number.isFinite(gasLowOccurrences) ? gasLowOccurrences : '0'}
`;

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

    const profitThreshold = notifier.getRuleConfig('profit-trade')?.thresholdPercent ?? -5;
    for (const trade of recentTrades) {
      if (trade.executedProfitNormalized != null && trade.executedProfitNormalized < profitThreshold) {
        await notifier.notify('profit-trade', {
          title: `Low profit trade: ${trade.pair}`,
          message: `Profit: ${(trade.executedProfitNormalized || 0).toFixed(2)}%`,
          details: { 
            tradeId: trade.id, 
            pair: trade.pair, 
            profit: trade.executedProfitNormalized,
            server: server.label
          },
          uniqueKey: `low-profit-${trade.id}`  // Unique key to prevent duplicate notifications for same trade
        });
      }
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
    console.log('[etherscan] <-', masked, 'status', resp.status, 'keys', Object.keys(resp.data || {}))
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

async function fetchAllAndStore() {
  const cfg = loadServers();
  for (const s of cfg.servers) {
    await ensureInitialTradesSync(s);
    // Then fetch balances and trades in parallel
    await Promise.allSettled([fetchStatusAndStoreFor(s), fetchBalancesAndStoreFor(s), fetchTradesAndStoreFor(s), fetchDiffDataAndStoreFor(s), fetchContractTxsAndStoreFor(s)]);
  }
}

parentPort.on('message', async (message) => {
  if (message === 'start') {
    console.log('[worker] Starting initial fetch...');
    await fetchAllAndStore();
    console.log('[worker] Initial fetch complete.');
    // Schedule subsequent fetches
    cron.schedule('*/2 * * * *', async () => {
      console.log('[worker] Running scheduled fetch...');
      await fetchAllAndStore();
      // Also check notification conditions for all servers
      checkAllNotifications().catch(err => console.error('[worker] Error checking notifications:', err));
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