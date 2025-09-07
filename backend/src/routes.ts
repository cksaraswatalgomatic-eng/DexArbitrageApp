import { Router, Request, Response } from 'express';
import { PrismaClient, Balance_timeseries } from '@prisma/client';
import { z } from 'zod';
import { Parser } from 'json2csv';
import { ParquetWriter } from 'parquetjs-lite';

const router = Router();
const prisma = new PrismaClient();

// GET /api/snapshot
router.get('/snapshot', async (req: Request, res: Response) => {
  const lastPortfolioTime = await prisma.portfolio_timeseries.findFirst({
    orderBy: { ts: 'desc' },
  });

  if (!lastPortfolioTime) {
    return res.status(404).json({ error: 'No data available' });
  }

  const lastBalances = await prisma.balance_timeseries.findMany({
    where: { ts: lastPortfolioTime.ts },
  });

  res.json({
    ts: lastPortfolioTime.ts,
        exchanges: lastBalances.map(b => ({ exchange: b.exchange, usdtVal: b.usdt_val, coinVal: b.coin_val, totalUsd: b.total_usd })),
    portfolioTotalUsd: lastPortfolioTime.total_usd,
  });
});

const seriesQuerySchema = z.object({
    from: z.string().transform(s => parseInt(s, 10)).optional(),
    to: z.string().transform(s => parseInt(s, 10)).optional(),
});

// GET /api/portfolio/series
router.get('/portfolio/series', async (req: Request, res: Response) => {
    const query = seriesQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json(query.error);
    }
    const { from, to } = query.data;

    const series = await prisma.portfolio_timeseries.findMany({
        where: {
            ts: {
                gte: from,
                lte: to,
            },
        },
        orderBy: { ts: 'asc' },
    });
    res.json(series);
});

// GET /api/exchange/series/:exchange
router.get('/exchange/series/:exchange', async (req: Request, res: Response) => {
    const { exchange } = req.params;
    const query = seriesQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json(query.error);
    }
    const { from, to } = query.data;

    const series = await prisma.balance_timeseries.findMany({
        where: {
            exchange,
            ts: {
                gte: from,
                lte: to,
            },
        },
        orderBy: { ts: 'asc' },
    });
    res.json(series);
});

// GET /api/trades/summary
router.get('/trades/summary', async (req: Request, res: Response) => {
    const query = seriesQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json(query.error);
    }
    const { from, to } = query.data;

    const summary = await prisma.trades.aggregate({
        where: {
            last_update_time: {
                gte: from,
                lte: to,
            },
        },
        _count: {
            id: true,
        },
        _sum: {
            executed_profit: true,
            estimated_profit: true,
        },
        _avg: {
            executed_profit: true,
        }
    });

    res.json(summary);
});

// GET /api/export/portfolio.csv
router.get('/export/portfolio.csv', async (req: Request, res: Response) => {
    const data = await prisma.portfolio_timeseries.findMany();
    const parser = new Parser();
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('portfolio.csv');
    res.send(csv);
});

// GET /api/export/trades.csv
router.get('/export/trades.csv', async (req: Request, res: Response) => {
    const data = await prisma.trades.findMany();
    const parser = new Parser();
    const csv = parser.parse(data);
    res.header('Content-Type', 'text/csv');
    res.attachment('trades.csv');
    res.send(csv);
});

// GET /api/export/portfolio.parquet
router.get('/export/portfolio.parquet', async (req: Request, res: Response) => {
    const data = await prisma.portfolio_timeseries.findMany();
    const schema = new (ParquetWriter as any).ParquetSchema({
        id: { type: 'INT32' },
        ts: { type: 'INT64' },
        total_usd: { type: 'DOUBLE' },
        exchanges_count: { type: 'INT32' },
    });
    const writer = await (ParquetWriter as any).openStream(schema, res, { useDataPageV2: false });
    for (const row of data) {
        await writer.appendRow(row);
    }
    await writer.close();
    res.end();
});

// GET /api/export/trades.parquet
router.get('/export/trades.parquet', async (req: Request, res: Response) => {
    const data = await prisma.trades.findMany();
    const schema = new (ParquetWriter as any).ParquetSchema({
        id: { type: 'INT32' },
        fsm_type: { type: 'UTF8' },
        pair: { type: 'UTF8' },
        src_exchange: { type: 'UTF8' },
        dst_exchange: { type: 'UTF8' },
        status: { type: 'UTF8' },
        user: { type: 'UTF8' },
        estimated_profit_normalized: { type: 'DOUBLE' },
        estimated_profit: { type: 'DOUBLE' },
        estimated_gross_profit: { type: 'DOUBLE' },
        executed_profit_normalized: { type: 'DOUBLE' },
        executed_profit: { type: 'DOUBLE' },
        executed_gross_profit: { type: 'DOUBLE' },
        executed_time_ms: { type: 'INT64' },
        estimated_src_price: { type: 'DOUBLE' },
        estimated_dst_price: { type: 'DOUBLE' },
        estimated_qty: { type: 'DOUBLE' },
        executed_src_price: { type: 'DOUBLE' },
        executed_dst_price: { type: 'DOUBLE' },
        executed_qty_src: { type: 'DOUBLE' },
        executed_qty_dst: { type: 'DOUBLE' },
        props: { type: 'UTF8' },
        creation_time: { type: 'INT64' },
        open_time: { type: 'INT64' },
        last_update_time: { type: 'INT64' },
        tx_fee: { type: 'DOUBLE', optional: true },
        commission_percent: { type: 'DOUBLE', optional: true },
        hedge: { type: 'INT32', optional: true },
        raw_json: { type: 'UTF8' },
    });
    const writer = await (ParquetWriter as any).openStream(schema, res, { useDataPageV2: false });
    for (const row of data) {
        await writer.appendRow(row);
    }
    await writer.close();
    res.end();
});

export default router;