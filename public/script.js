const lastUpdatedEl = document.getElementById('lastUpdated');
const refreshBtn = document.getElementById('refreshBtn');
const tradesTableBody = document.querySelector('#tradesTable tbody');
const dexTableBody = document.querySelector('#dexBalancesTable tbody');
const cexTableBody = document.querySelector('#cexBalancesTable tbody');
const dexSummary = document.getElementById('dexSummary');
const cexSummary = document.getElementById('cexSummary');
const tradesLimitEl = document.getElementById('tradesLimit');

let chart;
let userZoomed = false;
let allBalanceData = []; // Global array to store all fetched balance data

// Register Chart.js zoom plugin when available
const zoomPlugin =
  window.ChartZoom ||
  (window['chartjs-plugin-zoom'] && (window['chartjs-plugin-zoom'].default || window['chartjs-plugin-zoom'])) ||
  null;

if (window.Chart && zoomPlugin && !window.__chartZoomRegistered) {
  Chart.register(zoomPlugin);
  window.__chartZoomRegistered = true;
} else if (window.Chart && !zoomPlugin && !window.__chartZoomWarned) {
  console.warn('Chart.js zoom plugin not found; zoom interactions disabled.');
  window.__chartZoomWarned = true;
}

function normalizePropsFront(raw) {
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    const out = {};

    for (const [k, v] of Object.entries(p)) {
      if (v === 'SELL' || v === 'BUY') {
        out.Dex = v;
      }
      if (k === 'Dex') {
        out.Dex = v;
      }
      if (k === 'Diff') {
        out.Diff = Number(v);
      }
      if (k === 'DexSlip') {
        out.DexSlip = Number(v);
      }
      if (k === 'CexSlip') {
        out.CexSlip = Number(v);
      }
      if (k === 'Exec') {
        out.Exec = String(v);
      }
    }

    return out;
  } catch { return {}; }
}

// Generic table helpers: click-to-sort and search filter
function enableTableFeatures(tableSelector, searchInputId) {
  const table = document.querySelector(tableSelector);
  if (!table) return;
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const parseNum = (s) => {
    const n = parseFloat(String(s).replace(/[, %]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  if (thead && !thead.dataset.enhanced) {
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      const ths = Array.from(thead.querySelectorAll('th'));
      const idx = ths.indexOf(th);
      if (idx < 0) return;
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      th.dataset.dir = dir;
      const rows = Array.from(tbody.rows);
      rows.sort((ra, rb) => {
        const a = ra.cells[idx]?.innerText || '';
        const b = rb.cells[idx]?.innerText || '';
        const na = parseNum(a);
        const nb = parseNum(b);
        let res;
        if (na != null && nb != null) res = na - nb;
        else res = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        return dir === 'asc' ? res : -res;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
    thead.dataset.enhanced = '1';
  }
  if (searchInputId) {
    const input = document.getElementById(searchInputId);
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

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function fmtNum(n, precision = 6) {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: precision });
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function getChartBaseOptions() {
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#30363D';
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#C9D1D9';
  const tooltipBg = getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || '#161B22';

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: textColor } },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: textColor,
        bodyColor: textColor,
        borderColor: gridColor,
        borderWidth: 1,
      },
      zoom: {
        pan: { enabled: true, mode: 'x', modifierKey: 'ctrl' },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          drag: { enabled: true },
          mode: 'x'
        }
      }
    },
    scales: {
      x: {
        ticks: { color: textColor },
        grid: { color: gridColor }
      },
      y: {
        ticks: { color: textColor },
        grid: { color: gridColor }
      }
    }
  };
}

document.getElementById('theme-switcher').addEventListener('click', () => {
    if (chart) {
        chart.destroy();
        chart = null;
        loadBalancesHistory();
    }
});

