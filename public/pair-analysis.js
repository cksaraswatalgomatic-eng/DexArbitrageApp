const limitEl = document.getElementById('limit');
const reloadBtn = document.getElementById('reloadBtn');
const statusEl = document.getElementById('status');
const winnersBody = document.querySelector('#winnersTbl tbody');
const losersBody = document.querySelector('#losersTbl tbody');
const featuresBody = document.querySelector('#featuresTbl tbody');

const pairSearchInputEl = document.getElementById('pairSearchInput');
const pairSearchSelectEl = document.getElementById('pairSearchSelect');
const correlationAttributeSelectEl = document.getElementById('correlationAttributeSelect');

let barChart, winnersWinRateChart, losersLossChart;
let netProfitDistributionChart, netProfitCorrelationChart;
let allPairsList = []; // Store all pairs for filtering

function getChartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#C9D1D9' } },
      tooltip: {
        backgroundColor: '#161B22',
        titleColor: '#C9D1D9',
        bodyColor: '#C9D1D9',
        borderColor: '#30363D',
        borderWidth: 1,
      }
    },
    scales: {
      x: {
        ticks: { color: '#8B949E' },
        grid: { color: '#30363D' }
      },
      y: {
        ticks: { color: '#8B949E' },
        grid: { color: '#30363D' }
      }
    }
  };
}

// Table utilities: sort on header click, filter with search input
function enableTableFeaturesById(tableId, searchId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const parseNum = (s) => { const n = parseFloat(String(s).replace(/[, %]/g,'')); return Number.isFinite(n) ? n : null; };
  if (thead && !thead.dataset.enhanced) {
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th'); if (!th) return;
      const idx = Array.from(thead.querySelectorAll('th')).indexOf(th);
      if (idx < 0) return;
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc'; th.dataset.dir = dir;
      const rows = Array.from(tbody.rows);
      rows.sort((a,b)=>{
        const av=a.cells[idx]?.innerText||''; const bv=b.cells[idx]?.innerText||'';
        const na=parseNum(av), nb=parseNum(bv);
        const res = (na!=null && nb!=null) ? (na-nb) : av.localeCompare(bv, undefined, {numeric:true, sensitivity:'base'});
        return dir==='asc'?res:-res;
      });
      rows.forEach(r=>tbody.appendChild(r));
    });
    thead.dataset.enhanced = '1';
  }
  if (searchId) {
    const input = document.getElementById(searchId);
    if (input && !input.dataset.enhanced) {
      input.addEventListener('input', () => {
        const q = input.value.toLowerCase();
        Array.from(tbody.rows).forEach(r => {
          r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
        });
      });
      input.dataset.enhanced = '1';
    }
  }
}

async function fetchJSON(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
}

function fmt(n, d=2) { return Number.isFinite(n) ? Number(n).toLocaleString(undefined, { maximumFractionDigits:d }) : ''; }

function row(html) { const tr = document.createElement('tr'); tr.innerHTML = html; return tr; }

// Normalize various props encodings into a canonical shape (copied from app.js)
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
      // Find Dex as value of any *_link_* key
      for (const [k, v] of Object.entries(p)) {
        if (/[_-]link[_-]/i.test(k)) { out.Dex = String(v); break; }
      }
      // Find numeric key/value pair -> key = Diff, value = DexSlip
      for (const [k, v] of Object.entries(p)) {
        const nk = Number(k); const nv = Number(v);
        if (Number.isFinite(nk) && Number.isFinite(nv)) { out.Diff = nk; out.DexSlip = nv; break; }
      }
    }
    return out;
  } catch { return {}; }
}

