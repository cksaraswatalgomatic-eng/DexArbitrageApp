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

document.addEventListener('DOMContentLoaded', () => {
  const tokenSelectEl = document.getElementById('tokenSelect');
  const diffTableBody = document.querySelector('#diffTable tbody');
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const formatUtc = (value) => {
    if (value == null) return '--';
    let date = null;
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'number' && Math.abs(value) > 1e10) {
      date = new Date(value);
    } else if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && Math.abs(numeric) > 1e10) {
        date = new Date(numeric);
      } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        date = new Date(value);
      } else {
        return value;
      }
    } else {
      return String(value);
    }
    if (Number.isNaN(date.getTime())) return String(value);
    const iso = date.toISOString();
    return iso.replace('T', ' ').replace('Z', ' UTC');
  };

  let diffChart;
  let currentOffset = 0;
  const limit = 5000;
  let allDiffData = [];

  function formatValue(value, decimals) {
    if (value === null || value === undefined) return '--';
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    if (typeof decimals === 'number') {
      return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    return num.toLocaleString();
  }

  function propsHasCurId(raw, curId) {
    if (!curId) return false;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      if (!parsed || typeof parsed !== 'object') return false;
      return Object.prototype.hasOwnProperty.call(parsed, curId);
    } catch {
      return false;
    }
  }

  function normalizePropsFront(raw) {
    try {
      const p = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      const out = {};

      if (p.Dex != null) out.Dex = String(p.Dex);
      if (p.Diff != null) out.Diff = Number(p.Diff);
      if (p.DexSlip != null) out.DexSlip = Number(p.DexSlip);
      if (p.CexSlip != null) out.CexSlip = Number(p.CexSlip);
      if (p.Exec != null) out.Exec = String(p.Exec);

      return out;
    } catch { return {}; }
  }

  async function fetchJSON(url) {
    const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
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
          callbacks: {
            title: function(contexts) {
              if (!contexts || !contexts.length) return '';
              const ctx = contexts[0];
              const raw = ctx.raw ?? {};
              const parsed = ctx.parsed ?? {};
              const value = parsed.x ?? raw.x ?? raw.ts ?? ctx.label ?? null;
              return value != null ? formatUtc(value) : '';
            },
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.dataset.label === 'Trades (Net Profit)') {
                const trade = context.raw;
                const dex = trade.dex || 'N/A';
                label += `Net Profit: ${trade.y.toFixed(2)} (Dex: ${dex})`;
              } else {
                label += context.formattedValue;
              }
              return label;
            }
          }
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
          type: 'time',
          adapters: { date: { zone: 'utc' } },
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y: {
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y2: {
          type: 'linear',
          position: 'right',
          ticks: { color: '#FFD700' },
          grid: { drawOnChartArea: false },
          title: {
            display: true,
            text: 'Net Profit',
            color: '#FFD700'
          }
        },
        y3: {
            type: 'linear',
            position: 'right',
            ticks: { color: '#00FF00' },
            grid: { drawOnChartArea: false },
            title: {
                display: true,
                text: 'CEX Volume',
                color: '#00FF00'
            }
        }
      }
    };
  }

  async function loadTokens() {
    try {
      const tokens = await fetchJSON('/diffdata/tokens');
      tokenSelectEl.innerHTML = '<option value="">-- Select a Token --</option>';
      for (const token of tokens) {
        const opt = document.createElement('option');
        opt.value = token;
        opt.textContent = token;
        tokenSelectEl.appendChild(opt);
      }
    } catch (err) {
      console.error('Error loading tokens:', err);
    }
  }

  function renderDiffTable(diffData) {
    diffTableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const d of diffData) {
        const tr = document.createElement('tr');
        const parts = typeof d.curId === 'string' ? d.curId.split('_').filter(Boolean) : [];
        const tokenName = parts[1] || parts[0] || d.curId || '--';
        const timestamp = d.ts ? formatUtc(d.ts) : '--';
        tr.innerHTML = `
            <td>${tokenName}</td>
            <td>${timestamp}</td>
            <td>${d.buyDiffBps ?? '--'}</td>
            <td>${d.sellDiffBps ?? '--'}</td>
            <td>${formatValue(d.cexVol)}</td>
            <td>${formatValue(d.dexVolume)}</td>
            <td>${formatValue(d.serverBuy, 4)}</td>
            <td>${formatValue(d.serverSell, 4)}</td>
            <td>${d.rejectReason ? d.rejectReason : '--'}</td>
        `;
        fragment.appendChild(tr);
    }
    diffTableBody.appendChild(fragment);
  }

  async function loadChart() {
    const curId = tokenSelectEl.value;
    if (!curId) return;

    const minBuyDiffBps = document.getElementById('minBuyDiffBps').value;
    const maxBuyDiffBps = document.getElementById('maxBuyDiffBps').value;
    const minSellDiffBps = document.getElementById('minSellDiffBps').value;
    const maxSellDiffBps = document.getElementById('maxSellDiffBps').value;
    const minNetProfit = document.getElementById('minNetProfit').value;
    const maxNetProfit = document.getElementById('maxNetProfit').value;

    try {
        const tokenName = curId.split('_')[1];
        const diffHistory = await fetchJSON(`/diffdata/history?curId=${curId}&limit=${limit}&offset=${currentOffset}&minBuyDiffBps=${minBuyDiffBps}&maxBuyDiffBps=${maxBuyDiffBps}&minSellDiffBps=${minSellDiffBps}&maxSellDiffBps=${maxSellDiffBps}`);

        const { diffData, serverToken } = diffHistory;

        if (currentOffset === 0) {
            allDiffData = diffData;
        } else {
            // Simply append the new data. The API returns newest first, so we maintain that order.
            allDiffData = allDiffData.concat(diffData);
        }

        // For the table, we want to show the newest data first, which is the natural order from the API.
        renderDiffTable(allDiffData);

        // For the chart, we need the data sorted chronologically (oldest first) to draw lines correctly.
        const chartDataPoints = [...allDiffData].sort((a, b) => a.ts - b.ts);

        const startTime = chartDataPoints.length > 0 ? chartDataPoints[0].ts : null;
        const endTime = chartDataPoints.length > 0 ? chartDataPoints[chartDataPoints.length - 1].ts : null;

        const tradeParams = new URLSearchParams();
        if (tokenName) tradeParams.set('token', tokenName);
        if (curId) tradeParams.set('curId', curId);
        if (startTime != null) tradeParams.set('startTime', startTime);
        if (endTime != null) tradeParams.set('endTime', endTime);
        if (minNetProfit !== '') tradeParams.set('minNetProfit', minNetProfit);
        if (maxNetProfit !== '') tradeParams.set('maxNetProfit', maxNetProfit);

        const tradesHistory = await fetchJSON(`/trades/history?${tradeParams.toString()}`);

        const filteredTrades = tradesHistory.filter(t => propsHasCurId(t.rawProps ?? t.props, curId));

        // Process trades to extract Dex and assign colors
        const processedTrades = filteredTrades.map(t => {
          const props = normalizePropsFront(t.props);
          const dex = props.Dex || 'N/A';
          let color;
          if (t.netProfit >= 0) {
            color = (dex === 'BUY') ? '#006400' : '#ADFF2F'; // Dark Green / Light Green
          } else {
            color = (dex === 'BUY') ? '#8B0000' : '#FF6347'; // Dark Red / Light Red
          }
          return { x: new Date(t.lastUpdateTime), y: t.netProfit, dex: dex, backgroundColor: color };
        });

        const labels = chartDataPoints.map(d => (d.ts ? new Date(d.ts) : null));
        const buySeries = chartDataPoints.map(d => (d.buyDiffBps != null ? d.buyDiffBps / 100 : null));
        const sellSeries = chartDataPoints.map(d => (d.sellDiffBps != null ? d.sellDiffBps / 100 : null));
        const cexSeries = chartDataPoints.map(d => (d.cexVol != null ? d.cexVol : null));
        const dexSeries = chartDataPoints.map(d => (d.dexVolume != null ? d.dexVolume : null));
        const serverBuySeries = chartDataPoints.map(d => (d.serverBuy != null ? d.serverBuy : null));
        const serverSellSeries = chartDataPoints.map(d => (d.serverSell != null ? d.serverSell : null));

        const chartData = {
            labels,
            datasets: [
                {
                    label: 'Buy Diff',
                    data: buySeries,
                    borderColor: '#00E5FF',
                    backgroundColor: 'rgba(0, 229, 255, 0.1)',
                    tension: 0.25,
                    borderWidth: 2,
                    pointRadius: 0,
                    yAxisID: 'y'
                },
                {
                    label: 'Sell Diff',
                    data: sellSeries,
                    borderColor: '#FF8C00',
                    backgroundColor: 'rgba(255, 140, 0, 0.1)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    yAxisID: 'y'
                },
                {
                    label: 'CEX Volume',
                    data: cexSeries,
                    borderColor: '#00FF00',
                    backgroundColor: 'rgba(0, 255, 0, 0.1)',
                    borderWidth: 1,
                    pointRadius: 0,
                    yAxisID: 'y3'
                }
            ]
        };

        if (dexSeries.some(v => v !== null)) {
            chartData.datasets.push({
                label: 'DEX Volume',
                data: dexSeries,
                borderColor: '#8A2BE2',
                backgroundColor: 'rgba(138, 43, 226, 0.1)',
                borderWidth: 1,
                pointRadius: 0,
                yAxisID: 'y3'
            });
        }

        if (serverBuySeries.some(v => v !== null)) {
            chartData.datasets.push({
                label: 'Server Buy',
                data: serverBuySeries,
                borderColor: '#00E5FF',
                borderDash: [5, 5],
                borderWidth: 1,
                pointRadius: 0,
                yAxisID: 'y'
            });
        } else if (serverToken && serverToken.buy != null) {
            chartData.datasets.push({
                label: 'Server Buy',
                data: allDiffData.map(() => serverToken.buy),
                borderColor: '#00E5FF',
                borderDash: [5, 5],
                borderWidth: 1,
                pointRadius: 0,
                yAxisID: 'y'
            });
        }

        if (serverSellSeries.some(v => v !== null)) {
            chartData.datasets.push({
                label: 'Server Sell',
                data: serverSellSeries,
                borderColor: '#FF00FF',
                borderDash: [5, 5],
                borderWidth: 1,
                pointRadius: 0,
                yAxisID: 'y'
            });
        } else if (serverToken && serverToken.sell != null) {
            chartData.datasets.push({
                label: 'Server Sell',
                data: allDiffData.map(() => serverToken.sell),
                borderColor: '#FF00FF',
                borderDash: [5, 5],
                borderWidth: 1,
                pointRadius: 0,
                yAxisID: 'y'
            });
        }

        if (processedTrades.length > 0) {
            chartData.datasets.push({
                label: 'Trades (Net Profit)',
                data: processedTrades,
                type: 'scatter',
                backgroundColor: processedTrades.map(t => t.backgroundColor),
                pointRadius: 5,
                pointHoverRadius: 7,
                yAxisID: 'y2'
            });
        }

        const ctx = document.getElementById('diffChart').getContext('2d');
        if (diffChart) {
            diffChart.data = chartData;
            diffChart.update();
        } else {
            diffChart = new Chart(ctx, {
                type: 'line',
                data: chartData,
                options: getChartBaseOptions()
            });
        }

        currentOffset += diffData.length;

    } catch (err) {
        console.error('Error loading chart data:', err);
    }
  }

  tokenSelectEl.addEventListener('change', () => { 
    currentOffset = 0;
    allDiffData = [];
    loadChart(); 
  });
  loadMoreBtn.addEventListener('click', () => loadChart());
  document.getElementById('applyFiltersBtn').addEventListener('click', () => { 
    currentOffset = 0;
    allDiffData = [];
    loadChart(); 
  });
  resetZoomBtn.addEventListener('click', () => {
    if (diffChart) {
      diffChart.resetZoom();
    }
  });

  document.getElementById('theme-switcher').addEventListener('click', () => {
    if (diffChart) {
        diffChart.destroy();
        loadChart();
    }
  });

  loadTokens();

  // Dropdown menu logic
  const navDropdownButton = document.getElementById('nav-dropdown-button');
  const navDropdown = document.getElementById('nav-dropdown');

  if (navDropdownButton && navDropdown) {
    navDropdownButton.addEventListener('click', (event) => {
      event.stopPropagation(); // Prevent document click from closing immediately
      navDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
      if (!navDropdown.contains(event.target) && !navDropdownButton.contains(event.target)) {
        navDropdown.classList.remove('open');
      }
    });
  }
});