async function loadBalancesHistory(beforeTimestamp = null) {
  let url = '/balances/history?limit=5000';
  if (beforeTimestamp) {
    url += `&before_timestamp=${beforeTimestamp}`;
  }
  const newData = await fetchJSON(url);

  // Validate and filter data points with valid timestamps
  const validNewData = newData.filter(d => {
    const timestamp = new Date(d.timestamp);
    return d.timestamp && !isNaN(timestamp.getTime());
  });

  // Append new data and sort by timestamp
  allBalanceData = [...validNewData.map(d => ({ ...d, timestamp: new Date(d.timestamp) })), ...allBalanceData];
  allBalanceData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Filter out data points where total_usdt is 0
  const filteredBalanceData = allBalanceData.filter(d => d.total_usdt !== 0);

  const combinedPoints = filteredBalanceData.map(d => ({ x: d.timestamp, y: d.total_usdt }));
  const dexPoints = filteredBalanceData.map(d => ({ x: d.timestamp, y: d.total_dex_usdt }));
  const cexPoints = filteredBalanceData.map(d => ({ x: d.timestamp, y: d.total_cex_usdt }));

  // Compute a responsive time window based on the data actually present
  const validTimes = allBalanceData.map(p => p.timestamp.getTime()).filter(Number.isFinite);
  if (validTimes.length === 0) {
    console.warn('No valid timestamps found in balance data');
    return;
  }
  
  let minTime = Math.min(...validTimes);
  let maxTime = Math.max(...validTimes);
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
    minTime = Date.now() - 60 * 60 * 1000; // fallback: last hour
    maxTime = Date.now();
  }
  if (minTime === maxTime) {
    const pad = 10 * 60 * 1000; // 10 minutes padding if only one point
    minTime -= pad;
    maxTime += pad;
  }
  const xBounds = { min: new Date(minTime), max: new Date(maxTime) };

  if (!chart) {
    const ctx = document.getElementById('balancesChart').getContext('2d');
    const baseOptions = getChartBaseOptions();

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Total USDT (DEX + BinanceF)',
            data: combinedPoints,
            borderColor: '#39FF14', // Neon Green
            backgroundColor: 'rgba(57, 255, 20, 0.1)',
            tension: 0.25,
            borderWidth: 2,
            pointRadius: 0,
            parsing: false
          },
          {
            label: 'Total DEX',
            data: dexPoints,
            borderColor: '#00E5FF', // Cyan
            backgroundColor: 'rgba(0, 229, 255, 0.1)',
            borderWidth: 1.5,
            pointRadius: 0,
            parsing: false
          },
          {
            label: 'BinanceF total',
            data: cexPoints,
            borderColor: '#FF8C00', // Orange
            backgroundColor: 'rgba(255, 140, 0, 0.1)',
            borderWidth: 1.5,
            pointRadius: 0,
            parsing: false
          }
        ]
      },
      options: {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          x: {
            ...baseOptions.scales.x,
            type: 'time',
            time: {
              tooltipFormat: 'PPpp',
              displayFormats: { minute: 'HH:mm', hour: 'HH:mm' }
            },
            min: xBounds.min,
            max: xBounds.max,
          },
        },
        plugins: {
          ...baseOptions.plugins,
          zoom: {
            ...baseOptions.plugins.zoom,
            limits: { x: {min: xBounds.min, max: xBounds.max} },
            onZoomComplete: ({ chart }) => {
              userZoomed = true;
              const { min } = chart.scales.x;
              const oldestTimestamp = allBalanceData[0].timestamp.getTime();
              if (min < oldestTimestamp) {
                loadBalancesHistory(allBalanceData[0].timestamp.toISOString());
              }
            },
            onPanComplete: ({ chart }) => {
              userZoomed = true;
              const { min } = chart.scales.x;
              const oldestTimestamp = allBalanceData[0].timestamp.getTime();
              if (min < oldestTimestamp) {
                loadBalancesHistory(allBalanceData[0].timestamp.toISOString());
              }
            }
          }
        }
      }
    });
  } else {
    chart.data.datasets[0].data = combinedPoints;
    if (chart.data.datasets[1]) chart.data.datasets[1].data = dexPoints;
    if (chart.data.datasets[2]) chart.data.datasets[2].data = cexPoints;
    // Update time window only when not zoomed by user
    if (!userZoomed) {
      chart.options.scales.x.min = xBounds.min;
      chart.options.scales.x.max = xBounds.max;
    }
    chart.update();
  }
}

async function refreshAll() {
  try {
    console.log('Refreshing all data...');
    // When refreshing all, reset allBalanceData and fetch initial set
    allBalanceData = [];
    await Promise.all([loadBalancesHistory(), loadTrades(), loadExchangeBalances(), loadServerStatus()]);
    lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    console.log('All data refreshed successfully');
  } catch (err) {
    console.error('Error in refreshAll:', err);
    lastUpdatedEl.textContent = `Error: ${err.message}`;
  }
}

function getGradientColor(value) {
  const normalizedValue = Math.min(Math.max(value, 0.1), 0.9) / 0.8 - 0.125;
  const hue = (1 - normalizedValue) * 120;
  return `hsl(${hue}, 100%, 50%)`;
}