async function load() {
  statusEl.textContent = 'Loading...';
  const limit = parseInt(limitEl.value, 10) || 1000;
  const data = await fetchJSON(`/trades/analytics/pairs?limit=${limit}`);
  statusEl.textContent = `Pairs: ${data.totalPairs} | Generated: ${new Date(data.generatedAt).toLocaleString()}`;

  winnersBody.innerHTML = '';
  for (const p of data.topWinners.slice(0,20)) {
    const profitClass = Number(p.totalNetProfit) > 0 ? 'text-pos' : Number(p.totalNetProfit) < 0 ? 'text-neg' : '';
    winnersBody.appendChild(row(`<td>${p.pair}</td><td>${p.trades}</td><td>${fmt(p.winRate*100)}</td><td class="${profitClass}">${fmt(p.totalNetProfit)}</td><td>${fmt(p.avgNetProfit)}</td>`));
  }
  enableTableFeaturesById('winnersTbl', 'winnersSearch');
  losersBody.innerHTML = '';
  for (const p of data.topLosers.slice(0,20)) {
    const profitClass = Number(p.totalNetProfit) > 0 ? 'text-pos' : Number(p.totalNetProfit) < 0 ? 'text-neg' : '';
    losersBody.appendChild(row(`<td>${p.pair}</td><td>${p.trades}</td><td>${fmt(p.winRate*100)}</td><td class="${profitClass}">${fmt(p.totalNetProfit)}</td><td>${fmt(p.avgNetProfit)}</td>`));
  }
  enableTableFeaturesById('losersTbl', 'losersSearch');

  // Feature table
  featuresBody.innerHTML = '';
  const all = [...data.pairs].sort((a,b)=> a.pair.localeCompare(b.pair));
  for (const p of all) {
    const f = p.features || {};
    const d = f.Diff||{}; const dx = f.DexSlip||{}; const cx = f.CexSlip||{};
    const cexWinClass = Number(cx.avgWin) > 0 ? 'text-neg' : Number(cx.avgWin) < 0 ? 'text-pos' : '';
    const cexLossClass = Number(cx.avgLoss) > 0 ? 'text-neg' : Number(cx.avgLoss) < 0 ? 'text-pos' : '';
    const cexAvgClass = Number(cx.avg) > 0 ? 'text-neg' : Number(cx.avg) < 0 ? 'text-pos' : '';
    const profitClass = Number(p.totalNetProfit) > 0 ? 'text-pos' : Number(p.totalNetProfit) < 0 ? 'text-neg' : '';
    featuresBody.appendChild(row(`
      <td>${p.pair}</td>
      <td>${p.trades}</td>
      <td class="${profitClass}">${fmt(p.totalNetProfit)}</td>
      <td>${fmt(d.avgWin)}</td>
      <td>${fmt(d.avgLoss)}</td>
      <td>${fmt(dx.avgWin)}</td>
      <td>${fmt(dx.avgLoss)}</td>
      <td class="${cexWinClass}">${fmt(cx.avgWin)}</td>
      <td class="${cexLossClass}">${fmt(cx.avgLoss)}</td>
      <td class="${cexAvgClass}">${fmt(cx.avg)}</td>
    `));
  }
  enableTableFeaturesById('featuresTbl', 'featuresSearch');

  // Main bar chart
  const top20 = [...data.pairs].sort((a,b)=> b.totalNetProfit-a.totalNetProfit).slice(0,20);
  const labels = top20.map(p=>p.pair);
  const values = top20.map(p=>p.totalNetProfit);
  const backgroundColors = values.map(val => val >= 0 ? 'rgba(57, 255, 20, 0.6)' : 'rgba(255, 0, 255, 0.6)');
  const ctx = document.getElementById('barChart').getContext('2d');
  if (!barChart) {
    barChart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Total Net Profit', data: values, backgroundColor: backgroundColors }] }, options: getChartBaseOptions() });
  } else {
    barChart.data.labels = labels; barChart.data.datasets[0].data = values; barChart.data.datasets[0].backgroundColor = backgroundColors; barChart.update();
  }

  // Optional visualizations
  const topW = data.topWinners.slice(0,20);
  const wLabels = topW.map(p=>p.pair);
  const wRates = topW.map(p=> (p.winRate||0)*100);
  const topL = data.topLosers.slice(0,20);
  const lLabels = topL.map(p=>p.pair);
  const lLosses = topL.map(p=> Math.abs(p.totalGrossProfit||0));

  function ensureWinnersWinRate(){
    const c = document.getElementById('winnersWinRate').getContext('2d');
    if (!winnersWinRateChart) {
      winnersWinRateChart = new Chart(c, { type:'bar', data:{ labels:wLabels, datasets:[{ label:'Win %', data:wRates, backgroundColor:'rgba(0, 229, 255, 0.6)'}] }, options: getChartBaseOptions() });
    } else { winnersWinRateChart.data.labels=wLabels; winnersWinRateChart.data.datasets[0].data=wRates; winnersWinRateChart.update(); }
  }
  function ensureLosersLoss(){
    const c = document.getElementById('losersLoss').getContext('2d');
    if (!losersLossChart) {
      losersLossChart = new Chart(c, { type:'bar', data:{ labels:lLabels, datasets:[{ label:'Total Loss (abs)', data:lLosses, backgroundColor:'rgba(255, 0, 255, 0.6)'}] }, options: getChartBaseOptions() });
    } else { losersLossChart.data.labels=lLabels; losersLossChart.data.datasets[0].data=lLosses; losersLossChart.update(); }
  }

  if (!load._visualizeBound) {
    document.getElementById('visualizeBtn').addEventListener('click', () => {
      ensureWinnersWinRate();
      ensureLosersLoss();
    });
    load._visualizeBound = true;
  }
}

reloadBtn.addEventListener('click', load);
load().catch(e=> statusEl.textContent = e.message);

let allTradesForSelectedPair = [];

async function loadPairsForSelection() {
    try {
        const pairs = await fetchJSON('/trades/pairs');
        allPairsList = Array.from(new Set(pairs)).sort();
        renderFilteredPairs('');
    } catch (e) {
        console.error('Failed to load pairs for selection', e);
    }
}

