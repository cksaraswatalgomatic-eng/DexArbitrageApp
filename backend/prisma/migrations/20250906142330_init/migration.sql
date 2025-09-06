-- CreateTable
CREATE TABLE "balance_timeseries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ts" INTEGER NOT NULL,
    "exchange" TEXT NOT NULL,
    "usdt_val" REAL NOT NULL,
    "coin_val" REAL NOT NULL,
    "total_usd" REAL NOT NULL,
    "raw_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "portfolio_timeseries" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ts" INTEGER NOT NULL,
    "total_usd" REAL NOT NULL,
    "exchanges_count" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "trades" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fsm_type" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "src_exchange" TEXT NOT NULL,
    "dst_exchange" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "estimated_profit_normalized" REAL NOT NULL,
    "estimated_profit" REAL NOT NULL,
    "estimated_gross_profit" REAL NOT NULL,
    "executed_profit_normalized" REAL NOT NULL,
    "executed_profit" REAL NOT NULL,
    "executed_gross_profit" REAL NOT NULL,
    "executed_time_ms" INTEGER NOT NULL,
    "estimated_src_price" REAL NOT NULL,
    "estimated_dst_price" REAL NOT NULL,
    "estimated_qty" REAL NOT NULL,
    "executed_src_price" REAL NOT NULL,
    "executed_dst_price" REAL NOT NULL,
    "executed_qty_src" REAL NOT NULL,
    "executed_qty_dst" REAL NOT NULL,
    "props" TEXT NOT NULL,
    "creation_time" INTEGER NOT NULL,
    "open_time" INTEGER NOT NULL,
    "last_update_time" INTEGER NOT NULL,
    "tx_fee" REAL,
    "commission_percent" REAL,
    "hedge" INTEGER,
    "raw_json" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "balance_timeseries_ts_idx" ON "balance_timeseries"("ts");

-- CreateIndex
CREATE INDEX "balance_timeseries_exchange_ts_idx" ON "balance_timeseries"("exchange", "ts");

-- CreateIndex
CREATE INDEX "portfolio_timeseries_ts_idx" ON "portfolio_timeseries"("ts");

-- CreateIndex
CREATE INDEX "trades_last_update_time_idx" ON "trades"("last_update_time");

-- CreateIndex
CREATE INDEX "trades_status_idx" ON "trades"("status");
