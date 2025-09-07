import axios from 'axios';
import { PrismaClient } from '@prisma/client';
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

    // Validate data
    const validatedBalances = BalanceSchema.parse(balanceData);
    const validatedTrades = CompletedTradesSchema.parse(tradesData);

    const ts = Date.now();
    let portfolioTotalUsd = 0;

    await prisma.$transaction(async (tx) => {
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
        await tx.trades.upsert({
          where: { id: trade.id },
          update: { ...trade, raw_json: JSON.stringify(trade) },
          create: { ...trade, raw_json: JSON.stringify(trade) },
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
