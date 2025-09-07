import axios from 'axios';
import { PrismaClient, Prisma } from '@prisma/client';
import { BalanceSchema, CompletedTradesSchema } from '../schemas';
import pino from 'pino';

const logger = pino({ transport: { target: 'pino-pretty' } });
const prisma = new PrismaClient();

const BALANCES_URL = process.env.BALANCES_URL || 'http://195.201.178.120:3001/balance';
const TRADES_URL = process.env.TRADES_URL || 'http://195.201.178.120:3001/completed';

async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { timeout: 10000 });
      return response.data;
    } catch (error) {
      if (i < retries - 1) {
        logger.warn(`Fetch failed for ${url}, retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      } else {
        logger.error(`Failed to fetch ${url} after ${retries} attempts.`);
        throw error;
      }
    }
  }
}

export async function pollAndStoreData() {
  logger.info('Polling data...');
  try {
    const [balanceData, tradesData] = await Promise.all([
      fetchWithRetry(BALANCES_URL),
      fetchWithRetry(TRADES_URL),
    ]);

    // Validate data before processing
    const validatedBalances = BalanceSchema.parse(balanceData);
    const validatedTrades = CompletedTradesSchema.parse(tradesData);

    const ts = Date.now();
    let portfolioTotalUsd = 0;

    await prisma.$transaction(async (tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">) => {
      for (const exchange in validatedBalances) {
        const balance = validatedBalances[exchange];
        const total_usd = (balance.usdtVal || 0) + (balance.coinVal || 0);
        portfolioTotalUsd += total_usd;

        await tx.balance_timeseries.create({
          data: {
            ts,
            exchange,
            usdt_val: balance.usdtVal,
            coin_val: balance.coinVal,
            total_usd,
            raw_json: JSON.stringify(balance),
          },
        });
      }

      await tx.portfolio_timeseries.create({
        data: {
          ts,
          total_usd: portfolioTotalUsd,
          exchanges_count: Object.keys(validatedBalances).length,
        },
      });

      for (const trade of validatedTrades) {
        const { fsmType, executedTime, estimated_src_price, estimated_dst_price, estimated_qty, executed_src_price, executed_dst_price, executed_qty_src, executed_qty_dst, tx_fee, commission_percent, hedge, creation_time, open_time, last_update_time, src_exchange, dst_exchange, estimated_profit_normalized, estimated_profit, estimated_gross_profit, executed_profit_normalized, executed_profit, executed_gross_profit, ...restOfTrade } = trade;

        const tradeDataForPrisma = {
          ...restOfTrade,
          fsm_type: fsmType,
          executed_time_ms: executedTime,
          estimated_src_price: estimated_src_price ?? 0,
          estimated_dst_price: estimated_dst_price ?? 0,
          estimated_qty: estimated_qty ?? 0,
          executed_src_price: executed_src_price ?? 0,
          executed_dst_price: executed_dst_price ?? 0,
          executed_qty_src: executed_qty_src ?? 0,
          executed_qty_dst: executed_qty_dst ?? 0,
          tx_fee: tx_fee ?? 0,
          commission_percent: commission_percent ?? 0,
          hedge: hedge ? 1 : 0,
          creation_time: creation_time ?? 0,
          open_time: open_time ?? 0,
          last_update_time: last_update_time ?? 0,
          src_exchange: src_exchange ?? "",
          dst_exchange: dst_exchange ?? "",
          estimated_profit_normalized: estimated_profit_normalized ?? 0,
          estimated_profit: estimated_profit ?? 0,
          estimated_gross_profit: estimated_gross_profit ?? 0,
          executed_profit_normalized: executed_profit_normalized ?? 0,
          executed_profit: executed_profit ?? 0,
          executed_gross_profit: executed_gross_profit ?? 0,
          raw_json: JSON.stringify(trade),
        };

        await tx.trades.upsert({
          where: { id: trade.id },
          update: tradeDataForPrisma,
          create: tradeDataForPrisma,
        });
      }
    });

    logger.info('Data polled and stored successfully.');
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ msg: 'Error polling and storing data:', err: error.message, stack: error.stack });
    } else {
      logger.error({ msg: 'An unknown error occurred during polling and storing data', err: error });
    }
  }
}
