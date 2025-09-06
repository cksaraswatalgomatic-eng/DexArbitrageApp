import { useData } from '../hooks/useData';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface Snapshot {
  ts: number;
  exchanges: { exchange: string; usdtVal: number; coinVal: number; totalUsd: number }[];
  portfolioTotalUsd: number;
}

interface PortfolioSeries {
    id: number;
    ts: number;
    total_usd: number;
    exchanges_count: number;
}

export default function Dashboard() {
  const { data: snapshot, loading: snapshotLoading, error: snapshotError } = useData<Snapshot>('/api/snapshot');
  const { data: series, loading: seriesLoading, error: seriesError } = useData<PortfolioSeries[]>('/api/portfolio/series');

  if (snapshotLoading || seriesLoading) return <div>Loading...</div>;
  if (snapshotError || seriesError) return <div>Error loading data</div>;

  const chartData = {
    labels: series?.map(p => new Date(p.ts).toLocaleTimeString()),
    datasets: [
      {
        label: 'Portfolio Value (USD)',
        data: series?.map(p => p.total_usd) || [],
        fill: false,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
      },
    ],
  };

  return (
    <div>
      <h1>Dashboard</h1>
      {snapshot && (
        <div>
          <h2>Latest Snapshot</h2>
          <p>Total Portfolio Value: ${snapshot.portfolioTotalUsd.toFixed(2)}</p>
          <table>
            <thead>
              <tr>
                <th>Exchange</th>
                <th>USDT Value</th>
                <th>Coin Value</th>
                <th>Total USD</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.exchanges.map(e => (
                <tr key={e.exchange}>
                  <td>{e.exchange}</td>
                  <td>${e.usdtVal.toFixed(2)}</td>
                  <td>${e.coinVal.toFixed(2)}</td>
                  <td>${e.totalUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {series && <Line data={chartData} />}
    </div>
  );
}