function renderFilteredPairs(query) {
    const q = (query || '').toLowerCase();
    pairSearchSelectEl.innerHTML = '<option value="">-- Select a Pair --</option>';
    const filteredPairs = allPairsList.filter(p => p.toLowerCase().includes(q));
    for (const p of filteredPairs) {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        pairSearchSelectEl.appendChild(opt);
    }
}

function renderNetProfitDistributionChart(trades) {
    if (netProfitDistributionChart) netProfitDistributionChart.destroy();
    const validTrades = trades.filter(t => (t.lastUpdateTime || t.creationTime) && !isNaN(new Date(t.lastUpdateTime || t.creationTime).getTime()));
    const groupedData = new Map();
    validTrades.forEach(t => {
        const timestamp = new Date(t.lastUpdateTime || t.creationTime);
        const groupKey = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate(), timestamp.getHours());
        const netProfit = (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
        if (Number.isFinite(netProfit)) {
            const key = groupKey.getTime();
            if (!groupedData.has(key)) groupedData.set(key, { timestamp: groupKey, totalProfit: 0, tradeCount: 0 });
            const data = groupedData.get(key);
            data.totalProfit += netProfit;
            data.tradeCount++;
        }
    });
    const chartData = Array.from(groupedData.values()).map(d => ({ x: d.timestamp, y: d.totalProfit, tradeCount: d.tradeCount })).sort((a, b) => a.x.getTime() - b.x.getTime());
    if (chartData.length === 0) return;

    const backgroundColors = chartData.map(p => p.y >= 0 ? 'rgba(57, 255, 20, 0.7)' : 'rgba(255, 0, 255, 0.7)');
    const ctx = document.getElementById('netProfitDistributionChart').getContext('2d');
    const baseOptions = getChartBaseOptions();
    netProfitDistributionChart = new Chart(ctx, {
        type: 'bar',
        data: { datasets: [{ label: 'Net Profit', data: chartData, backgroundColor: backgroundColors }] },
        options: { ...baseOptions, scales: { ...baseOptions.scales, x: { ...baseOptions.scales.x, type: 'time', time: { unit: 'hour' } } }, plugins: { ...baseOptions.plugins, zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, mode: 'x' } }, tooltip: { callbacks: { label: (ctx) => [`Net Profit: ${ctx.raw.y.toFixed(2)}`, `Trades: ${ctx.raw.tradeCount}`] } } } }
    });
}

function renderNetProfitCorrelationChart(trades, attribute) {
    if (netProfitCorrelationChart) netProfitCorrelationChart.destroy();
    const dataPoints = trades.map(t => {
        const props = normalizePropsRaw(t.props);
        const netProfit = (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
        return { x: props[attribute] || 0, y: netProfit };
    }).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

    const ctx = document.getElementById('netProfitCorrelationChart').getContext('2d');
    const baseOptions = getChartBaseOptions();
    netProfitCorrelationChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [{ label: `Net Profit vs ${attribute}`, data: dataPoints, backgroundColor: dataPoints.map(p => p.y >= 0 ? 'rgba(57, 255, 20, 0.7)' : 'rgba(255, 0, 255, 0.7)') }] },
        options: { ...baseOptions, scales: { ...baseOptions.scales, x: { ...baseOptions.scales.x, title: { display: true, text: attribute, color: '#8B949E' } }, y: { ...baseOptions.scales.y, title: { display: true, text: 'Net Profit', color: '#8B949E' } } }, plugins: { ...baseOptions.plugins, zoom: { pan: { enabled: true, mode: 'xy' }, zoom: { wheel: { enabled: true }, mode: 'xy' } }, tooltip: { callbacks: { label: (ctx) => [`${attribute}: ${ctx.parsed.x.toFixed(4)}`, `Net Profit: ${ctx.parsed.y.toFixed(2)}`] } } } }
    });
}

async function loadPairDataAndRenderCharts() {
    const selectedPair = pairSearchSelectEl.value;
    if (!selectedPair) {
        if (netProfitDistributionChart) netProfitDistributionChart.destroy();
        if (netProfitCorrelationChart) netProfitCorrelationChart.destroy();
        return;
    }

    // Fetch all trades for the selected pair (increased limit for better visualization)
    allTradesForSelectedPair = await fetchJSON(`/trades?pair=${selectedPair}&limit=5000`);

    renderNetProfitDistributionChart(allTradesForSelectedPair);
    renderNetProfitCorrelationChart(allTradesForSelectedPair, correlationAttributeSelectEl.value);
}

pairSearchSelectEl.addEventListener('change', loadPairDataAndRenderCharts);
correlationAttributeSelectEl.addEventListener('change', () => {
    renderNetProfitCorrelationChart(allTradesForSelectedPair, correlationAttributeSelectEl.value);
});

// Add search input event listener
pairSearchInputEl.addEventListener('input', (e) => {
    renderFilteredPairs(e.target.value);
});

loadPairsForSelection();

// Initial load of main analytics
load().catch(e=> statusEl.textContent = e.message);
