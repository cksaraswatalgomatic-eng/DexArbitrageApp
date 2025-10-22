document.addEventListener('DOMContentLoaded', async () => {
  const consolidatedDailyProfitChartCtx = document.getElementById('consolidatedDailyProfitChart').getContext('2d');
  const consolidatedTotalBalanceChartCtx = document.getElementById('consolidatedTotalBalanceChart').getContext('2d');
  const consolidatedBalancesTableBody = document.querySelector('#consolidatedBalancesTable tbody');
  const consolidatedDailyProfitTableBody = document.querySelector('#consolidatedDailyProfitTable tbody');
  const consolidatedTokenPerformanceChartCtx = document.getElementById('consolidatedTokenPerformanceChart').getContext('2d'); // New chart context
  const topPerformersTableBody = document.querySelector('#topPerformersTable tbody'); // New table body
  const worstPerformersTableBody = document.querySelector('#worstPerformersTable tbody'); // New table body

  let consolidatedDailyProfitChart;
  let consolidatedTotalBalanceChart;
  let consolidatedTokenPerformanceChart; // New chart instance
  const TOKEN_PERFORMANCE_LIMIT = 500;
  let tokenPerformanceCache = null;
  let tokenPerformancePromise = null;
  const consolidatedMinControls = document.getElementById('consolidatedMinControls');
  const consolidatedThresholds = {};
  let consolidatedSeries = [];
  let consolidatedServerInfos = [];
  let totalBalanceHistoryCache = null;
  let totalBalanceHistoryPromise = null;
  let isApplyingConsolidatedData = false;
  let consolidatedApplyScheduled = false;

  const scheduleConsolidatedChartUpdate = () => {
    if (consolidatedApplyScheduled) return;
    consolidatedApplyScheduled = true;
    Promise.resolve().then(() => {
      consolidatedApplyScheduled = false;
      applyConsolidatedChartData();
    });
  };

  if (typeof window.waitForChart === 'function') {
    try {
      await window.waitForChart();
    } catch (err) {
      console.error('Failed to load chart dependencies for consolidated tracking:', err);
      return;
    }
  }

  const fetchJSON = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  };

  const getTokenPerformanceData = async (force = false) => {
    if (force) {
      tokenPerformanceCache = null;
    }
    if (tokenPerformanceCache && !force) {
      return tokenPerformanceCache;
    }
    if (tokenPerformancePromise && !force) {
      return tokenPerformancePromise;
    }
    tokenPerformancePromise = fetchJSON(`/consolidated/token-performance?limit=${TOKEN_PERFORMANCE_LIMIT}`)
      .then(data => {
        tokenPerformanceCache = data;
        return data;
      })
      .catch(err => {
        if (!force) {
          tokenPerformanceCache = null;
        }
        throw err;
      })
      .finally(() => {
        tokenPerformancePromise = null;
      });
    return tokenPerformancePromise;
  };

  const getTotalBalanceHistory = async (force = false) => {
    if (force) {
      totalBalanceHistoryCache = null;
    }
    if (totalBalanceHistoryCache && !force) {
      return totalBalanceHistoryCache;
    }
    if (totalBalanceHistoryPromise && !force) {
      return totalBalanceHistoryPromise;
    }
    totalBalanceHistoryPromise = fetchJSON('/consolidated/total-balance-history')
      .then(data => {
        totalBalanceHistoryCache = data;
        return data;
      })
      .catch(err => {
        if (!force) {
          totalBalanceHistoryCache = null;
        }
        throw err;
      })
      .finally(() => {
        totalBalanceHistoryPromise = null;
      });
    return totalBalanceHistoryPromise;
  };

  const AGGREGATE_DATASET_KEY = 'total';
  const AGGREGATE_LABEL = 'All Servers';

  function ensureConsolidatedControls() {
    if (!consolidatedMinControls) return;
    const entries = [{ key: AGGREGATE_DATASET_KEY, label: AGGREGATE_LABEL }, ...consolidatedServerInfos];
    consolidatedMinControls.innerHTML = '';
    entries.forEach(({ key, label }) => {
      if (!(key in consolidatedThresholds)) {
        consolidatedThresholds[key] = null;
      }
      const wrapper = document.createElement('label');
      wrapper.className = 'inline-control';
      wrapper.append(document.createTextNode(`${label}: `));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.placeholder = '0';
      input.dataset.dataset = key;
      if (consolidatedThresholds[key] != null) {
        input.value = String(consolidatedThresholds[key]);
      }
      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        consolidatedThresholds[key] = Number.isFinite(val) && val >= 0 ? val : null;
        scheduleConsolidatedChartUpdate();
      });
      wrapper.appendChild(input);
      consolidatedMinControls.appendChild(wrapper);
    });
  }

  function applyConsolidatedChartData() {
    if (isApplyingConsolidatedData) return;
    isApplyingConsolidatedData = true;

    try {
    if (!consolidatedTotalBalanceChartCtx) return;

    if (!consolidatedSeries.length) {
      if (consolidatedTotalBalanceChart) {
        consolidatedTotalBalanceChart.destroy();
        consolidatedTotalBalanceChart = null;
      }
      return;
    }

    const aggregateThreshold = consolidatedThresholds[AGGREGATE_DATASET_KEY] ?? null;
    const aggregatePoints = [];
    const perServerMap = new Map();

    for (const entry of consolidatedSeries) {
      const timestamp = entry.timestamp;
      if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) continue;

      if (aggregateThreshold == null || entry.total >= aggregateThreshold) {
        aggregatePoints.push({ x: timestamp, y: entry.total });
      }

      for (const server of entry.servers) {
        if (!perServerMap.has(server.key)) {
          perServerMap.set(server.key, { label: server.label, points: [] });
        }
        const threshold = consolidatedThresholds[server.key] ?? null;
        if (threshold == null || server.value >= threshold) {
          perServerMap.get(server.key).points.push({ x: timestamp, y: server.value });
        }
      }
    }

    const datasets = [];
    datasets.push({
      datasetKey: AGGREGATE_DATASET_KEY,
      label: AGGREGATE_LABEL,
      data: aggregatePoints,
      borderColor: '#FFFFFF',
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      tension: 0.25,
      borderWidth: 2.5,
      pointRadius: 0,
      spanGaps: true,
      parsing: false,
    });

    const palette = ['#39FF14', '#00E5FF', '#FF8C00', '#FF00FF', '#FFE066', '#74C0FC', '#B197FC', '#FF6B6B', '#63E6BE', '#FFD43B'];
    let colorIndex = 0;
    consolidatedServerInfos.forEach(info => {
      const series = perServerMap.get(info.key);
      const points = series ? series.points : [];
      const color = palette[colorIndex % palette.length];
      datasets.push({
        datasetKey: info.key,
        label: info.label,
        data: points,
        borderColor: color,
        backgroundColor: 'rgba(0, 0, 0, 0)',
        tension: 0.25,
        borderWidth: 1.5,
        pointRadius: 0,
        spanGaps: true,
        parsing: false,
      });
      colorIndex += 1;
    });

    const activeTimes = datasets
      .flatMap(ds => ds.data)
      .map(pt => (pt.x instanceof Date ? pt.x.getTime() : new Date(pt.x).getTime()))
      .filter(Number.isFinite);

    const allTimes = consolidatedSeries
      .map(entry => (entry.timestamp instanceof Date ? entry.timestamp.getTime() : new Date(entry.timestamp).getTime()))
      .filter(Number.isFinite);

    if (!allTimes.length) {
      if (consolidatedTotalBalanceChart) {
        consolidatedTotalBalanceChart.destroy();
        consolidatedTotalBalanceChart = null;
      }
      return;
    }

    let defaultMin = allTimes.length > 0 ? allTimes.reduce((min, t) => Math.min(min, t), Infinity) : Infinity;
    let defaultMax = allTimes.length > 0 ? allTimes.reduce((max, t) => Math.max(max, t), -Infinity) : -Infinity;
    if (!Number.isFinite(defaultMin) || !Number.isFinite(defaultMax)) {
      defaultMin = Date.now() - 60 * 60 * 1000;
      defaultMax = Date.now();
    }

    let minTime = activeTimes.length > 0 ? activeTimes.reduce((min, t) => Math.min(min, t), Infinity) : defaultMin;
    let maxTime = activeTimes.length > 0 ? activeTimes.reduce((max, t) => Math.max(max, t), -Infinity) : defaultMax;
    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
      minTime = defaultMin;
      maxTime = defaultMax;
    }

    if (minTime === maxTime) {
      const pad = 10 * 60 * 1000;
      minTime -= pad;
      maxTime += pad;
    }

    if (defaultMin === defaultMax) {
      const pad = 10 * 60 * 1000;
      defaultMin -= pad;
      defaultMax += pad;
    }

    const xBounds = { min: new Date(minTime), max: new Date(maxTime) };
    const zoomLimits = { min: new Date(defaultMin), max: new Date(defaultMax) };

    if (!consolidatedTotalBalanceChart) {
      consolidatedTotalBalanceChart = new Chart(consolidatedTotalBalanceChartCtx, {
        type: 'line',
        data: {
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            legend: {
              position: 'top',
            },
            zoom: {
              pan: {
                enabled: true,
                mode: 'x'
              },
              zoom: {
                wheel: {
                  enabled: true,
                },
                pinch: {
                  enabled: true
                },
                mode: 'x'
              },
              limits: {
                x: {
                  min: zoomLimits.min,
                  max: zoomLimits.max,
                }
              }
            }
          },
          scales: {
            x: {
              type: 'time',
              time: {
                tooltipFormat: 'PPpp',
                displayFormats: { minute: 'MMM d HH:mm', hour: 'MMM d HH:mm', day: 'MMM d' }
              },
              min: xBounds.min,
              max: xBounds.max,
              ticks: { autoSkip: true, maxTicksLimit: 12 }
            },
            y: {
              beginAtZero: false,
              position: 'left',
              title: {
                display: true,
                text: 'Total Balance (USDT)'
              }
            }
          }
        }
      });
    } else {
      consolidatedTotalBalanceChart.data.datasets = datasets;
      const opts = consolidatedTotalBalanceChart.options;
      if (opts?.scales?.x) {
        opts.scales.x.min = xBounds.min;
        opts.scales.x.max = xBounds.max;
      }
      if (opts?.plugins?.zoom) {
        if (!opts.plugins.zoom.limits) {
          opts.plugins.zoom.limits = {};
        }
        if (!opts.plugins.zoom.limits.x) {
          opts.plugins.zoom.limits.x = {};
        }
        opts.plugins.zoom.limits.x.min = zoomLimits.min;
        opts.plugins.zoom.limits.x.max = zoomLimits.max;
      }
      consolidatedTotalBalanceChart.update();
    }
    } finally {
      isApplyingConsolidatedData = false;
    }
  }

  const renderConsolidatedDailyProfitChart = async () => {
    const dailyProfitData = await fetchJSON('/consolidated/daily-profit');

    const labels = dailyProfitData.map(item => item.date);
    const profitValues = dailyProfitData.map(item => item.profit);

    if (consolidatedDailyProfitChart) {
      consolidatedDailyProfitChart.destroy();
    }

    consolidatedDailyProfitChart = new Chart(consolidatedDailyProfitChartCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Daily Profit',
            data: profitValues,
            backgroundColor: profitValues.map(profit => profit < 0 ? '#FF00FF' : '#39FF14'),
            yAxisID: 'y',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          zoom: {
            pan: {
              enabled: true,
              mode: 'x'
            },
            zoom: {
              wheel: {
                enabled: true,
              },
              pinch: {
                enabled: true
              },
              mode: 'x'
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: {
              display: true,
              text: 'Date'
            }
          },
          y: {
            beginAtZero: true,
            position: 'left',
            title: {
              display: true,
              text: 'Daily Profit'
            }
          }
        }
      }
    });
  };

  const renderConsolidatedTotalBalanceChart = async (force = false) => {
    const totalBalanceHistory = await getTotalBalanceHistory(force);

    if (!Array.isArray(totalBalanceHistory) || !totalBalanceHistory.length) {
      consolidatedSeries = [];
      consolidatedServerInfos = [];
      ensureConsolidatedControls();
      scheduleConsolidatedChartUpdate();
      return;
    }

    const serverInfoMap = new Map();
    let unnamedIndex = 0;

    consolidatedSeries = totalBalanceHistory
      .map(entry => {
        const timestamp = new Date(entry.timestamp);
        if (Number.isNaN(timestamp.getTime())) return null;
        const servers = Array.isArray(entry.servers)
          ? entry.servers.map(server => {
              let id = server.serverId || server.serverLabel || '';
              if (!id) {
                id = `server-${unnamedIndex}`;
                unnamedIndex += 1;
              }
              const key = `server:${id}`;
              const label = server.serverLabel || server.serverId || id;
              if (!serverInfoMap.has(key)) {
                serverInfoMap.set(key, { key, label });
              }
              return {
                key,
                label,
                value: Number(server.totalUsdt) || 0,
              };
            })
          : [];
        return {
          timestamp,
          total: Number(entry.totalUsdt) || 0,
          servers,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    consolidatedServerInfos = Array.from(serverInfoMap.values());
    ensureConsolidatedControls();
    scheduleConsolidatedChartUpdate();
  };

  const renderConsolidatedBalancesTable = async () => {
    const data = await fetchJSON('/consolidated/balances/latest');
    consolidatedBalancesTableBody.innerHTML = '';
    data.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.serverLabel}</td>
        <td>${item.totalUsdt.toFixed(2)}</td>
        <td>${item.cexTotalUsdt.toFixed(2)}</td>
        <td>${item.dexTotalUsdt.toFixed(2)}</td>
      `;
      consolidatedBalancesTableBody.appendChild(tr);
    });
  };

  const renderConsolidatedDailyProfitTable = async () => {
    const data = await fetchJSON('/consolidated/daily-profit/latest');
    consolidatedDailyProfitTableBody.innerHTML = '';
    data.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.serverLabel}</td>
        <td>${item.profit.toFixed(2)}</td>
      `;
      consolidatedDailyProfitTableBody.appendChild(tr);
    });
  };

  const renderConsolidatedTokenPerformanceChart = async () => {
    const data = await getTokenPerformanceData();
    const allTokens = [...data.topPerformers, ...data.worstPerformers];
    const labels = allTokens.map(item => item.token);
    const netProfitData = allTokens.map(item => item.totalNetProfit);

    if (consolidatedTokenPerformanceChart) {
      consolidatedTokenPerformanceChart.destroy();
    }

    consolidatedTokenPerformanceChart = new Chart(consolidatedTokenPerformanceChartCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Net Profit',
          data: netProfitData,
          backgroundColor: netProfitData.map(profit => profit < 0 ? '#FF00FF' : '#39FF14'),
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          zoom: {
            pan: {
              enabled: true,
              mode: 'x'
            },
            zoom: {
              wheel: {
                enabled: true,
              },
              pinch: {
                enabled: true
              },
              mode: 'x'
            }
          }
        },
        scales: {
          x: {
            type: 'category'
          },
          y: {
            beginAtZero: true
          }
        }
      }
    });
  };

  const renderConsolidatedTokenPerformanceTables = async () => {
    const data = await getTokenPerformanceData();
    topPerformersTableBody.innerHTML = '';
    data.topPerformers.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.token}</td>
        <td>${item.totalNetProfit.toFixed(2)}</td>
        <td>${item.trades}</td>
      `;
      topPerformersTableBody.appendChild(tr);
    });

    worstPerformersTableBody.innerHTML = '';
    data.worstPerformers.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.token}</td>
        <td>${item.totalNetProfit.toFixed(2)}</td>
        <td>${item.trades}</td>
      `;
      worstPerformersTableBody.appendChild(tr);
    });
  };

  await Promise.all([
    renderConsolidatedDailyProfitChart(),
    renderConsolidatedTotalBalanceChart(),
    renderConsolidatedBalancesTable(),
    renderConsolidatedDailyProfitTable(),
    renderConsolidatedTokenPerformanceChart(), // Call the new chart function
    renderConsolidatedTokenPerformanceTables()
  ]);
});
