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
  // Element selectors
  const limitEl = document.getElementById('limit');
  const reloadBtn = document.getElementById('reloadBtn');
  const statusEl = document.getElementById('status');
  const winnersBody = document.querySelector('#winnersTbl tbody');
  const losersBody = document.querySelector('#losersTbl tbody');
  const tokenSelectEl = document.getElementById('tokenSelect');
  const prevDayBtn = document.getElementById('prevDayBtn');
  const nextDayBtn = document.getElementById('nextDayBtn');
  const dayDisplay = document.getElementById('dayDisplay');
  const prevWeekBtn = document.getElementById('prevWeekBtn');
  const nextWeekBtn = document.getElementById('nextWeekBtn');
  const weekDisplay = document.getElementById('weekDisplay');

  // Chart variables
  let barChart, tokenProfitChart, winnersWinRateChart, losersLossChart, netProfitDistributionChart, profitByHourChart, profitByDayChart;
  
  // State
  let currentTargetDate = new Date();

  const formatUtc = (value) => {
    if (value == null) return '';
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
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  };

  // --- Utility Functions ---
  async function fetchJSON(url) {
    const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
  }

  function fmt(n, d=2) { return Number.isFinite(n) ? Number(n).toLocaleString(undefined, { maximumFractionDigits:d }) : ''; }

  function row(html) { const tr = document.createElement('tr'); tr.innerHTML = html; return tr; }

  function toISODateString(date) {
    return date.toISOString().split('T')[0];
  }

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

  // --- Main Data Loading and Table Rendering ---
  async function load() {
    statusEl.textContent = 'Loading...';
    const limit = parseInt(limitEl.value, 10) || 1000;
    try {
      const data = await fetchJSON(`/trades/analytics/tokens?limit=${limit}`);
      console.log('Received data for token analysis:', data);
      statusEl.textContent = `Tokens: ${data.totalTokens} | Generated: ${formatUtc(data.generatedAt)}`;

      renderWinnersTable(data.topWinners);
      renderLosersTable(data.topLosers);
      populateTokenDropdown(data.tokens);
      renderMainBarChart(data.tokens);
      renderWinRateChart(data.topWinners);
      renderLosersLossChart(data.topLosers);

    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      console.error(e);
    }
  }

  function renderWinnersTable(winners) {
    winnersBody.innerHTML = '';
    for (const t of winners.slice(0,20)) {
      const profitClass = Number(t.totalNetProfit) > 0 ? 'text-pos' : Number(t.totalNetProfit) < 0 ? 'text-neg' : '';
      const cexSlipClass = t.avgCexSlip > 0 ? 'text-neg' : t.avgCexSlip < 0 ? 'text-pos' : '';
      const dexSlipClass = t.avgDexSlip > 0 ? 'text-neg' : t.avgDexSlip < 0 ? 'text-pos' : '';
      winnersBody.appendChild(row(`<td>${t.token}</td><td>${t.trades}</td><td>${fmt(t.winRate*100)}</td><td class="${profitClass}">${fmt(t.totalNetProfit)}</td><td>${fmt(t.avgNetProfit)}</td><td class="${cexSlipClass}">${fmt(t.avgCexSlip, 4)}</td><td class="${dexSlipClass}">${fmt(t.avgDexSlip, 4)}</td><td>${fmt(t.avgDiff, 4)}</td>`));
    }
    enableTableFeaturesById('winnersTbl', 'winnersSearch');
  }

  function renderLosersTable(losers) {
    losersBody.innerHTML = '';
    for (const t of losers.slice(0,20)) {
      const profitClass = Number(t.totalNetProfit) > 0 ? 'text-pos' : Number(t.totalNetProfit) < 0 ? 'text-neg' : '';
      const cexSlipClass = t.avgCexSlip > 0 ? 'text-neg' : t.avgCexSlip < 0 ? 'text-pos' : '';
      const dexSlipClass = t.avgDexSlip > 0 ? 'text-neg' : t.avgDexSlip < 0 ? 'text-pos' : '';
      losersBody.appendChild(row(`<td>${t.token}</td><td>${t.trades}</td><td>${fmt(t.winRate*100)}</td><td class="${profitClass}">${fmt(t.totalNetProfit)}</td><td>${fmt(t.avgNetProfit)}</td><td class="${cexSlipClass}">${fmt(t.avgCexSlip, 4)}</td><td class="${dexSlipClass}">${fmt(t.avgDexSlip, 4)}</td><td>${fmt(t.avgDiff, 4)}</td>`));
    }
    enableTableFeaturesById('losersTbl', 'losersSearch');
  }

  function populateTokenDropdown(tokens) {
    tokenSelectEl.innerHTML = '<option value="">-- Select a Token --</option>';
    const sortedTokens = [...tokens].sort((a,b) => a.token.localeCompare(b.token));
    for (const t of sortedTokens) {
      const opt = document.createElement('option');
      opt.value = t.token;
      opt.textContent = t.token;
      tokenSelectEl.appendChild(opt);
    }
  }

  // --- Chart Rendering Functions ---
  function getChartBaseOptions(yLabel) {
    const gridColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#30363D';
    const textColor = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#C9D1D9';
    const tooltipBg = getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || '#161B22';

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
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
              const value = parsed.x ?? raw.x ?? raw.timestamp ?? ctx.label ?? null;
              return value != null ? formatUtc(value) : '';
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
          ticks: { color: textColor },
          grid: { color: gridColor },
          adapters: { date: { zone: 'utc' } }
        },
        y: {
          ticks: { color: textColor },
          grid: { color: gridColor },
          title: {
            display: Boolean(yLabel),
            text: yLabel || '',
            color: textColor
          }
        }
      }
    };
  }

  document.getElementById('theme-switcher').addEventListener('click', () => {
    if (window.timeSeriesChart) {
        window.timeSeriesChart.destroy();
        loadTokenTimeSeries(tokenSelect.value);
    }
    if(window.hourlyChart) {
        window.hourlyChart.destroy();
        loadTimePatterns(tokenSelect.value);
    }
    if(window.dailyChart) {
        window.dailyChart.destroy();
        loadTimePatterns(tokenSelect.value);
    }
  });

  function renderMainBarChart(tokens) {
    const top20 = [...tokens].sort((a,b)=> b.totalNetProfit-a.totalNetProfit).slice(0,20);
    const labels = top20.map(t=>t.token);
    const values = top20.map(t=>t.totalNetProfit);
    const backgroundColors = values.map(val => val >= 0 ? 'rgba(57, 255, 20, 0.6)' : 'rgba(255, 0, 255, 0.6)');
    const ctx = document.getElementById('barChart').getContext('2d');
    if (!barChart) {
      barChart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: 'Total Net Profit', data: values, backgroundColor: backgroundColors }] }, options: getChartBaseOptions('Total Net Profit') });
    } else {
      barChart.data.labels = labels; barChart.data.datasets[0].data = values; barChart.data.datasets[0].backgroundColor = backgroundColors; barChart.update();
    }
  }

  function renderWinRateChart(winners) {
    const topW = winners.slice(0,20);
    const wLabels = topW.map(p=>p.token);
    const wRates = topW.map(p=> (p.winRate||0)*100);
    const winRateCtx = document.getElementById('winnersWinRate').getContext('2d');
    if (!winnersWinRateChart) {
        winnersWinRateChart = new Chart(winRateCtx, { type:'bar', data:{ labels:wLabels, datasets:[{ label:'Win %', data:wRates, backgroundColor:'rgba(0, 229, 255, 0.6)'}] }, options: getChartBaseOptions('Win Rate (%)') });
    } else { winnersWinRateChart.data.labels=wLabels; winnersWinRateChart.data.datasets[0].data=wRates; winnersWinRateChart.update(); }
  }

  function renderLosersLossChart(losers) {
    const topL = losers.slice(0,20);
    const lLabels = topL.map(p=>p.token);
    const lLosses = topL.map(p=> Math.abs(p.totalNetProfit||0));
    const losersLossCtx = document.getElementById('losersLoss').getContext('2d');
    if (!losersLossChart) {
        losersLossChart = new Chart(losersLossCtx, { type:'bar', data:{ labels:lLabels, datasets:[{ label:'Total Loss (abs)', data:lLosses, backgroundColor:'rgba(255, 0, 255, 0.6)'}] }, options: getChartBaseOptions('Total Loss (abs)') });
    } else { losersLossChart.data.labels=lLabels; losersLossChart.data.datasets[0].data=lLosses; losersLossChart.update(); }
  }

  async function loadTokenProfitChart() {
      const data = await fetchJSON('/analysis/server-tokens');
      const sortedData = data.sort((a,b) => b.totalNetProfit - a.totalNetProfit);
      const labels = sortedData.map(d => d.token);
      const profits = sortedData.map(d => d.totalNetProfit);
      const buyValues = sortedData.map(d => d.buy);
      const sellValues = sortedData.map(d => d.sell);
      const ctx = document.getElementById('tokenProfitChart').getContext('2d');
      if (tokenProfitChart) tokenProfitChart.destroy();
      const baseOptions = getChartBaseOptions();
      tokenProfitChart = new Chart(ctx, { type: 'bar', data: { labels: labels, datasets: [ { label: 'Total Net Profit', data: profits, backgroundColor: profits.map(p => p >= 0 ? 'rgba(57, 255, 20, 0.6)' : 'rgba(255, 0, 255, 0.6)'), yAxisID: 'yProfit', }, { label: 'Buy Value', data: buyValues, borderColor: '#00E5FF', type: 'line', yAxisID: 'yBuySell', tension: 0.2 }, { label: 'Sell Value', data: sellValues, borderColor: '#FF8C00', type: 'line', yAxisID: 'yBuySell', tension: 0.2 } ] }, options: { ...baseOptions, scales: { ...baseOptions.scales, yProfit: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Total Net Profit', color: baseOptions.scales.y.ticks.color }, ticks: { color: baseOptions.scales.y.ticks.color } }, yBuySell: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Buy/Sell Values', color: baseOptions.scales.y.ticks.color }, grid: { drawOnChartArea: false, }, ticks: { color: baseOptions.scales.y.ticks.color } } } } });
  }

  async function loadIndividualTokenCharts() {
      const token = tokenSelectEl.value;
      if (!token) {
          if (netProfitDistributionChart) netProfitDistributionChart.destroy();
          if (profitByHourChart) profitByHourChart.destroy();
          if (profitByDayChart) profitByDayChart.destroy();
          return;
      }
      
      const dateString = toISODateString(currentTargetDate);
      const timeSeriesData = await fetchJSON(`/analysis/token-time-series?token=${token}`);
      renderTimeSeriesChart(timeSeriesData);

      const timePatternData = await fetchJSON(`/analysis/token-time-patterns?token=${token}&targetDate=${dateString}`);
      renderProfitByHourChart(timePatternData.byHour, timePatternData.dateRange.day);
      renderProfitByDayChart(timePatternData.byDay, timePatternData.dateRange.weekStart, timePatternData.dateRange.weekEnd);
  }

  function renderTimeSeriesChart(data) {
      if (netProfitDistributionChart) netProfitDistributionChart.destroy();
      const ctx = document.getElementById('netProfitDistributionChart').getContext('2d');
      const baseOptions = getChartBaseOptions();
      netProfitDistributionChart = new Chart(ctx, { type: 'bar', data: { labels: data.map(d => new Date(d.timestamp)), datasets: [ { label: 'Net Profit', data: data.map(d => d.netProfit), backgroundColor: data.map(d => d.netProfit >= 0 ? 'rgba(57, 255, 20, 0.7)' : 'rgba(255, 0, 255, 0.7)'), yAxisID: 'yProfit', }, { label: 'Avg Buy Diff', data: data.map(d => d.avgBuy), borderColor: '#00E5FF', type: 'line', yAxisID: 'yBuySell', tension: 0.2 }, { label: 'Avg Sell Diff', data: data.map(d => d.avgSell), borderColor: '#FF8C00', type: 'line', yAxisID: 'yBuySell', tension: 0.2 } ] }, options: { ...baseOptions, scales: { ...baseOptions.scales, x: { ...baseOptions.scales.x, type: 'time' }, yProfit: { type: 'linear', position: 'left', title: { display: true, text: 'Net Profit', color: baseOptions.scales.y.ticks.color } }, yBuySell: { type: 'linear', position: 'right', title: { display: true, text: 'Buy/Sell Price', color: baseOptions.scales.y.ticks.color }, grid: { drawOnChartArea: false } } } } });
  }

  function renderProfitByHourChart(data, dateStr) {
      if (profitByHourChart) profitByHourChart.destroy();
      dayDisplay.textContent = dateStr;
      const ctx = document.getElementById('profitByHourChart').getContext('2d');
      const baseOptions = getChartBaseOptions();
      profitByHourChart = new Chart(ctx, { type: 'bar', data: { labels: data.map(d => d.hour), datasets: [ { label: 'Total Net Profit', data: data.map(d => d.netProfit), backgroundColor: data.map(d => d.netProfit >= 0 ? 'rgba(57, 255, 20, 0.6)' : 'rgba(255, 0, 255, 0.6)'), yAxisID: 'yProfit', }, { label: 'Avg CexSlip', data: data.map(d => d.avgCexSlip), borderColor: '#FF8C00', type: 'line', yAxisID: 'ySlip', tension: 0.2 }, { label: 'Avg DexSlip', data: data.map(d => d.avgDexSlip), borderColor: '#00E5FF', type: 'line', yAxisID: 'ySlip', tension: 0.2 } ] }, options: { ...baseOptions, scales: { ...baseOptions.scales, x: { ...baseOptions.scales.x, title: { display: true, text: 'Hour of Day (UTC)', color: baseOptions.scales.x.ticks.color } }, yProfit: { type: 'linear', position: 'left', title: { display: true, text: 'Net Profit', color: baseOptions.scales.y.ticks.color } }, ySlip: { type: 'linear', position: 'right', title: { display: true, text: 'Avg Slip', color: baseOptions.scales.y.ticks.color }, grid: { drawOnChartArea: false } } } } });
  }

  function renderProfitByDayChart(data, weekStart, weekEnd) {
      if (profitByDayChart) profitByDayChart.destroy();
      weekDisplay.textContent = `${weekStart} to ${weekEnd}`;
      const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const ctx = document.getElementById('profitByDayChart').getContext('2d');
      const baseOptions = getChartBaseOptions();
      profitByDayChart = new Chart(ctx, { type: 'bar', data: { labels: data.map(d => dayLabels[d.day]), datasets: [ { label: 'Total Net Profit', data: data.map(d => d.netProfit), backgroundColor: data.map(d => d.netProfit >= 0 ? 'rgba(57, 255, 20, 0.6)' : 'rgba(255, 0, 255, 0.6)'), yAxisID: 'yProfit', }, { label: 'Avg CexSlip', data: data.map(d => d.avgCexSlip), borderColor: '#FF8C00', type: 'line', yAxisID: 'ySlip', tension: 0.2 }, { label: 'Avg DexSlip', data: data.map(d => d.avgDexSlip), borderColor: '#00E5FF', type: 'line', yAxisID: 'ySlip', tension: 0.2 } ] }, options: { ...baseOptions, scales: { ...baseOptions.scales, x: { ...baseOptions.scales.x, title: { display: true, text: 'Day of Week (UTC)', color: baseOptions.scales.x.ticks.color } }, yProfit: { type: 'linear', position: 'left', title: { display: true, text: 'Net Profit', color: baseOptions.scales.y.ticks.color } }, ySlip: { type: 'linear', position: 'right', title: { display: true, text: 'Avg Slip', color: baseOptions.scales.y.ticks.color }, grid: { drawOnChartArea: false } } } } });
  }

  // --- Event Listeners ---
  reloadBtn.addEventListener('click', () => {
    load().catch(e=> statusEl.textContent = e.message);
    loadTokenProfitChart().catch(e => console.error('Error loading token profit chart:', e));
  });

  tokenSelectEl.addEventListener('change', () => {
      currentTargetDate = new Date(); // Reset to today when token changes
      loadIndividualTokenCharts();
  });

  prevDayBtn.addEventListener('click', () => {
      currentTargetDate.setUTCDate(currentTargetDate.getUTCDate() - 1);
      loadIndividualTokenCharts();
  });

  nextDayBtn.addEventListener('click', () => {
      currentTargetDate.setUTCDate(currentTargetDate.getUTCDate() + 1);
      loadIndividualTokenCharts();
  });

  prevWeekBtn.addEventListener('click', () => {
      currentTargetDate.setUTCDate(currentTargetDate.getUTCDate() - 7);
      loadIndividualTokenCharts();
  });

  nextWeekBtn.addEventListener('click', () => {
      currentTargetDate.setUTCDate(currentTargetDate.getUTCDate() + 7);
      loadIndividualTokenCharts();
  });

  // --- Initial Load ---
  load().then(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
      tokenSelectEl.value = token;
      loadIndividualTokenCharts();
    }
  });
  loadTokenProfitChart();

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
