require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

// PostgreSQL connection pool
const pool = new Pool({
  user: process.env.PGUSER || 'dex_app_user',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'dex_arbitrage_app',
  password: process.env.PGPASSWORD || 'your_secure_password',
  port: process.env.PGPORT || 5432,
});

async function ensureDb() {
  console.log('Attempting to connect to PostgreSQL for table creation...');
  const client = await pool.connect();
  try {
    console.log('Connected to PostgreSQL. Creating tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS balances_history (
        id SERIAL PRIMARY KEY,
        "serverId" TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        total_usdt REAL,
        total_coin REAL,
        raw_data JSONB
      );
    `);
    console.log('Table balances_history created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS completed_trades (
        id BIGINT PRIMARY KEY,
        fsmType TEXT,
        pair TEXT,
        srcExchange TEXT,
        dstExchange TEXT,
        status TEXT,
        "user" TEXT,
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
        executedTime BIGINT,
        executedSrcPrice REAL,
        executedDstPrice REAL,
        executedQtySrc REAL,
        executedQtyDst REAL,
        executedFeeTotal REAL,
        executedFeePercent REAL,
        props JSONB,
        creationTime BIGINT,
        openTime BIGINT,
        lastUpdateTime BIGINT,
        nwId TEXT,
        txFee REAL,
        calculatedVolume REAL,
        conveyedVolume REAL,
        commissionPercent REAL,
        hedge INTEGER,
        raw_data JSONB
      );
    `);
    console.log('Table completed_trades created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS server_tokens (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        name TEXT NOT NULL,
        buy REAL,
        sell REAL
      );
    `);
    console.log('Table server_tokens created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS gas_balances (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        contract TEXT NOT NULL,
        gas REAL,
        is_low INTEGER
      );
    `);
    console.log('Table gas_balances created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS gas_balance_tracking (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        contract TEXT NOT NULL,
        gas_balance REAL,
        gas_deposit REAL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'auto',
        note TEXT
      );
    `);
    console.log('Table gas_balance_tracking created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS diff_history (
        id SERIAL PRIMARY KEY,
        curId TEXT NOT NULL,
        ts BIGINT NOT NULL,
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
    console.log('Table diff_history created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS contract_transactions (
        hash TEXT NOT NULL,
        serverId TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        isError INTEGER NOT NULL,
        reason TEXT,
        ethPrice REAL,
        polPrice REAL,
        bnbPrice REAL,
        raw_data JSONB,
        PRIMARY KEY (serverId, hash)
      );
    `);
    console.log('Table contract_transactions created or already exists.');
    await client.query(`
      CREATE TABLE IF NOT EXISTS liquidity_data (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        liquidity REAL NOT NULL
      );
    `);
    console.log('Table liquidity_data created or already exists.');
    console.log('All tables checked/created successfully.');
  } finally {
    client.release();
  }
}

const rootDir = path.join(__dirname, '..');
const sqliteFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.sqlite'));

