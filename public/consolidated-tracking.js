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

    const labels = totalBalanceHistory.map(item => new Date(item.timestamp).toISOString().split('T')[0]);

    // Map total balance data to the combined labels, using the highest value for each day
    const totalBalanceDailyMap = new Map();
    totalBalanceHistory.forEach(item => {
      const date = new Date(item.timestamp).toISOString().split('T')[0];
      if (!totalBalanceDailyMap.has(date) || item.totalUsdt > totalBalanceDailyMap.get(date)) {
        totalBalanceDailyMap.set(date, item.totalUsdt);
      }
    });
    const totalBalanceValues = labels.map(date => totalBalanceDailyMap.get(date) || 0);

    if (consolidatedTotalBalanceChart) {
      consolidatedTotalBalanceChart.destroy();
    }

    consolidatedTotalBalanceChart = new Chart(consolidatedTotalBalanceChartCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Total Balance',
            data: totalBalanceValues,
            borderColor: '#00E5FF', // Cyan for total balance line
            backgroundColor: 'rgba(0, 229, 255, 0.2)',
            type: 'line',
            fill: false,
            tension: 0.3,
            yAxisID: 'y',
            pointRadius: 3,
            pointBackgroundColor: '#FFFF00', // Bright yellow for data points
            pointBorderColor: '#00E5FF', // Border color same as line
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#FFFF00',
            pointHoverBorderColor: '#00E5FF',
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
            beginAtZero: false,
            position: 'left',
            title: {
              display: true,
              text: 'Total Balance'
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
