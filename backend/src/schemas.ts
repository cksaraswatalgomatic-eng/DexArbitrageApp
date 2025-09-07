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
  src_exchange: z.string().optional().nullable(),
  dst_exchange: z.string().optional().nullable(),
  status: z.string(),
  user: z.string(),
  estimated_profit_normalized: z.number().optional().nullable(),
  estimated_profit: z.number().optional().nullable(),
  estimated_gross_profit: z.number().optional().nullable(),
  executed_profit_normalized: z.number().optional().nullable(),
  executed_profit: z.number().optional().nullable(),
  executed_gross_profit: z.number().optional().nullable(),
  executedTime: z.number(),
  estimated_src_price: z.number().optional().nullable(),
  estimated_dst_price: z.number().optional().nullable(),
  estimated_qty: z.number().optional().nullable(),
  executed_src_price: z.number().optional().nullable(),
  executed_dst_price: z.number().optional().nullable(),
  executed_qty_src: z.number().optional().nullable(),
  executed_qty_dst: z.number().optional().nullable(),
  props: z.string(),
  creation_time: z.number().optional().nullable(),
  open_time: z.number().optional().nullable(),
  last_update_time: z.number().optional().nullable(),
  tx_fee: z.number().optional().nullable(),
  commission_percent: z.number().optional().nullable(),
  hedge: z.boolean(),
});

export const CompletedTradesSchema = z.array(TradeSchema);
