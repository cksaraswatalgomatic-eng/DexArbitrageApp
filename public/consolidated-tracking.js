document.addEventListener('DOMContentLoaded', async () => {
  const consolidatedDailyProfitChartCtx = document.getElementById('consolidatedDailyProfitChart').getContext('2d');
  const consolidatedBalancesTableBody = document.querySelector('#consolidatedBalancesTable tbody');
  const consolidatedDailyProfitTableBody = document.querySelector('#consolidatedDailyProfitTable tbody');
  const consolidatedTokenPerformanceChartCtx = document.getElementById('consolidatedTokenPerformanceChart').getContext('2d'); // New chart context
  const topPerformersTableBody = document.querySelector('#topPerformersTable tbody'); // New table body
  const worstPerformersTableBody = document.querySelector('#worstPerformersTable tbody'); // New table body

  let consolidatedDailyProfitChart;
  let consolidatedTokenPerformanceChart; // New chart instance

  const fetchJSON = async (url) => {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  };

  const renderConsolidatedDailyProfitChart = async () => {
    const data = await fetchJSON('/consolidated/daily-profit');
    const labels = data.map(item => item.date);
    const profitData = data.map(item => item.profit);

    if (consolidatedDailyProfitChart) {
      consolidatedDailyProfitChart.destroy();
    }

    consolidatedDailyProfitChart = new Chart(consolidatedDailyProfitChartCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Daily Profit',
          data: profitData,
          backgroundColor: profitData.map(profit => profit < 0 ? '#FF00FF' : '#39FF14'),
        }]
      },
      options: {
        responsive: true,
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
    const data = await fetchJSON('/consolidated/token-performance?limit=1000'); // Fetch for last 1000 trades
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
    const data = await fetchJSON('/consolidated/token-performance?limit=1000'); // Fetch for last 1000 trades
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
    renderConsolidatedBalancesTable(),
    renderConsolidatedDailyProfitTable(),
    renderConsolidatedTokenPerformanceChart(), // Call the new chart function
    renderConsolidatedTokenPerformanceTables() // Call the new tables function
  ]);
});