async function migrate() {
  await ensureDb();
  for (const file of sqliteFiles) {
    const serverId = file.replace('data-', '').replace('.sqlite', '');
    const sqliteDb = new Database(path.join(rootDir, file));
    console.log(`Migrating ${file} (serverId: ${serverId})...`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // balances_history
      try {
        const balances = sqliteDb.prepare('SELECT * FROM balances_history').all();
        for (const row of balances) {
          await client.query(
            'INSERT INTO balances_history ("serverId", timestamp, total_usdt, total_coin, raw_data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [serverId, new Date(row.timestamp), row.total_usdt, row.total_coin, row.raw_data]
          );
        }
        console.log(`  - Migrated ${balances.length} rows from balances_history`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table balances_history not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // completed_trades
      try {
        const trades = sqliteDb.prepare('SELECT * FROM completed_trades').all();
        for (const row of trades) {
          await client.query(
            `INSERT INTO completed_trades (
              id, fsmType, pair, srcExchange, dstExchange, status, "user",
              estimatedProfitNormalized, estimatedProfit, estimatedGrossProfit, eta,
              estimatedSrcPrice, estimatedDstPrice, estimatedQty,
              executedProfitNormalized, executedProfit, executedGrossProfit, executedTime,
              executedSrcPrice, executedDstPrice, executedQtySrc, executedQtyDst,
              executedFeeTotal, executedFeePercent, props, creationTime, openTime, lastUpdateTime,
              nwId, txFee, calculatedVolume, conveyedVolume, commissionPercent, hedge, raw_data
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35
            ) ON CONFLICT (id) DO NOTHING`,
            [
              row.id, row.fsmType, row.pair, row.srcExchange, row.dstExchange, row.status, row.user,
              row.estimatedProfitNormalized, row.estimatedProfit, row.estimatedGrossProfit, row.eta,
              row.estimatedSrcPrice, row.estimatedDstPrice, row.estimatedQty,
              row.executedProfitNormalized, row.executedProfit, row.executedGrossProfit, row.executedTime,
              row.executedSrcPrice, row.executedDstPrice, row.executedQtySrc, row.executedQtyDst,
              row.executedFeeTotal, row.executedFeePercent, row.props, row.creationTime, row.openTime, row.lastUpdateTime,
              row.nwId, row.txFee, row.calculatedVolume, row.conveyedVolume, row.commissionPercent, row.hedge, row.raw_data
            ]
          );
        }
        console.log(`  - Migrated ${trades.length} rows from completed_trades`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table completed_trades not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // server_tokens
      try {
        const tokens = sqliteDb.prepare('SELECT * FROM server_tokens').all();
        for (const row of tokens) {
          await client.query(
            'INSERT INTO server_tokens (timestamp, name, buy, sell) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [new Date(row.timestamp), row.name, row.buy, row.sell]
          );
        }
        console.log(`  - Migrated ${tokens.length} rows from server_tokens`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table server_tokens not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // gas_balances
      try {
        const gasBalances = sqliteDb.prepare('SELECT * FROM gas_balances').all();
        for (const row of gasBalances) {
          await client.query(
            'INSERT INTO gas_balances (timestamp, contract, gas, is_low) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [new Date(row.timestamp), row.contract, row.gas, row.is_low]
          );
        }
        console.log(`  - Migrated ${gasBalances.length} rows from gas_balances`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table gas_balances not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // gas_balance_tracking
      try {
        const gasTracking = sqliteDb.prepare('SELECT * FROM gas_balance_tracking').all();
        for (const row of gasTracking) {
          await client.query(
            'INSERT INTO gas_balance_tracking (timestamp, contract, gas_balance, gas_deposit, source, note) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
            [new Date(row.timestamp), row.contract, row.gas_balance, row.gas_deposit, row.source, row.note]
          );
        }
        console.log(`  - Migrated ${gasTracking.length} rows from gas_balance_tracking`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table gas_balance_tracking not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // diff_history
      try {
        const diffHistory = sqliteDb.prepare('SELECT * FROM diff_history').all();
        for (const row of diffHistory) {
          await client.query(
            'INSERT INTO diff_history (curId, ts, buyDiffBps, sellDiffBps, cexVol, serverBuy, serverSell, dexVolume, rejectReason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (curId, ts) DO NOTHING',
            [row.curId, row.ts, row.buyDiffBps, row.sellDiffBps, row.cexVol, row.serverBuy, row.serverSell, row.dexVolume, row.rejectReason]
          );
        }
        console.log(`  - Migrated ${diffHistory.length} rows from diff_history`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table diff_history not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // contract_transactions
      try {
        const contractTxs = sqliteDb.prepare('SELECT * FROM contract_transactions').all();
        for (const row of contractTxs) {
          await client.query(
            'INSERT INTO contract_transactions (hash, serverId, timestamp, isError, reason, ethPrice, polPrice, bnbPrice, raw_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (serverId, hash) DO NOTHING',
            [row.hash, row.serverId, row.timestamp, row.isError, row.reason, row.ethPrice, row.polPrice, row.bnbPrice, row.raw_data]
          );
        }
        console.log(`  - Migrated ${contractTxs.length} rows from contract_transactions`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table contract_transactions not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      // liquidity_data
      try {
        const liquidityData = sqliteDb.prepare('SELECT * FROM liquidity_data').all();
        for (const row of liquidityData) {
          await client.query(
            'INSERT INTO liquidity_data (timestamp, symbol, price, liquidity) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [new Date(row.timestamp), row.symbol, row.price, row.liquidity]
          );
        }
        console.log(`  - Migrated ${liquidityData.length} rows from liquidity_data`);
      } catch (e) {
        if (e.code === 'SQLITE_ERROR' && e.message.includes('no such table')) {
          console.warn(`  - Warning: Table liquidity_data not found in ${file}. Skipping.`);
        } else {
          throw e; // Re-throw other errors
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`Error migrating ${file}:`, e);
    } finally {
      client.release();
      sqliteDb.close();
    }
  }
}

migrate().then(() => {
  console.log('Migration complete.');
  pool.end();
}).catch(err => {
  console.error('Migration failed:', err);
  pool.end();
});
