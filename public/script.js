/* eslint-disable no-empty */
document.addEventListener('DOMContentLoaded', async () => {
    const lastUpdatedEl = document.getElementById('lastUpdated');
    const refreshBtn = document.getElementById('refreshBtn');
    const tradesTableBody = document.querySelector('#tradesTable tbody');
    const dexTableBody = document.querySelector('#dexBalancesTable tbody');
    const cexTableBody = document.querySelector('#cexBalancesTable tbody');
    const dexSummary = document.getElementById('dexSummary');
    const cexSummary = document.getElementById('cexSummary');
    const tradesLimitEl = document.getElementById('tradesLimit');
    let gasConsumptionChart = null;
    let gasConsumptionHours = 4;
    let userZoomedGas = false;


    let chart;
    let dailyProfitChart;
    let userZoomed = false;
    let allBalanceData = []; // Global array to store all fetched balance data
    const HISTORY_PAGE_SIZE = 500;
    let isLoadingBalanceHistory = false;
    let reachedEndOfHistory = false;
    const loadMoreHistoryBtn = document.getElementById('loadMoreHistoryBtn');
    const balanceMinControls = document.getElementById('balanceMinControls');
    const balanceThresholds = { combined: null, dex: null, cex: null };

    function updateLoadMoreButtonState() {
      if (!loadMoreHistoryBtn) return;
      if (isLoadingBalanceHistory) {
        loadMoreHistoryBtn.disabled = true;
        loadMoreHistoryBtn.textContent = 'Loading...';
        return;
      }
      if (reachedEndOfHistory) {
        loadMoreHistoryBtn.disabled = true;
        loadMoreHistoryBtn.textContent = 'No More Data';
        return;
      }
      if (allBalanceData.length === 0) {
        loadMoreHistoryBtn.disabled = true;
        loadMoreHistoryBtn.textContent = 'Load More';
        return;
      }
      loadMoreHistoryBtn.disabled = false;
      loadMoreHistoryBtn.textContent = 'Load More';
    }

    if (typeof window.waitForChart === 'function') {
      try {
        await window.waitForChart();
      } catch (err) {
        console.error('Failed to load chart dependencies:', err);
      }
    }

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

    updateLoadMoreButtonState();

    const parseThresholdValue = (value) => {
      const num = parseFloat(value);
      return Number.isFinite(num) && num >= 0 ? num : null;
    };

    if (balanceMinControls) {
      const thresholdInputs = Array.from(balanceMinControls.querySelectorAll('input[data-dataset]'));
      thresholdInputs.forEach(input => {
        const key = input.dataset.dataset;
        if (!key) return;
        balanceThresholds[key] = parseThresholdValue(input.value);
        input.addEventListener('input', () => {
          balanceThresholds[key] = parseThresholdValue(input.value);
          updateBalanceChart();
        });
      });
    }

    function updateBalanceChart() {
      const canvas = document.getElementById('balancesChart');
      if (!canvas) return;

      const basePoints = allBalanceData
        .filter(d => d.total_usdt !== 0)
        .map(d => ({
          timestamp: d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp),
          combined: Number(d.total_usdt) || 0,
          dex: Number(d.total_dex_usdt) || 0,
          cex: Number(d.total_cex_usdt) || 0,
        }));

      const combinedPoints = basePoints.map(d => ({ x: d.timestamp, y: d.combined }));
      const dexPoints = basePoints.map(d => ({ x: d.timestamp, y: d.dex }));
      const cexPoints = basePoints.map(d => ({ x: d.timestamp, y: d.cex }));

      const combinedFiltered = combinedPoints.filter(p => {
        const threshold = balanceThresholds.combined;
        return Number.isFinite(p.y) && (threshold == null || p.y >= threshold);
      });
      const dexFiltered = dexPoints.filter(p => {
        const threshold = balanceThresholds.dex;
        return Number.isFinite(p.y) && (threshold == null || p.y >= threshold);
      });
      const cexFiltered = cexPoints.filter(p => {
        const threshold = balanceThresholds.cex;
        return Number.isFinite(p.y) && (threshold == null || p.y >= threshold);
      });

      const filteredTimes = [...combinedFiltered, ...dexFiltered, ...cexFiltered]
        .map(p => (p.x instanceof Date ? p.x.getTime() : new Date(p.x).getTime()))
        .filter(Number.isFinite);

      if (filteredTimes.length === 0) {
        if (chart) {
          chart.data.datasets.forEach(ds => { ds.data = []; });
          chart.update();
        }
        return;
      }

      let minTime = Math.min(...filteredTimes);
      let maxTime = Math.max(...filteredTimes);
      if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
        minTime = Date.now() - 60 * 60 * 1000;
        maxTime = Date.now();
      }
      if (minTime === maxTime) {
        const pad = 10 * 60 * 1000;
        minTime -= pad;
        maxTime += pad;
      }
      const xBounds = { min: new Date(minTime), max: new Date(maxTime) };

      const allTimes = allBalanceData
        .map(p => (p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime()))
        .filter(Number.isFinite);
      const limitMin = allTimes.length ? Math.min(...allTimes) : minTime;
      const limitMax = allTimes.length ? Math.max(...allTimes) : maxTime;
      const zoomLimits = { min: new Date(limitMin), max: new Date(limitMax) };

      if (!chart) {
        const ctx = canvas.getContext('2d');
        const baseOptions = getChartBaseOptions();
        const textColor = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#C9D1D9';

        chart = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              {
                datasetKey: 'combined',
                label: 'Total USDT (DEX + BinanceF)',
                data: combinedFiltered,
                borderColor: '#39FF14',
                backgroundColor: 'rgba(57, 255, 20, 0.1)',
                tension: 0.25,
                borderWidth: 2,
                pointRadius: 0,
                parsing: false
              },
              {
                datasetKey: 'dex',
                label: 'Total DEX',
                data: dexFiltered,
                borderColor: '#00E5FF',
                backgroundColor: 'rgba(0, 229, 255, 0.1)',
                borderWidth: 1.5,
                pointRadius: 0,
                parsing: false
              },
              {
                datasetKey: 'cex',
                label: 'BinanceF total',
                data: cexFiltered,
                borderColor: '#FF8C00',
                backgroundColor: 'rgba(255, 140, 0, 0.1)',
                borderWidth: 1.5,
                pointRadius: 0,
                parsing: false,
                yAxisID: 'y1'
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
                  displayFormats: {
                    minute: 'HH:mm',
                    hour: 'HH:mm',
                    day: 'MMM d, yyyy',
                  }
                },
                min: xBounds.min,
                max: xBounds.max,
              },
              y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: {
                  drawOnChartArea: false, // only draw grid lines for the first Y axis
                },
                ticks: { color: textColor },
              }
            },
            plugins: {
              ...baseOptions.plugins,
              zoom: {
                ...baseOptions.plugins.zoom,
                limits: { x: { min: zoomLimits.min, max: zoomLimits.max } },
                onZoomComplete: ({ chart: zoomChart }) => {
                  userZoomed = true;
                  const historyOldest = allBalanceData[0];
                  if (!reachedEndOfHistory && historyOldest) {
                    const { min } = zoomChart.scales.x;
                    if (min < historyOldest.timestamp.getTime()) {
                      // loadBalancesHistory(historyOldest.timestamp.toISOString());
                    }
                  }
                },
                onPanComplete: ({ chart: panChart }) => {
                  userZoomed = true;
                  const historyOldest = allBalanceData[0];
                  if (!reachedEndOfHistory && historyOldest) {
                    const { min } = panChart.scales.x;
                    if (min < historyOldest.timestamp.getTime()) {
                      // loadBalancesHistory(historyOldest.timestamp.toISOString());
                    }
                  }
                }
              }
            }
          }
        });
      } else {
        const combinedDataset = chart.data.datasets.find(ds => ds.datasetKey === 'combined');
        const dexDataset = chart.data.datasets.find(ds => ds.datasetKey === 'dex');
        const cexDataset = chart.data.datasets.find(ds => ds.datasetKey === 'cex');
        if (combinedDataset) combinedDataset.data = combinedFiltered;
        if (dexDataset) dexDataset.data = dexFiltered;
        if (cexDataset) cexDataset.data = cexFiltered;
        if (!userZoomed) {
          chart.options.scales.x.min = xBounds.min;
          chart.options.scales.x.max = xBounds.max;
        }
        if (chart.options?.plugins?.zoom?.limits?.x) {
          chart.options.plugins.zoom.limits.x.min = zoomLimits.min;
          chart.options.plugins.zoom.limits.x.max = zoomLimits.max;
        }
        chart.update();
      }
    }

    function safeJsonParse(value, fallback = {}) {
      if (value == null) return fallback;
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }

    function extractTokenFromProps(props) {
      if (!props || typeof props !== 'object') return '';
      for (const [key, val] of Object.entries(props)) {
        if (typeof val === 'string' && (val === 'BUY' || val === 'SELL')) {
          return key;
        }
      }
      return '';
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
          if (k === 'LHdelta' || k === 'LHDelta') {
            out.LHdelta = Number(v);
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
            if(tbody){
                Array.from(tbody.rows).forEach(r => {
                  r.style.display = r.innerText.toLowerCase().includes(q) ? '' : 'none';
                });
            }
          });
          input.dataset.enhanced = '1';
        }
      }
    }

    function fmtTime(ts) {
      if (ts == null) return '';
      const date = new Date(ts);
      if (Number.isNaN(date.getTime())) return String(ts);
      const iso = date.toISOString();
      return iso.replace('T', ' ').replace('Z', ' UTC');
    }

    function fmtNum(n, precision = 6) {
      if (n == null || !isFinite(n)) return 'N/A';
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
            callbacks: {
              title: function(contexts) {
                if (!contexts || !contexts.length) return '';
                const ctx = contexts[0];
                const raw = ctx.raw ?? {};
                const parsed = ctx.parsed ?? {};
                const value = parsed.x ?? raw.x ?? raw.timestamp ?? ctx.label ?? null;
                return value != null ? fmtTime(value) : '';
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
            grid: { color: gridColor }
          },
          y: {
            ticks: { color: textColor },
            grid: { color: gridColor }
          }
        }
      };
    }

    if (document.getElementById('balancesChart')) {
        if(document.getElementById('theme-switcher')){
            document.getElementById('theme-switcher').addEventListener('click', () => {
                if (chart) {
                    chart.destroy();
                    chart = null;
                    userZoomed = false;
                    allBalanceData = [];
                    reachedEndOfHistory = false;
                    isLoadingBalanceHistory = false;
                    updateLoadMoreButtonState();
                    loadBalancesHistory();
                }
                if (dailyProfitChart) {
                    dailyProfitChart.destroy();
                    dailyProfitChart = null;
                    renderDailyProfitChart();
                }
            });
        }

        async function loadBalancesHistory(beforeTimestamp = null) {
          if (isLoadingBalanceHistory) {
            return;
          }
          if (beforeTimestamp && reachedEndOfHistory) {
            return;
          }

          if (!beforeTimestamp && allBalanceData.length === 0) {
            reachedEndOfHistory = false;
          }

          isLoadingBalanceHistory = true;
          updateLoadMoreButtonState();
          try {
            let url = `/balances/history?limit=${HISTORY_PAGE_SIZE}`;
            if (beforeTimestamp) {
              url += `&before_timestamp=${encodeURIComponent(beforeTimestamp)}`;
            }
            const payload = await fetchJSON(url);

            if (!Array.isArray(payload) || payload.length === 0) {
              if (beforeTimestamp) {
                reachedEndOfHistory = true;
              }
              return;
            }

            if (payload.length < HISTORY_PAGE_SIZE) {
              reachedEndOfHistory = true;
            }

            const normalizedNewData = payload
              .filter(d => {
                if (!d?.timestamp) return false;
                const timestamp = new Date(d.timestamp);
                return !Number.isNaN(timestamp.getTime());
              })
              .map(d => ({
                ...d,
                timestamp: new Date(d.timestamp),
              }));

            if (normalizedNewData.length === 0 && allBalanceData.length === 0) {
              console.warn('No valid timestamps in fetched balance history.');
              return;
            }

            const mergedByTimestamp = new Map(allBalanceData.map(entry => [entry.timestamp.getTime(), entry]));
            for (const entry of normalizedNewData) {
              mergedByTimestamp.set(entry.timestamp.getTime(), entry);
            }

            allBalanceData = Array.from(mergedByTimestamp.values())
              .filter(entry => entry.timestamp instanceof Date && Number.isFinite(entry.timestamp.getTime()))
              .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

            updateBalanceChart();
          } catch (err) {
            console.error('Error loading balances history', err);
          } finally {
            isLoadingBalanceHistory = false;
            updateLoadMoreButtonState();
          }
        }

        if (loadMoreHistoryBtn) {
          loadMoreHistoryBtn.addEventListener('click', () => {
            if (isLoadingBalanceHistory || reachedEndOfHistory) return;
            const oldest = allBalanceData[0]?.timestamp;
            loadBalancesHistory(oldest ? oldest.toISOString() : null);
          });
        }

        async function fetchDailyProfit(days = 7, endDate = new Date()) {
            const end = new Date(endDate);
            const start = new Date(end);
            start.setDate(start.getDate() - days);

            const url = `/trades/daily-profit?start=${start.toISOString()}&end=${end.toISOString()}`;
            return await fetchJSON(url);
        }

        async function renderDailyProfitChart(days = 7, endDate = new Date()) {
            const data = await fetchDailyProfit(days, endDate);

            const labels = data.map(d => d.date);
            const profitData = data.map(d => d.profit);

            const canvasElement = document.getElementById('dailyProfitChart');
            if (!canvasElement) {
                // If canvas element doesn't exist, skip rendering
                return;
            }

            // Create arrays for colors based on profit values
            const backgroundColors = profitData.map(profit => 
                profit < 0 ? 'rgba(255, 0, 255, 0.5)' : 'rgba(57, 255, 20, 0.5)' // Red for negative, Green for positive
            );
            const borderColors = profitData.map(profit => 
                profit < 0 ? '#FF00FF' : '#39FF14' // Red for negative, Green for positive
            );

            if (!dailyProfitChart) {
                const ctx = canvasElement.getContext('2d');
                const baseOptions = getChartBaseOptions();

                dailyProfitChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Daily Profit',
                            data: profitData,
                            backgroundColor: backgroundColors,
                            borderColor: borderColors,
                            borderWidth: 1
                        }]
                    },
                    options: {
                        ...baseOptions,
                        scales: {
                            ...baseOptions.scales,
                            x: {
                                ...baseOptions.scales.x,
                                type: 'time',
                                time: {
                                    unit: 'day',
                                    tooltipFormat: 'PP'
                                }
                            }
                        }
                    }
                });
            } else {
                dailyProfitChart.data.labels = labels;
                dailyProfitChart.data.datasets[0].data = profitData;
                dailyProfitChart.data.datasets[0].backgroundColor = backgroundColors;
                dailyProfitChart.data.datasets[0].borderColor = borderColors;
                dailyProfitChart.update();
            }
        }

        let currentEndDate = new Date();

        if(document.getElementById('prevWeekBtn')){
            document.getElementById('prevWeekBtn').addEventListener('click', () => {
                currentEndDate.setDate(currentEndDate.getDate() - 7);
                renderDailyProfitChart(7, currentEndDate);
            });
        }

        if(document.getElementById('nextWeekBtn')){
            document.getElementById('nextWeekBtn').addEventListener('click', () => {
                currentEndDate.setDate(currentEndDate.getDate() + 7);
                renderDailyProfitChart(7, currentEndDate);
            });
        }

        async function refreshAll() {
          try {
            console.log('Refreshing all data...');
            // When refreshing all, reset allBalanceData and fetch initial set
            allBalanceData = [];
            reachedEndOfHistory = false;
            isLoadingBalanceHistory = false;
            userZoomed = false;
            updateLoadMoreButtonState();
            updateBalanceChart();
            await Promise.all([loadBalancesHistory(), loadTrades(), loadExchangeBalances(), loadServerStatus(), renderDailyProfitChart()]);
            if(lastUpdatedEl) lastUpdatedEl.textContent = `Updated ${fmtTime(Date.now())}`;
            console.log('All data refreshed successfully');
          } catch (err) {
            console.error('Error in refreshAll:', err);
            if(lastUpdatedEl) lastUpdatedEl.textContent = `Error: ${err.message}`;
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

        function getActiveServerLabel() {
          const select = document.getElementById('serverSelect');
          if (!select) return '';
          const option = select.options[select.selectedIndex];
          return option ? option.textContent : (select.value || '');
        }

        function escapeHtml(value) {
          const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
          return String(value ?? '').replace(/[&<>'"']/g, (ch) => map[ch] || ch);
        }

        async function refreshGasTracking(latestTotalHint, feedback) {
          const formContainer = document.getElementById('gasTrackingFormContainer');
          if (!formContainer) return;

          let consumption = [];
          try {
            consumption = await fetchJSON(`/gas-balance/consumption?hours=${gasConsumptionHours}`);
          } catch (err) {
            console.warn('Failed to load gas consumption series:', err);
            consumption = [];
          }

          const activeServerLabel = escapeHtml(getActiveServerLabel() || 'current server');
          const latestKnownTotal = null;
          const latestTotalText = 'N/A';

          formContainer.innerHTML = `
            <h4 style="margin-bottom:0.25rem;">Gas Tracking</h4>
            <div class="muted" style="margin-bottom: 0.5rem;">Logging deposits for <strong>${activeServerLabel}</strong>.</div>
            <form id="gasDepositForm" class="gas-deposit-form">
              <div style="display:grid; gap:0.5rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.9rem;">
                  <span>Current Gas Balance</span>
                  <input id="gasDepositBalance" type="number" step="any" placeholder="Leave blank to auto-fill" />
                </label>
                <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.9rem;">
                  <span>Deposit Amount</span>
                  <input id="gasDepositAmount" type="number" step="any" min="0" required />
                </label>
                <div style="display: flex; align-items: flex-end; gap: 0.5rem;">
                  <label style="display:flex; flex-direction:column; gap:0.25rem; font-size:0.9rem; flex-grow: 1;">
                    <span>Note</span>
                    <input id="gasDepositNote" type="text" placeholder="Optional note" />
                  </label>
                  <button type="submit" class="btn btn-orange" style="white-space: nowrap;">Log Deposit</button>
                </div>
              </div>
              <div class="muted" style="margin-top:0.5rem;">Leave balance empty to use the latest tracked total.</div>
            </form>
            <div id="gasDepositFormMessage" class="muted" style="margin-top:0.5rem;" aria-live="polite"></div>
            <div class="muted" style="margin-top:0.5rem;">Latest tracked total: ${latestTotalText}</div>
          `;

          const form = formContainer.querySelector('#gasDepositForm');
          const balanceInput = formContainer.querySelector('#gasDepositBalance');
          const amountInput = formContainer.querySelector('#gasDepositAmount');
          const noteInput = formContainer.querySelector('#gasDepositNote');
          const messageEl = formContainer.querySelector('#gasDepositFormMessage');
          const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

          const setMessage = (text, state) => {
            if (!messageEl) return;
            messageEl.textContent = text;
            messageEl.classList.remove('text-pos', 'text-neg', 'muted');
            if (state === 'success') {
              messageEl.classList.add('text-pos');
            } else if (state === 'error') {
              messageEl.classList.add('text-neg');
            } else {
              messageEl.classList.add('muted');
            }
          };

          if (feedback && feedback.text) {
            setMessage(feedback.text, feedback.type);
          } else {
            setMessage('', 'info');
          }

          renderGasConsumptionChart(consumption);

          let consumptionForStats = [];
          try {
            consumptionForStats = await fetchJSON(`/gas-balance/consumption?hours=168`);
          } catch (err) {
            console.warn('Failed to load gas consumption series for stats:', err);
            consumptionForStats = [];
          }
          const stats = calculateGasConsumptionStats(consumptionForStats);
          renderGasConsumptionStats(stats);

          if (form) {
            let submitting = false;
            form.addEventListener('submit', async (ev) => {
              ev.preventDefault();
              if (submitting) return;
              if (!amountInput) return;
              const depositValue = Number(amountInput.value);
              if (!Number.isFinite(depositValue) || depositValue <= 0) {
                setMessage('Deposit amount must be greater than zero.', 'error');
                return;
              }
              submitting = true;
              if (submitBtn) submitBtn.disabled = true;
              setMessage('Saving deposit entry…', 'info');
              try {
                const payload = { contract: '__total__', amount: depositValue };
                if (balanceInput && balanceInput.value !== '') {
                  payload.gasBalance = Number(balanceInput.value);
                  if (!Number.isFinite(payload.gasBalance)) {
                    setMessage('Gas balance must be a valid number.', 'error');
                    submitting = false;
                    if (submitBtn) submitBtn.disabled = false;
                    return;
                  }
                }
                if (noteInput && noteInput.value.trim()) {
                  payload.note = noteInput.value.trim();
                }
                const created = await fetch('/gas-balance/deposit', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                }).then((resp) => {
                  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                  return resp.json();
                });
                await refreshGasTracking(created?.gas_balance ?? latestKnownTotal, { type: 'success', text: 'Deposit recorded.' });
                return;
              } catch (submitErr) {
                console.error('Failed to record gas deposit:', submitErr);
                setMessage('Failed to record deposit. Please try again.', 'error');
              } finally {
                if (submitBtn) submitBtn.disabled = false;
                submitting = false;
              }
            });
          }
        }



        function calculateGasConsumptionStats(consumptionData) {
            const now = Date.now();
            const periodConfigs = [
                { label: 'Last 1h', cutoff: now - (1 * 60 * 60 * 1000) },
                { label: 'Last 4h', cutoff: now - (4 * 60 * 60 * 1000) },
                { label: 'Last 8h', cutoff: now - (8 * 60 * 60 * 1000) },
                { label: 'Last 12h', cutoff: now - (12 * 60 * 60 * 1000) },
                { label: 'Last 24h', cutoff: now - (24 * 60 * 60 * 1000) },
                { label: 'Last 2 Days', cutoff: now - (2 * 24 * 60 * 60 * 1000) },
                { label: 'Last 7 Days', cutoff: now - (7 * 24 * 60 * 60 * 1000) },
            ];

            const stats = periodConfigs.map((cfg) => ({
                label: cfg.label,
                consumption: 0,
                deposit: 0
            }));

            for (const item of consumptionData) {
                const itemTimestamp = new Date(item.timestamp).getTime();
                for (let i = 0; i < periodConfigs.length; i += 1) {
                    if (itemTimestamp >= periodConfigs[i].cutoff) {
                        const stat = stats[i];
                        const consumptionVal = Number(item.consumption);
                        if (Number.isFinite(consumptionVal) && consumptionVal !== 0) {
                            stat.consumption += consumptionVal;
                        }
                        const depositVal = Number(item.deposit);
                        if (Number.isFinite(depositVal) && depositVal !== 0) {
                            stat.deposit += depositVal;
                        }
                    }
                }
            }
            return stats;
        }

        function renderGasConsumptionStats(stats) {
            const container = document.getElementById('gasConsumptionStatsContainer');
            if (!container) return;

            let html = '<h4>Gas Consumption</h4>';
            html += '<div class="table-wrap"><table><thead><tr>' +
                    '<th>Period</th><th>Consumption</th><th>Deposit</th>' +
                    '</tr></thead><tbody>';
            const rows = Array.isArray(stats) ? stats : [];
            for (const entry of rows) {
              const consumption = entry.consumption;
              const deposit = entry.deposit;
                html += `<tr>` +
                        `<td>${entry.label}</td>` +
                        `<td>${fmtNum(consumption, 2)}</td>` +
                        `<td>${fmtNum(deposit, 2)}</td>` +
                        `</tr>`;
            }
            html += '</tbody></table></div>';
            container.innerHTML = html;
        }

        function renderGasConsumptionChart(rows) {
          const canvas = document.getElementById('gasConsumptionChart');
          if (!canvas) return;
          const container = canvas.closest('.chart-container');
          if (container) {
            const skeleton = container.querySelector('.skeleton');
            if (skeleton) skeleton.remove();
          }

          const points = Array.isArray(rows) ? rows.map((row) => {
            const ts = new Date(row.timestamp);
            if (Number.isNaN(ts.getTime())) return null;
            return {
              x: ts,
              y: Number(row.consumption) || 0,
              latestTotal: Number(row.latestTotal)
            };
          }).filter(Boolean) : [];

          const baseOptions = getChartBaseOptions();
          const tooltipBase = baseOptions.plugins?.tooltip || {};
          const tooltipCallbacks = tooltipBase.callbacks || {};

          const options = {
            ...baseOptions,
            plugins: {
              ...baseOptions.plugins,
              legend: { display: false },
              tooltip: {
                ...tooltipBase,
                callbacks: {
                  ...tooltipCallbacks,
                  label(context) {
                    const consumptionVal = fmtNum(context.parsed.y, 2);
                    const totalVal = context.raw && Number.isFinite(Number(context.raw.latestTotal))
                      ? fmtNum(Number(context.raw.latestTotal), 2)
                      : null;
                    let label = `Consumption: ${consumptionVal}`;
                    if (totalVal) label += ` | Total: ${totalVal}`;
                    return label;
                  }
                }
              },
              zoom: {
                ...baseOptions.plugins.zoom,
                onZoomComplete: ({ chart: zoomChart }) => {
                  userZoomedGas = true;
                  const { min, max } = zoomChart.scales.x;
                  const visibleHours = (max - min) / (1000 * 60 * 60);
                  if (visibleHours > gasConsumptionHours) {
                    gasConsumptionHours = Math.ceil(visibleHours);
                    refreshGasTracking();
                  }
                },
                onPanComplete: ({ chart: panChart }) => {
                  userZoomedGas = true;
                  const { min } = panChart.scales.x;
                  const oldestTimestamp = Date.now() - gasConsumptionHours * 60 * 60 * 1000;
                  if (min < oldestTimestamp) {
                    gasConsumptionHours += 4; // Load more hours
                    refreshGasTracking();
                  }
                }
              }
            },
            scales: {
              ...baseOptions.scales,
              x: {
                ...baseOptions.scales.x,
                type: 'time',
                time: { unit: 'day', tooltipFormat: 'PPpp', displayFormats: { hour: 'HH:mm', day: 'MMM d' } },
                min: new Date(Date.now() - gasConsumptionHours * 60 * 60 * 1000),
                max: new Date()
              },
              y: {
                ...baseOptions.scales.y,
                title: { display: true, text: 'Gas consumed' },
                ticks: {
                  ...(baseOptions.scales.y?.ticks || {}),
                  callback: (value) => fmtNum(value, 2)
                }
              }
            }
          };

          const dataset = {
            label: 'Hourly Gas Consumption',
            data: points,
            parsing: false,
            backgroundColor: (ctx) => (ctx.parsed && ctx.parsed.y >= 0 ? 'rgba(255, 99, 71, 0.6)' : 'rgba(76, 175, 80, 0.6)'),
            borderColor: (ctx) => (ctx.parsed && ctx.parsed.y >= 0 ? 'rgba(255, 99, 71, 0.9)' : 'rgba(76, 175, 80, 0.9)'),
            borderWidth: 1,
            borderRadius: 4
          };

          if (!gasConsumptionChart) {
            const ctx = canvas.getContext('2d');
            gasConsumptionChart = new Chart(ctx, {
              type: 'line',
              data: { datasets: [dataset] },
              options
            });
          } else {
            gasConsumptionChart.data.datasets[0].data = points;
            if (!userZoomedGas) {
                gasConsumptionChart.options.scales.x.min = new Date(Date.now() - gasConsumptionHours * 60 * 60 * 1000);
            }
            gasConsumptionChart.update();
          }
        }

        async function loadServerStatus() {
          const sdiffStatusEl = document.getElementById('sdiffStatus');
          const tokensContainerEl = document.getElementById('tokensContainer');
          const gasBalanceContainerEl = document.getElementById('gasBalanceContainer');
          const profitStatsEl = document.getElementById('profitStats');
          const tradeStatsEl = document.getElementById('tradeStats');
          let latestTotalHint = null;
          try {
            const data = await fetchJSON('/status/server');
            let sdiffHtml = '';
            const tokenRows = [];
            const gasRows = [];
            let totalGasFromStatus = null;

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
                  tokenRows.push(`<strong><a href="/token-analysis.html?token=${token.name}">${token.name}</a>:</strong> buy=<span style="color:${buyColor}">${fmtNum(token.buy, 2)}</span>, sell=<span style="color:${sellColor}">${fmtNum(token.sell, 2)}</span>`);
                }
              }
            }

            if (data.blacklist) {
              let computedTotal = 0;
              let hasComputed = false;
              for (const item of data.blacklist) {
                const key = String(item.contract || '').trim();
                const g = Number(item.gas);
                let cls = '';
                if (Number.isFinite(g)) {
                  if (g < 1) cls = 'text-neg';
                  else if (g < 2) cls = 'text-warn';
                }
                if (key.toLowerCase() === 'total') {
                  if (Number.isFinite(g)) totalGasFromStatus = g;
                  gasRows.push(`<span class="${cls}"><strong>Total:</strong> ${item.gas}</span>`);
                  continue;
                }
                if (Number.isFinite(g)) {
                  computedTotal += g;
                  hasComputed = true;
                }
                const short = key ? key.slice(-8) : '';
                gasRows.push(`<span class="${cls}"><strong>${short}:</strong> ${item.gas}</span>`);
              }
              if (!Number.isFinite(totalGasFromStatus) && hasComputed) {
                totalGasFromStatus = computedTotal;
              }
            }

            let combinedHtml = '';
            const maxRows = Math.max(tokenRows.length, gasRows.length);
            if (maxRows > 0) {
              combinedHtml += '<div class="table-wrap"><table><thead><tr><th>Tokens</th><th>Gas Balance</th></tr></thead><tbody>';
              for (let i = 0; i < maxRows; i += 1) {
                const left = tokenRows[i] || '';
                const right = gasRows[i] || '';
                combinedHtml += `<tr><td>${left}</td><td>${right}</td></tr>`;
              }
              combinedHtml += '</tbody></table></div>';
            }
            if (Number.isFinite(totalGasFromStatus)) {
              combinedHtml += `<div class="muted" style="margin-top:0.5rem;">Total gas balance: ${fmtNum(totalGasFromStatus, 2)}</div>`;
            }

            if (sdiffStatusEl) sdiffStatusEl.innerHTML = sdiffHtml;
            if (tokensContainerEl) tokensContainerEl.innerHTML = combinedHtml || '<div class="muted">No token/gas data</div>';
            if (gasBalanceContainerEl) {
              gasBalanceContainerEl.innerHTML = '';
            }

            latestTotalHint = Number.isFinite(totalGasFromStatus) ? totalGasFromStatus : null;

            const formatProfit = (value) => {
              const className = value > 0 ? 'text-pos' : value < 0 ? 'text-neg' : '';
              return `<span class="${className}">${fmtNum(value, 2)}</span>`;
            };

            if (data.profit && data.trades) {
              const periods = [
                { label: 'Last 1h', p: data.profit.last1h, t: data.trades.last1h },
                { label: 'Last 4h', p: data.profit.last4h, t: data.trades.last4h },
                { label: 'Last 8h', p: data.profit.last8h, t: data.trades.last8h },
                { label: 'Last 12h', p: data.profit.last12h, t: data.trades.last12h },
                { label: 'Last 24h', p: data.profit.last24h, t: data.trades.last24h },
              ];
              let html = '<h4>Profit (USD) and Number of Trades</h4>';
              html += '<div class="table-wrap"><table><thead><tr>' +
                      '<th>Period</th><th>Profit (USD)</th><th>Number of Trades</th>' +
                      '</tr></thead><tbody>';
              for (const row of periods) {
                html += `<tr><td>${row.label}</td><td>${formatProfit(row.p)}</td><td>${row.t}</td></tr>`;
              }
              html += '</tbody></table></div>';
              if (profitStatsEl) profitStatsEl.innerHTML = html;
              if (tradeStatsEl) tradeStatsEl.innerHTML = '';
            } else {
              if (data.profit) {
                let profitHtml = '<h4>Profit (USD)</h4>';
                profitHtml += '<div class="profit-grid">';
                profitHtml += `<div><strong>Last 1h:</strong> ${formatProfit(data.profit.last1h)}</div>`;
                profitHtml += `<div><strong>Last 4h:</strong> ${formatProfit(data.profit.last4h)}</div>`;
                profitHtml += `<div><strong>Last 8h:</strong> ${formatProfit(data.profit.last8h)}</div>`;
                profitHtml += `<div><strong>Last 12h:</strong> ${formatProfit(data.profit.last12h)}</div>`;
                profitHtml += `<div><strong>Last 24h:</strong> ${formatProfit(data.profit.last24h)}</div>`;
                profitHtml += '</div>';
                if (profitStatsEl) profitStatsEl.innerHTML = profitHtml;
              } else if (profitStatsEl) {
                profitStatsEl.innerHTML = '';
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
                if (tradeStatsEl) tradeStatsEl.innerHTML = tradesHtml;
              } else if (tradeStatsEl) {
                tradeStatsEl.innerHTML = '';
              }
            }
          } catch (err) {
            console.error('Failed to load server status:', err);
            if (sdiffStatusEl) sdiffStatusEl.innerHTML = '<div class="muted">Failed to load server status.</div>';
            if (tokensContainerEl) tokensContainerEl.innerHTML = '<div class="muted">No token/gas data</div>';
            if (gasBalanceContainerEl) gasBalanceContainerEl.innerHTML = '<div class="muted">No gas data available.</div>';
            if (profitStatsEl) profitStatsEl.innerHTML = '';
            if (tradeStatsEl) tradeStatsEl.innerHTML = '';
          }
          await refreshGasTracking(latestTotalHint);
        }

        if(refreshBtn){
            refreshBtn.addEventListener('click', refreshAll);
        }

        // Initial load and auto-refresh every 2 minutes
        refreshAll();
        setInterval(refreshAll, 120000);

        async function loadExchangeBalances() {
          // Fetch processed per-exchange balances from backend
          const data = await fetchJSON('/balances/exchanges');
          const dexPrices = new Map();

          // DEX table
          if(dexTableBody) dexTableBody.innerHTML = '';
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
                  <td>${fmtNum(t.total, 2)}</td>
                  <td>${fmtNum(t.totalUsdt, 2)}</td>
                  <td>${fmtNum(currentPrice, 2)}</td>
                `;
                if(dexTableBody) dexTableBody.appendChild(tr);
              }
            }
            if(dexSummary) dexSummary.textContent = `Total DEX USDT: ${fmtNum(dexTotal, 2)}`;
          } else {
            if(dexSummary) dexSummary.textContent = 'No DEX data available';
          }
          enableTableFeatures('#dexBalancesTable', 'dexSearch');

          // CEX table (BinanceF)
          if(cexTableBody) cexTableBody.innerHTML = '';
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
                <td>${fmtNum(t.total, 2)}</td>
                <td>${fmtNum(usdtValue, 2)}</td>
                <td>${fmtNum(totalUsdt, 2)}</td>
                <td>${t.entryPrice ? fmtNum(t.entryPrice, 2) : ''}</td>
                <td>${unrealizedProfit ? fmtNum(unrealizedProfit, 2) : '0'}</td>
              `;
              if(cexTableBody) cexTableBody.appendChild(tr);
            }
            if(cexSummary) cexSummary.textContent = `BinanceF Total USDT: ${fmtNum(data.cex.totalUSDT, 2)}  |  USDT: ${fmtNum(data.cex.usdtTotal, 2)}  |  Sum PnL: ${fmtNum(data.cex.unrealizedSum, 2)}`;
          } else {
            if(cexSummary) cexSummary.textContent = 'No BinanceF data available';
          }
          enableTableFeatures('#cexBalancesTable', 'cexSearch');

          // Combined total above the chart
          const totalEl = document.getElementById('totalBalanceSummary');
          const dexTotalText = `Total DEX USDT: ${fmtNum(dexTotal)}`;
          const cexTotal = data.cex ? data.cex.totalUSDT || 0 : 0;
          const combined = dexTotal + cexTotal;
          if(totalEl) totalEl.textContent = `Total USDT (DEX + BinanceF): ${fmtNum(combined, 2)}  |  BinanceF Total USDT: ${fmtNum(cexTotal, 2)}  |  ${dexTotalText}`;
          enableTableFeatures('#tradesTable', 'tradesSearch');

          const comparisonTableBody = document.querySelector('#comparisonTable tbody');
          if(comparisonTableBody) comparisonTableBody.innerHTML = '';

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
                    <td>${fmtNum(dexToken.totalUsdt, 2)}</td>
                    <td>${fmtNum(cexToken.totalUsdt, 2)}</td>
                    <td class="${diffClass}">${fmtNum(difference, 2)}</td>
                `;
              if(comparisonTableBody) comparisonTableBody.appendChild(tr);
            }
          }
        }

        // Reset zoom button
        if(document.getElementById('resetZoomBtn')){
            document.getElementById('resetZoomBtn').addEventListener('click', () => {
              if (chart) {
                userZoomed = false;
                try { chart.resetZoom(); } catch {}
                // Re-apply current bounds based on latest data
                // Reset allBalanceData and fetch initial set
                allBalanceData = [];
                reachedEndOfHistory = false;
                isLoadingBalanceHistory = false;
                updateLoadMoreButtonState();
                updateBalanceChart();
                loadBalancesHistory();
              }
            });
        }

        if(document.getElementById('loadMoreGasBtn')) {
            document.getElementById('loadMoreGasBtn').addEventListener('click', () => {
                gasConsumptionHours += 24;
                refreshGasTracking();
            });
        }



        async function loadTrades() {
          try {
            const limit = tradesLimitEl ? parseInt(tradesLimitEl.value, 10) : 100;
            const rows = await fetchJSON(`/trades?limit=${limit}`);
            console.log('Fetched trades:', rows.length);
            if(tradesTableBody) tradesTableBody.innerHTML = '';
            
            if (rows.length === 0) {
              if(tradesTableBody) tradesTableBody.innerHTML = '<tr><td colspan="13">No trades data available</td></tr>';
              return;
            }
            
            for (const t of rows) {
              const tr = document.createElement('tr');
              try {
                const rawData = safeJsonParse(t.raw_data);
                const baseProps = safeJsonParse(t.props);
                const rawProps = safeJsonParse(rawData.props);
                const combinedProps = { ...rawProps, ...baseProps };
                const props = normalizePropsFront(combinedProps);

                const tokenKey = extractTokenFromProps(rawProps) || extractTokenFromProps(baseProps);
                const tokenLabel = tokenKey || '';
                const tokenLink = tokenKey ? `/token-analysis.html?token=${encodeURIComponent(tokenKey)}` : '/token-analysis.html';

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
                const lhDeltaRaw = props.LHdelta ?? props.LHDelta ?? '';
                const hasLHDelta = lhDeltaRaw !== '' && lhDeltaRaw != null;
                const lhDeltaNum = hasLHDelta ? Number(lhDeltaRaw) : null;
                const lhDeltaClass = lhDeltaNum != null && isFinite(lhDeltaNum)
                  ? (lhDeltaNum < -1 ? 'text-pos' : lhDeltaNum > 1 ? 'text-neg-soft' : '')
                  : '';
                const lhDeltaDisplay = lhDeltaNum != null && isFinite(lhDeltaNum) ? fmtNum(lhDeltaNum, 4) : '';
                const dexVal = props.Dex ?? '';
                const dexClass = dexVal === 'BUY' ? 'text-pos' : dexVal === 'SELL' ? 'text-neg' : '';
                tr.innerHTML = `
                  <td>${t.pair ?? ''}</td>
                  <td>${tokenLabel ? `<a href="${tokenLink}">${tokenLabel}</a>` : ''}</td>
                  <td class="${egpClass}">${fmtNum(t.executedGrossProfit, 2)}</td>
                  <td style="${netProfitStyle}">${fmtNum(netProfit, 2)}</td>
                  <td>${qty != null ? fmtNum(qty, 2) : ''}</td>
                  <td>${t.lastUpdateTime ? fmtTime(t.lastUpdateTime) : ''}</td>
                  <td class="${dexClass}">${dexVal}</td>
                  <td>${props.Diff ?? ''}</td>
                  <td class="${lhDeltaClass}" data-export="${lhDeltaNum != null && isFinite(lhDeltaNum) ? lhDeltaNum : ''}">${lhDeltaDisplay}</td>
                  <td class="${dexSlipClass}">${props.DexSlip ?? ''}</td>
                  <td class="${cexSlipClass}">${props.CexSlip ?? ''}</td>
                  <td>${props.Exec ?? ''}</td>
                  <td><button class="btn-delete" data-trade-id="${t.id}">🗑️</button></td>
                `;
              } catch (rowError) {
                console.error('Error processing trade row:', rowError, t);
                tr.innerHTML = `<td colspan="13">Error processing trade data</td>`;
              }
              if(tradesTableBody) tradesTableBody.appendChild(tr);
            }
          } catch (error) {
            console.error('Error loading trades:', error);
            if(tradesTableBody) tradesTableBody.innerHTML = '<tr><td colspan="13">Error loading trades data: ' + error.message + '</td></tr>';
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

        if(tradesTableBody){
            tradesTableBody.addEventListener('click', (event) => {
              if (event.target.classList.contains('btn-delete')) {
                const tradeId = event.target.dataset.tradeId;
                deleteTrade(tradeId);
              }
            });
        }

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
                const exportVal = cols[j].dataset.export ?? cols[j].innerText;
                row.push(`"${exportVal}"`);
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

        if(document.getElementById('exportTradesBtn')){
            document.getElementById('exportTradesBtn').addEventListener('click', exportToExcel);
        }

        if(tradesLimitEl){
            tradesLimitEl.addEventListener('change', loadTrades);
        }
    }
    // Tab switching logic
    const tabContainers = document.querySelectorAll('.tab-container');

    tabContainers.forEach(container => {
      const tabButtons = container.querySelectorAll('.tab-header .tab-btn');
      const tabContents = container.querySelectorAll('.tab-content');

      tabButtons.forEach(button => {
        button.addEventListener('click', () => {
          // Deactivate all buttons and content in this container
          tabButtons.forEach(btn => btn.classList.remove('active'));
          tabContents.forEach(content => content.classList.remove('active'));

          // Activate the clicked button and its corresponding content
          button.classList.add('active');
          const targetTabId = button.dataset.tab;
          const targetTabContent = container.querySelector(`#${targetTabId}`);
          if (targetTabContent) {
            targetTabContent.classList.add('active');
          }
        });
      });
    });

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

    // Video Upload Logic
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        const fileInput = document.getElementById('videoInput');
        const statusEl = document.getElementById('uploadStatus');
        
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
          if (statusEl) {
            statusEl.textContent = 'Please select a file.';
            statusEl.className = 'text-neg';
          }
          return;
        }

        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);

        if (statusEl) {
          statusEl.textContent = 'Uploading...';
          statusEl.className = 'muted';
        }
        uploadBtn.disabled = true;

        try {
          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
          });

          const result = await response.json();

          if (response.ok) {
            if (statusEl) {
              statusEl.textContent = `Success! Saved as ${result.filename}`;
              statusEl.className = 'text-pos';
            }
            fileInput.value = ''; // Clear input
          } else {
            throw new Error(result.error || 'Upload failed');
          }
        } catch (err) {
          console.error('Upload error:', err);
          if (statusEl) {
            statusEl.textContent = `Error: ${err.message}`;
            statusEl.className = 'text-neg';
          }
        } finally {
          uploadBtn.disabled = false;
        }
      });
    }
});
