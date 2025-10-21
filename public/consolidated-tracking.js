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

  const renderConsolidatedTotalBalanceChart = async () => {
    const totalBalanceHistory = await fetchJSON('/consolidated/total-balance-history');

    if (!Array.isArray(totalBalanceHistory) || totalBalanceHistory.length === 0) {
      if (consolidatedTotalBalanceChart) {
        consolidatedTotalBalanceChart.destroy();
        consolidatedTotalBalanceChart = null;
      }
      return;
    }

    const timeSeries = totalBalanceHistory
      .map(entry => {
        const timestamp = new Date(entry.timestamp);
        if (Number.isNaN(timestamp.getTime())) return null;
        return {
          timestamp,
          total: Number(entry.totalUsdt) || 0,
          servers: Array.isArray(entry.servers) ? entry.servers : [],
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const aggregatedDataset = timeSeries.map(entry => ({ x: entry.timestamp, y: entry.total }));

    const perServerSeries = new Map();
    for (const entry of timeSeries) {
      for (const server of entry.servers) {
        const serverId = server.serverId || server.serverLabel || 'server';
        if (!perServerSeries.has(serverId)) {
          perServerSeries.set(serverId, {
            label: server.serverLabel || server.serverId || 'Server',
            points: [],
          });
        }
        perServerSeries.get(serverId).points.push({
          x: entry.timestamp,
          y: Number(server.totalUsdt) || 0,
        });
      }
    }

    if (consolidatedTotalBalanceChart) {
      consolidatedTotalBalanceChart.destroy();
    }

    const palette = ['#39FF14', '#00E5FF', '#FF8C00', '#FF00FF', '#FFE066', '#74C0FC', '#B197FC', '#FF6B6B', '#63E6BE', '#FFD43B'];
    let colorIndex = 0;

    const datasets = [
      {
        label: 'Total Balance (All Servers)',
        data: aggregatedDataset,
        borderColor: '#FFFFFF',
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        tension: 0.25,
        borderWidth: 2.5,
        pointRadius: 0,
        parsing: false,
        spanGaps: true,
      },
    ];

    perServerSeries.forEach(series => {
      const color = palette[colorIndex % palette.length];
      datasets.push({
        label: series.label,
        data: series.points,
        borderColor: color,
        backgroundColor: 'rgba(0, 0, 0, 0)',
        tension: 0.25,
        borderWidth: 1.5,
        pointRadius: 0,
        parsing: false,
        spanGaps: true,
      });
      colorIndex += 1;
    });

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
