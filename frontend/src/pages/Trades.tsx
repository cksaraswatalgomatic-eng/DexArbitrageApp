import { useData } from '../hooks/useData';

interface TradesSummary {
    _count: { id: number };
    _sum: { executed_profit: number | null; estimated_profit: number | null };
    _avg: { executed_profit: number | null };
}

export default function Trades() {
  const { data: summary, loading, error } = useData<TradesSummary>('/api/trades/summary');

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error loading data</div>;

  return (
    <div>
      <h1>Trades Analytics</h1>
      {summary && (
        <div>
          <h2>Summary</h2>
          <p>Total Trades: {summary._count.id}</p>
          <p>Total Executed Profit: ${summary._sum.executed_profit?.toFixed(2)}</p>
          <p>Total Estimated Profit: ${summary._sum.estimated_profit?.toFixed(2)}</p>
          <p>Average Executed Profit: ${summary._avg.executed_profit?.toFixed(2)}</p>
        </div>
      )}
      <a href="/api/export/trades.csv" download>
        <button>Download Trades (CSV)</button>
      </a>
    </div>
  );
}