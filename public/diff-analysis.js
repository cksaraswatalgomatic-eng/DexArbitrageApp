document.addEventListener('DOMContentLoaded', () => {
  const tokenSelectEl = document.getElementById('tokenSelect');
  const diffTableBody = document.querySelector('#diffTable tbody');
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  let diffChart;
  let currentOffset = 0;
  const limit = 5000;
  let allDiffData = [];

  async function fetchJSON(url) {
    const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
  }

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
          ticks: { color: '#8B949E' },
          grid: { color: '#30363D' }
        },
        y: {
          ticks: { color: '#8B949E' },
          grid: { color: '#30363D' }
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
    for (const d of diffData) {
        const tr = document.createElement('tr');
        const tokenName = d.curId.split('_')[1];
        tr.innerHTML = `
            <td>${tokenName}</td>
            <td>${new Date(d.ts).toLocaleString()}</td>
            <td>${d.buyDiffBps}</td>
            <td>${d.sellDiffBps}</td>
        `;
        diffTableBody.appendChild(tr);
    }
  }

  async function loadChart() {
    const curId = tokenSelectEl.value;
    if (!curId) return;

    try {
        const tokenName = curId.split('_')[1];
        const diffHistory = await fetchJSON(`/diffdata/history?curId=${curId}&limit=${limit}&offset=${currentOffset}`);

        const { diffData, serverToken } = diffHistory;

        if (currentOffset === 0) {
            allDiffData = diffData;
        } else {
            allDiffData = allDiffData.concat(diffData);
            allDiffData.sort((a, b) => a.ts - b.ts); // Sort by timestamp
        }

        const startTime = allDiffData.length > 0 ? allDiffData[0].ts : null;
        const endTime = allDiffData.length > 0 ? allDiffData[allDiffData.length - 1].ts : null;

        const tradesHistory = await fetchJSON(`/trades/history?token=${tokenName}&startTime=${startTime}&endTime=${endTime}`);

        renderDiffTable(allDiffData);

        const chartData = {
            labels: allDiffData.map(d => new Date(d.ts)),
            datasets: [
                {
                    label: 'Buy Diff',
                    data: allDiffData.map(d => d.buyDiffBps / 100),
                                                    borderColor: '#00E5FF',
                                                    backgroundColor: 'rgba(0, 229, 255, 0.1)',                    borderWidth: 2,
                    pointRadius: 0,
                    yAxisID: 'y'
                },
                {
                    label: 'Sell Diff',
                    data: allDiffData.map(d => d.sellDiffBps / 100),
                    borderColor: '#FF8C00',
                    backgroundColor: 'rgba(255, 140, 0, 0.1)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    yAxisID: 'y'
                }
            ]
        };

        if (serverToken) {
            chartData.datasets.push({
                label: 'Server Buy',
                data: allDiffData.map(() => serverToken.buy),
                borderColor: '#00E5FF',
                borderDash: [5, 5],
                borderWidth: 1,
                pointRadius: 0,
                yAxisID: 'y'
            });
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

        if (tradesHistory.length > 0) {
            chartData.datasets.push({
                label: 'Trades (Net Profit)',
                data: tradesHistory.map(t => ({ x: new Date(t.lastUpdateTime), y: t.netProfit })),
                type: 'scatter',
                backgroundColor: tradesHistory.map(t => t.netProfit >= 0 ? '#39FF14' : '#FF00FF'), // Green for positive, Red for negative
                yAxisID: 'y2'
            });
        }

        const ctx = document.getElementById('diffChart').getContext('2d');
        if (diffChart) {
            diffChart.destroy();
        }
        diffChart = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: getChartBaseOptions()
        });

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
  resetZoomBtn.addEventListener('click', () => {
    if (diffChart) {
      diffChart.resetZoom();
    }
  });

  loadTokens();
});
