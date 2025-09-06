import { z } from 'zod';

export const BalanceSchema = z.record(z.object({
  usdtVal: z.number().default(0),
  coinVal: z.number().default(0),
  balanceMap: z.record(z.any()),
}));

export const TradeSchema = z.object({
  id: z.number(),
  fsmType: z.string(),
  pair: z.string(),
  src_exchange: z.string(),
  dst_exchange: z.string(),
  status: z.string(),
  user: z.string(),
  estimated_profit_normalized: z.number(),
  estimated_profit: z.number(),
  estimated_gross_profit: z.number(),
  executed_profit_normalized: z.number(),
  executed_profit: z.number(),
  executed_gross_profit: z.number(),
  executed_time_ms: z.number(),
  estimated_src_price: z.number(),
  estimated_dst_price: z.number(),
  estimated_qty: z.number(),
  executed_src_price: z.number(),
  executed_dst_price: z.number(),
  executed_qty_src: z.number(),
  executed_qty_dst: z.number(),
  props: z.string(),
  creation_time: z.number(),
  open_time: z.number(),
  last_update_time: z.number(),
  tx_fee: z.number().nullable(),
  commission_percent: z.number().nullable(),
  hedge: z.number().nullable(),
});

export const CompletedTradesSchema = z.array(TradeSchema);
