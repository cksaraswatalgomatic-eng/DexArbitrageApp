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
  const outlierPercentageInput = document.getElementById('outlierPercentage');
  const sanitizeOutlierValue = (rawValue) => {
    const value = parseFloat(rawValue);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
  };
  let outlierPercentage = sanitizeOutlierValue(outlierPercentageInput ? outlierPercentageInput.value : 0);

  if (outlierPercentageInput) {
    outlierPercentageInput.addEventListener('input', () => {
      const sanitized = sanitizeOutlierValue(outlierPercentageInput.value);
      if (sanitized === outlierPercentage) return;
      outlierPercentage = sanitized;
      scheduleConsolidatedChartUpdate();
    });
  }

  // Add event listener for the reset zoom button
  const resetConsolidatedZoomBtn = document.getElementById('resetConsolidatedZoomBtn');
  if (resetConsolidatedZoomBtn) {
    resetConsolidatedZoomBtn.addEventListener('click', () => {
      if (consolidatedTotalBalanceChart) {
        consolidatedTotalBalanceChart.resetZoom();
      }
    });
  }

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

  function calculateQuartiles(data) {
    const sortedData = [...data].sort((a, b) => a - b);
    const mid = Math.floor(sortedData.length / 2);
    const q1 = median(sortedData.slice(0, mid));
    const q3 = median(sortedData.slice(mid + (sortedData.length % 2), sortedData.length));
    return { q1, q3 };
  }

  function median(data) {
    if (data.length === 0) return 0;
    const mid = Math.floor(data.length / 2);
    return data.length % 2 === 0 ? (data[mid - 1] + data[mid]) / 2 : data[mid];
  }

  function removeOutliersIQR(data) {
    if (data.length < 4) return data; // Not enough data to calculate quartiles reliably

    const values = data.map(entry => Number(entry.total)).filter(Number.isFinite);
    if (values.length === 0) return data;

    const { q1, q3 } = calculateQuartiles(values);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return data.filter(entry => {
      const total = Number(entry.total);
      return Number.isFinite(total) && total >= lowerBound && total <= upperBound;
    });
  }

  function ensureConsolidatedControls() {
    if (!consolidatedMinControls) return;
    // For the Total USDT Balance Over Time chart, only show the control for the aggregate (All Servers) dataset
    const entries = [{ key: AGGREGATE_DATASET_KEY, label: AGGREGATE_LABEL }];
    consolidatedMinControls.innerHTML = '';
    entries.forEach(({ key, label }) => {
      if (!(key in consolidatedThresholds)) {
        consolidatedThresholds[key] = null;
      }
      const wrapper = document.createElement('label');
      wrapper.className = 'inline-control';
      // Change "Outlier %" to "Outlier Filter"
      let displayLabel = label;
      if (label === 'Outlier %') {
        displayLabel = 'Outlier Filter';
      }
      wrapper.append(document.createTextNode(`${displayLabel}: `));
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

      let pointsToProcess = consolidatedSeries;
      console.log('consolidatedSeries before filtering:', JSON.stringify(consolidatedSeries));
      if (outlierPercentage > 0 && pointsToProcess.length > 1) {
        // Apply a dynamic threshold filter where the threshold is based on the most recently displayed point
        // If a point has value V and the threshold is T, then only points with values >= (V - T) 
        // will be displayed until another point is added to the series
        const threshold = outlierPercentage; // Use the value as the absolute threshold
        const filtered = [];
        for (const entry of pointsToProcess) {
          const currentTotal = Number(entry.total);
          if (!Number.isFinite(currentTotal)) {
            continue;
          }
          if (!filtered.length) {
            filtered.push(entry);
            continue;
          }
          
          // The threshold is based on the most recently added point
          const lastDisplayedTotal = Number(filtered[filtered.length - 1].total);
          const minAcceptableValue = lastDisplayedTotal - threshold;
          
          if (currentTotal >= minAcceptableValue) {
            filtered.push(entry);
          }
          // else: skip this point because it's below the acceptable threshold
        }
        pointsToProcess = filtered.length ? filtered : [pointsToProcess[0]];
      }

      const aggregateThreshold = consolidatedThresholds[AGGREGATE_DATASET_KEY] ?? null;
      const aggregatePoints = [];
      const perServerMap = new Map();

      for (const entry of pointsToProcess) {
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
        borderColor: '#00BFFF',  // Deep Sky Blue (radiant blue)
        backgroundColor: 'rgba(0, 191, 255, 0.08)',  // Matching blue with opacity
        tension: 0.25,
        borderWidth: 2.5,
        pointRadius: 0,
        spanGaps: true,
        parsing: false,
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
                  mode: 'x',
                  drag: {
                    enabled: true
                  }
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
    
    // Calculate totals
    let totalUsdtSum = 0;
    let cexTotalUsdtSum = 0;
    let dexTotalUsdtSum = 0;
    
    data.forEach(item => {
      totalUsdtSum += item.totalUsdt;
      cexTotalUsdtSum += item.cexTotalUsdt;
      dexTotalUsdtSum += item.dexTotalUsdt;
      
      // Calculate CEX to DEX ratio
      let ratio = 0;
      if (item.dexTotalUsdt !== 0) {
        ratio = (item.cexTotalUsdt * 100) / item.dexTotalUsdt;
      }
      
      const ratioCell = document.createElement('td');
      ratioCell.textContent = ratio.toFixed(2) + '%';
      // Apply styling based on ratio value
      if (ratio >= 20) {
        ratioCell.classList.add('text-pos'); // Green color (from existing CSS)
      } else {
        ratioCell.classList.add('text-neg'); // Red color (from existing CSS)
      }
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.serverLabel}</td>
        <td>${item.totalUsdt.toFixed(2)}</td>
        <td>${item.cexTotalUsdt.toFixed(2)}</td>
        <td>${item.dexTotalUsdt.toFixed(2)}</td>
      `;
      tr.appendChild(ratioCell);
      consolidatedBalancesTableBody.appendChild(tr);
    });
    
    // Calculate total ratio
    let totalRatio = 0;
    if (dexTotalUsdtSum !== 0) {
      totalRatio = (cexTotalUsdtSum * 100) / dexTotalUsdtSum;
    }
    
    const ratioTotalCell = document.createElement('td');
    ratioTotalCell.textContent = totalRatio.toFixed(2) + '%';
    // Apply styling based on total ratio value
    if (totalRatio >= 20) {
      ratioTotalCell.classList.add('text-pos'); // Green color (from existing CSS)
    } else {
      ratioTotalCell.classList.add('text-neg'); // Red color (from existing CSS)
    }
    
    // Add total row
    const totalRow = document.createElement('tr');
    totalRow.classList.add('total-row'); // Add a class for potential styling
    totalRow.innerHTML = `
      <td><strong>Total</strong></td>
      <td><strong>${totalUsdtSum.toFixed(2)}</strong></td>
      <td><strong>${cexTotalUsdtSum.toFixed(2)}</strong></td>
      <td><strong>${dexTotalUsdtSum.toFixed(2)}</strong></td>
    `;
    totalRow.appendChild(ratioTotalCell);
    consolidatedBalancesTableBody.appendChild(totalRow);
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