// Function to get gradient color based on net profit value
// Red for -1 and below, green for +1 and above, with interpolation in between
function getNetProfitColor(value) {
  if (!isFinite(value)) return '';
  
  // For values beyond -1 to +1, we'll cap the color intensity
  const clampedValue = Math.max(-1, Math.min(1, value));
  
  // Calculate RGB values for gradient from red (-1) to green (+1)
  let red, green;
  if (clampedValue < 0) {
    // Red to yellow range for negative values
    red = 255;
    green = Math.floor(255 * (1 + clampedValue));
  } else {
    // Yellow to green range for positive values
    red = Math.floor(255 * (1 - clampedValue));
    green = 255;
  }
  
  return `color: rgb(${red}, ${green}, 0)`;
}

async function loadServerStatus() {
  const sdiffStatusEl = document.getElementById('sdiffStatus');
  const tokensContainerEl = document.getElementById('tokensContainer');
  const gasBalanceContainerEl = document.getElementById('gasBalanceContainer');
  const profitStatsEl = document.getElementById('profitStats');
  const tradeStatsEl = document.getElementById('tradeStats');
  try {
    const data = await fetchJSON('/status/server');
    let sdiffHtml = '';
    let tokensHtml = '';
    let gasHtml = '';
    let combinedHtml = '';
    const tokenRows = [];
    const gasRows = [];
    let gasTotal = 0;

    if (data.sdiff) {
      sdiffHtml = `
        <div class="server-status-grid">
          <div><strong>UP:</strong> ${data.sdiff.up}</div>
          <div><strong>Mindiff:</strong> ${data.sdiff.mindiff}</div>
          <div><strong>MaxOrderSize:</strong> ${data.sdiff.maxOrderSize}</div>
        </div>
      `;
      if (data.sdiff.tokens) {
        for (const token of data.sdiff.tokens) {
          const buyColor = getGradientColor(token.buy);
          const sellColor = getGradientColor(token.sell);
          tokenRows.push(`<strong><a href="/token-analysis.html?token=${token.name}">${token.name}</a>:</strong> buy=<span style="color:${buyColor}">${token.buy}</span>, sell=<span style="color:${sellColor}">${token.sell}</span>`);
        }
      }
    }

    if (data.blacklist) {
      for (const item of data.blacklist) {
        const g = Number(item.gas);
        let cls = '';
        if (Number.isFinite(g)) {
          if (g < 1) cls = 'text-neg';
          else if (g < 2) cls = 'text-warn';
          gasTotal += g;
        }
        const short = String(item.contract || '').slice(-8);
        gasRows.push(`<span class="${cls}"><strong>${short}:</strong> ${item.gas}</span>`);
      }
    }

    // Build combined two-column table: Tokens | Gas Balance
    const maxRows = Math.max(tokenRows.length, gasRows.length);
    if (maxRows > 0) {
      combinedHtml += '<div class="table-wrap"><table><thead><tr><th>Tokens</th><th>Gas Balance</th></tr></thead><tbody>';
      for (let i = 0; i < maxRows; i++) {
        const left = tokenRows[i] || '';
        const right = gasRows[i] || '';
        combinedHtml += `<tr><td>${left}</td><td>${right}</td></tr>`;
      }
      // Intentionally omit our own total row to avoid duplicate totals
      combinedHtml += '</tbody></table></div>';
    }

    sdiffStatusEl.innerHTML = sdiffHtml;
    tokensContainerEl.innerHTML = combinedHtml || '<div class="muted">No token/gas data</div>';
    gasBalanceContainerEl.innerHTML = '';

    const formatProfit = (value) => {
        const className = value > 0 ? 'text-pos' : value < 0 ? 'text-neg' : '';
        return `<span class="${className}">${fmtNum(value, 2)}</span>`;
    };

    // Render Profit and Trades side-by-side in a single table for parallel comparison
    if (data.profit && data.trades) {
      const periods = [
        { label: 'Last 1h', p: data.profit.last1h, t: data.trades.last1h },
        { label: 'Last 4h', p: data.profit.last4h, t: data.trades.last4h },
        { label: 'Last 8h', p: data.profit.last8h, t: data.trades.last8h },
        { label: 'Last 12h', p: data.profit.last12h, t: data.trades.last12h },
        { label: 'Last 24h', p: data.profit.last24h, t: data.trades.last24h },
      ];
      let html = '<h4>Profit (USD) and Number of Trades</h4>';
      html += '<div class="table-wrap"><table><thead><tr>'+
              '<th>Period</th><th>Profit (USD)</th><th>Number of Trades</th>'+
              '</tr></thead><tbody>';
      for (const row of periods) {
        html += `<tr><td>${row.label}</td><td>${formatProfit(row.p)}</td><td>${row.t}</td></tr>`;
      }
      html += '</tbody></table></div>';
      profitStatsEl.innerHTML = html;
      tradeStatsEl.innerHTML = '';
    } else {
      // Fallback to previous separate blocks if only one is available
      if (data.profit) {
        let profitHtml = '<h4>Profit (USD)</h4>';
        profitHtml += '<div class="profit-grid">';
        profitHtml += `<div><strong>Last 1h:</strong> ${formatProfit(data.profit.last1h)}</div>`;
        profitHtml += `<div><strong>Last 4h:</strong> ${formatProfit(data.profit.last4h)}</div>`;
        profitHtml += `<div><strong>Last 8h:</strong> ${formatProfit(data.profit.last8h)}</div>`;
        profitHtml += `<div><strong>Last 12h:</strong> ${formatProfit(data.profit.last12h)}</div>`;
        profitHtml += `<div><strong>Last 24h:</strong> ${formatProfit(data.profit.last24h)}</div>`;
        profitHtml += '</div>';
        profitStatsEl.innerHTML = profitHtml;
      }
      if (data.trades) {
        let tradesHtml = '<h4>Number of Trades</h4>';
        tradesHtml += '<div class="trades-grid">';
        tradesHtml += `<div><strong>Last 1h:</strong> ${data.trades.last1h}</div>`;
        tradesHtml += `<div><strong>Last 4h:</strong> ${data.trades.last4h}</div>`;
        tradesHtml += `<div><strong>Last 8h:</strong> ${data.trades.last8h}</div>`;
        tradesHtml += `<div><strong>Last 12h:</strong> ${data.trades.last12h}</div>`;
        tradesHtml += `<div><strong>Last 24h:</strong> ${data.trades.last24h}</div>`;
        tradesHtml += '</div>';
        tradeStatsEl.innerHTML = tradesHtml;
      }
    }

  } catch (err) {
    // ...
  }
}

refreshBtn.addEventListener('click', refreshAll);

// Initial load and auto-refresh every 2 minutes
refreshAll();
setInterval(refreshAll, 120000);

async function loadExchangeBalances() {
  // Fetch processed per-exchange balances from backend
  const data = await fetchJSON('/balances/exchanges');
  const dexPrices = new Map();

  // DEX table
  dexTableBody.innerHTML = '';
  let dexTotal = 0; // make available for combined summary
  if (Array.isArray(data.dex) && data.dex.length) {
    for (const ex of data.dex) {
      dexTotal += ex.totalUSDT || 0;
      for (const t of ex.tokens || []) {
        const tr = document.createElement('tr');
        const currentPrice = (t.totalUsdt && t.total) ? t.totalUsdt / t.total : 0;
        if (t.currency) {
          const tokenName = t.currency.split('_')[1];
          if (tokenName) dexPrices.set(tokenName.toLowerCase(), currentPrice);
        }
        tr.innerHTML = `
          <td>${ex.exchange}</td>
          <td>${t.currency}</td>
          <td>${fmtNum(t.total)}</td>
          <td>${fmtNum(t.totalUsdt)}</td>
          <td>${fmtNum(currentPrice)}</td>
        `;
        dexTableBody.appendChild(tr);
      }
    }
    dexSummary.textContent = `Total DEX USDT: ${fmtNum(dexTotal)}`;
  } else {
    dexSummary.textContent = 'No DEX data available';
  }
  enableTableFeatures('#dexBalancesTable', 'dexSearch');

  // CEX table (BinanceF)
  console.log(data.cex.tokens);
  cexTableBody.innerHTML = '';
  if (data.cex && Array.isArray(data.cex.tokens)) {
    for (const t of data.cex.tokens) {
      const tr = document.createElement('tr');
      const tokenName = t.currency.split('/')[0].toLowerCase();
      const currentPrice = dexPrices.get(tokenName);

      let totalUsdt = t.totalUsdt;
      let usdtValue = t.usdtValue;
      let unrealizedProfit = t.unrealizedProfit;

      if (currentPrice && t.currency.toLowerCase() !== 'usdt' && t.available) {
        totalUsdt = currentPrice * t.available;
        usdtValue = totalUsdt / t.leverage;
        unrealizedProfit = totalUsdt - (t.available * t.entryPrice);
      }

      tr.innerHTML = `
        <td>${t.currency}</td>
        <td>${fmtNum(t.total)}</td>
        <td>${fmtNum(usdtValue)}</td>
        <td>${fmtNum(totalUsdt)}</td>
        <td>${t.entryPrice ? fmtNum(t.entryPrice) : ''}</td>
        <td>${unrealizedProfit ? fmtNum(unrealizedProfit) : '0'}</td>
      `;
      cexTableBody.appendChild(tr);
    }
    cexSummary.textContent = `BinanceF Total USDT: ${fmtNum(data.cex.totalUSDT)}  |  USDT: ${fmtNum(data.cex.usdtTotal)}  |  Sum PnL: ${fmtNum(data.cex.unrealizedSum)}`;
  } else {
    cexSummary.textContent = 'No BinanceF data available';
  }
  enableTableFeatures('#cexBalancesTable', 'cexSearch');

  // Combined total above the chart
  const totalEl = document.getElementById('totalBalanceSummary');
  const dexTotalText = `Total DEX USDT: ${fmtNum(dexTotal)}`;
  const cexTotal = data.cex ? data.cex.totalUSDT || 0 : 0;
  const combined = dexTotal + cexTotal;
  totalEl.textContent = `Total USDT (DEX + BinanceF): ${fmtNum(combined)}  |  BinanceF Total USDT: ${fmtNum(cexTotal)}  |  ${dexTotalText}`;
  enableTableFeatures('#tradesTable', 'tradesSearch');

  const comparisonTableBody = document.querySelector('#comparisonTable tbody');
  comparisonTableBody.innerHTML = '';

  // Create maps for easy lookup
  const dexTokensForComparison = new Map();
  if (Array.isArray(data.dex) && data.dex.length) {
    for (const ex of data.dex) {
      for (const t of ex.tokens) {
        const tokenName = t.currency.split('_')[1]?.toLowerCase();
        if (tokenName) {
          dexTokensForComparison.set(tokenName, t);
        }
      }
    }
  }

  const cexTokensForComparison = new Map();
  if (data.cex && Array.isArray(data.cex.tokens)) {
    for (const t of data.cex.tokens) {
      const tokenName = t.currency.split('/')[0].toLowerCase();
      const currentPrice = dexPrices.get(tokenName);
      let totalUsdt = t.totalUsdt;
      if (currentPrice && t.currency.toLowerCase() !== 'usdt' && t.available) {
        totalUsdt = currentPrice * t.available;
      }
      cexTokensForComparison.set(tokenName, { ...t, totalUsdt });
    }
  }

  // Build comparison table
  for (const [tokenName, dexToken] of dexTokensForComparison.entries()) {
    if (cexTokensForComparison.has(tokenName)) {
      const cexToken = cexTokensForComparison.get(tokenName);
      const difference = dexToken.totalUsdt - cexToken.totalUsdt;
      const diffClass = difference > 0 ? 'text-pos' : difference < 0 ? 'text-neg' : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
            <td>${tokenName}</td>
            <td>${fmtNum(dexToken.totalUsdt)}</td>
            <td>${fmtNum(cexToken.totalUsdt)}</td>
            <td class="${diffClass}">${fmtNum(difference)}</td>
        `;
      comparisonTableBody.appendChild(tr);
    }
  }
}

// Reset zoom button
document.getElementById('resetZoomBtn').addEventListener('click', () => {
  if (chart) {
    userZoomed = false;
    try { chart.resetZoom(); } catch {}
    // Re-apply current bounds based on latest data
    // Reset allBalanceData and fetch initial set
    allBalanceData = [];
    loadBalancesHistory();
  }
});

async function loadTrades() {
  try {
    const limit = tradesLimitEl ? parseInt(tradesLimitEl.value, 10) : 100;
    const rows = await fetchJSON(`/trades?limit=${limit}`);
    console.log('Fetched trades:', rows.length);
    tradesTableBody.innerHTML = '';
    
    if (rows.length === 0) {
      tradesTableBody.innerHTML = '<tr><td colspan="12">No trades data available</td></tr>';
      return;
    }
    
    for (const t of rows) {
      const tr = document.createElement('tr');
      try {
        const rawData = JSON.parse(t.raw_data);
        const combinedProps = { ...JSON.parse(t.props), ...JSON.parse(rawData.props) };
        const props = normalizePropsFront(combinedProps);

        let token = '';
        if (combinedProps) {
          for (const key in combinedProps) {
            if (combinedProps[key] === 'BUY' || combinedProps[key] === 'SELL') {
              const parts = key.split('_');
              if (parts.length > 1) {
                token = parts[1];
                break; // Found it
              }
            }
          }
        }

        const qty = (() => {
          const p = Number(t.executedSrcPrice);
          const q = Number(t.executedQtySrc);
          if (isFinite(p) && isFinite(q)) return p * q;
          return null;
        })();
        const netProfit = (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
        const netProfitStyle = isFinite(netProfit) ? getNetProfitColor(netProfit) : '';
        
        const egp = Number(t.executedGrossProfit);
        const egpClass = isFinite(egp) ? (egp > 0 ? 'text-pos' : egp < 0 ? 'text-neg' : '') : '';
        const dexSlipNum = Number(props.DexSlip);
        const cexSlipNum = Number(props.CexSlip);
        const dexSlipClass = isFinite(dexSlipNum) ? (dexSlipNum > 0 ? 'text-neg' : dexSlipNum < 0 ? 'text-pos' : '') : '';
        const cexSlipClass = isFinite(cexSlipNum) ? (cexSlipNum > 0 ? 'text-neg' : cexSlipNum < 0 ? 'text-pos' : '') : '';
        tr.innerHTML = `
          <td>${t.pair ?? ''}</td>
          <td><a href="/token-analysis.html?token=${token}">${token}</a></td>
          <td class="${egpClass}">${fmtNum(t.executedGrossProfit)}</td>
          <td style="${netProfitStyle}">${fmtNum(netProfit)}</td>
          <td>${qty != null ? fmtNum(qty) : ''}</td>
          <td>${t.lastUpdateTime ? fmtTime(t.lastUpdateTime) : ''}</td>
          <td>${props.Dex}</td>
          <td>${props.Diff ?? ''}</td>
          <td class="${dexSlipClass}">${props.DexSlip ?? ''}</td>
          <td class="${cexSlipClass}">${props.CexSlip ?? ''}</td>
          <td>${props.Exec ?? ''}</td>
          <td><button class="btn-delete" data-trade-id="${t.id}">🗑️</button></td>
        `;
      } catch (rowError) {
        console.error('Error processing trade row:', rowError, t);
        tr.innerHTML = `<td colspan="12">Error processing trade data</td>`;
      }
      tradesTableBody.appendChild(tr);
    }
  } catch (error) {
    console.error('Error loading trades:', error);
    tradesTableBody.innerHTML = '<tr><td colspan="12">Error loading trades data: ' + error.message + '</td></tr>';
  }
}

async function deleteTrade(tradeId) {
  if (!confirm('Are you sure you want to delete this trade?')) return;

  try {
    const response = await fetch(`/trades/${tradeId}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    console.log('Trade deleted successfully');
    loadTrades(); // Refresh the table
  } catch (error) {
    console.error('Error deleting trade:', error);
    alert('Failed to delete trade. See console for details.');
  }
}

tradesTableBody.addEventListener('click', (event) => {
  if (event.target.classList.contains('btn-delete')) {
    const tradeId = event.target.dataset.tradeId;
    deleteTrade(tradeId);
  }
});

function exportToExcel() {
  const table = document.getElementById('tradesTable');
  const rows = table.querySelectorAll('tr');
  let csvContent = "data:text/csv;charset=utf-8,";

  const header = Array.from(rows[0].querySelectorAll('th')).map(th => th.innerText).join(',');
  csvContent += header + "\r\n";

  for (let i = 1; i < rows.length; i++) {
    if (rows[i].style.display === 'none') continue;
    const row = [], cols = rows[i].querySelectorAll('td');
    for (let j = 0; j < cols.length - 1; j++) { // -1 to exclude the delete button column
        row.push(`"${cols[j].innerText}"`);
    }
    csvContent += row.join(',') + "\r\n";
  }

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', 'completed_trades.csv');
  document.body.appendChild(link); 
  link.click();
  document.body.removeChild(link);
}

document.getElementById('exportTradesBtn').addEventListener('click', exportToExcel);

tradesLimitEl.addEventListener('change', loadTrades);

