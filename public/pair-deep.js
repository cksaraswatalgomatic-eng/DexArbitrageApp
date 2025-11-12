/* eslint-disable no-unused-vars */
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

const pairEl = document.getElementById('pair');
const pairSearchEl = document.getElementById('pairSearch');
const limitEl = document.getElementById('limit');
const varXEl = document.getElementById('varX');
const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const netProfitBtn = document.getElementById('netProfitBtn');
const exportBtn = document.getElementById('exportBtn');
const additionalChartsEl = document.getElementById('additionalCharts');

let cumChart, histChart, scatterChart, netProfitChart;
let allPairs = [];
let currentData = [];

const variables = [
  { key: 'executedSrcPrice', label: 'Executed Src Price' },
  { key: 'executedDstPrice', label: 'Executed Dst Price' },
  { key: 'executedQtySrc', label: 'Executed Qty Src' },
  { key: 'executedQtyDst', label: 'Executed Qty Dst' },
  { key: 'executedTime', label: 'Executed Time (ms)'},
  { key: 'props.Diff', label: 'Props Diff' },
  { key: 'props.DexSlip', label: 'Props DexSlip' },
  { key: 'props.CexSlip', label: 'Props CexSlip' },
];

variables.forEach(v=>{ const o=document.createElement('option'); o.value=v.key; o.textContent=v.label; varXEl.appendChild(o); });
varXEl.value = 'props.Diff';

async function fetchJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

async function loadPairs(){
  allPairs = await fetchJSON('/trades/pairs');
  renderPairOptions('');
}

function renderPairOptions(query){
  const q = (query||'').toLowerCase();
  // Keep the default option
  const defaultOption = pairEl.querySelector('option[value=""]');
  pairEl.innerHTML = '';
  if (defaultOption) pairEl.appendChild(defaultOption);
  
  const filtered = allPairs.filter(p => p.toLowerCase().includes(q));
  for (const p of filtered) { const o=document.createElement('option'); o.value=p; o.textContent=p; pairEl.appendChild(o); }
}

function prop(t, key){
  if (!key.includes('.')) return t[key];
  const [h, k]=key.split('.',2);
  if (h==='props'){
    try{
      const raw=t.props?JSON.parse(t.props):{};
      const p={};
      if (raw && (raw.Diff!=null||raw.DexSlip!=null||raw.CexSlip!=null||raw.Dex!=null||raw.Exec!=null)) Object.assign(p, raw);
      else {
        const execKey=['Market','Limit','PostOnly','IOC','FOK'].find(x=>Object.prototype.hasOwnProperty.call(raw,x));
        if (execKey){ p.Exec=execKey; const v=Number(raw[execKey]); if (Number.isFinite(v)) p.CexSlip=v; }
        for (const [rk,rv] of Object.entries(raw)){ if(/[_-]link[_-]/i.test(rk)){ p.Dex=String(rv); break; } }
        for (const [rk,rv] of Object.entries(raw)){ const nk=Number(rk), nv=Number(rv); if(Number.isFinite(nk)&&Number.isFinite(nv)){ p.Diff=nk; p.DexSlip=nv; break; } }
      }
      return p[k];
    }catch{return undefined;}
  }
}

function toNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

function computeHistogram(values, bins=20){
  const min=Math.min(...values), max=Math.max(...values);
  const w=(max-min||1)/bins; const edges=Array.from({length:bins+1},(_,)=>min+_*w);
  const counts=Array(bins).fill(0);
  values.forEach(v=>{ let idx=Math.floor((v-min)/w); if(idx>=bins) idx=bins-1; if(idx<0) idx=0; counts[idx]++; });
  const centers=edges.slice(0,-1).map((e,i)=>e+w/2);
  return { centers, counts };
}

// Calculate net profit for a trade
function calculateNetProfit(trade) {
  const grossProfit = Number(trade.executedGrossProfit) || 0;
  const fee = 0.0002 * (trade.executedQtyDst * trade.executedDstPrice);
  return grossProfit - fee;
}

// Render net profit per trade chart (using scatter plot for better time-based representation)
function renderNetProfitPerTradeChart(rows) {
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#30363D';
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#9ca3af';
  const tooltipBg = getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || '#161B22';

  // Filter out trades without valid timestamps
  const validRows = rows.filter(t => {
    const timestamp = t.lastUpdateTime || t.creationTime;
    return timestamp && !isNaN(new Date(timestamp).getTime());
  });

  // Sort by time ascending
  validRows.sort((a,b)=> (a.lastUpdateTime||a.creationTime||0) - (b.lastUpdateTime||b.creationTime||0));

  // Create data points for individual trade profits
  const netProfitPoints = [];
  for (const t of validRows){ 
    const netProfit = calculateNetProfit(t);
    const ts = t.lastUpdateTime || t.creationTime || Date.now(); 
    netProfitPoints.push({ x: new Date(ts), y: netProfit }); 
  }

  const ctx = document.getElementById('netProfitChart').getContext('2d');
  if (!netProfitChart) {
    const cfg = {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Net Profit per Trade',
          data: netProfitPoints,
          backgroundColor: (context) => {
            const value = context.dataset.data[context.dataIndex].y;
            return value >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)';
          },
          borderColor: (context) => {
            const value = context.dataset.data[context.dataIndex].y;
            return value >= 0 ? 'rgba(34, 197, 94, 1)' : 'rgba(239, 68, 68, 1)';
          },
          pointRadius: 4,
          pointHoverRadius: 6,
          parsing: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { 
            type: 'time',
            time: {
              unit: 'hour',
              tooltipFormat: 'MMM d, yyyy HH:mm',
              displayFormats: { 
                minute: 'HH:mm', 
                hour: 'HH:mm',
                day: 'MMM d'
              }
            },
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Time',
              color: textColor
            }
          },
          y: { 
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Net Profit (USDT)',
              color: textColor
            }
          }
        },
        plugins: {
          legend: { labels: { color: textColor } },
          zoom: {
            pan: { enabled: true, mode: 'x', modifierKey: 'ctrl' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: true }, mode: 'x' }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `Net Profit: ${context.parsed.y.toFixed(2)} USDT`;
              }
            }
          }
        }
      }
    };
    netProfitChart = new Chart(ctx, cfg);
  } else { 
    netProfitChart.data.datasets[0].data = netProfitPoints; 
  }
  
  // Reset zoom to show all data
  try { 
    netProfitChart.resetZoom(); 
  } catch {/* ignore */}
  netProfitChart.update('none');
}

// Export data as CSV
function exportDataAsCSV(rows) {
  if (!rows || rows.length === 0) {
    alert('No data to export');
    return;
  }

  // Define CSV headers
  const headers = [
    'Pair', 'Creation Time', 'Last Update Time', 'Source Symbol', 'Destination Symbol',
    'Executed Qty Src', 'Executed Qty Dst', 'Executed Src Price', 'Executed Dst Price',
    'Gross Profit', 'Net Profit', 'Props'
  ];

  // Create CSV content
  let csvContent = headers.join(',') + '\n';
  
  rows.forEach(row => {
    const netProfit = calculateNetProfit(row);
    const rowData = [
      `"${row.pair}"`,
      `"${row.creationTime || ''}"`,
      `"${row.lastUpdateTime || ''}"`,
      `"${row.srcSymbol || ''}"`,
      `"${row.dstSymbol || ''}"`,
      `"${row.executedQtySrc || ''}"`,
      `"${row.executedQtyDst || ''}"`,
      `"${row.executedSrcPrice || ''}"`,
      `"${row.executedDstPrice || ''}"`,
      `"${row.executedGrossProfit || ''}"`,
      `"${netProfit}"`,
      `"${row.props || ''}"`
    ];
    csvContent += rowData.join(',') + '\n';
  });

  // Create download link
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `pair-analysis-${pairEl.value || 'data'}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function run(){
  const gridColor = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#30363D';
  const textColor = getComputedStyle(document.body).getPropertyValue('--text-color').trim() || '#9ca3af';
  const tooltipBg = getComputedStyle(document.body).getPropertyValue('--bg-color').trim() || '#161B22';

  const pair = pairEl.value; 
  const limit = parseInt(limitEl.value,10)||1000; 
  const xKey = varXEl.value;
  
  if (!pair) {
    statusEl.textContent = 'Please select a pair';
    return;
  }
  
  statusEl.textContent = 'Loading...';
  const params = new URLSearchParams({ limit:String(limit), pair });
  const rows = await fetchJSON(`/trades?${params.toString()}`);
  currentData = rows; // Store for export
  
  // Sort by time ascending for cumulative
  rows.sort((a,b)=> (a.lastUpdateTime||a.creationTime||0) - (b.lastUpdateTime||b.creationTime||0));

  // Cumulative net profit
  // Filter out trades without valid timestamps
  const validRows = rows.filter(t => {
      const timestamp = t.lastUpdateTime || t.creationTime;
      return timestamp && !isNaN(new Date(timestamp).getTime());
  });
  
  let sum=0; const cumPoints=[];
  for (const t of validRows){ 
      const netProfit = calculateNetProfit(t);
      sum+=netProfit; 
      const ts=t.lastUpdateTime||t.creationTime||Date.now(); 
      cumPoints.push({ x:new Date(ts), y:sum }); 
  }

  const ctx1=document.getElementById('cumChart').getContext('2d');
  if(!cumChart){
    const cfg = {
      type: 'line',
      data: {
        datasets: [{
          label: 'Cumulative Net Profit',
          data: cumPoints,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.15)',
          pointRadius: 0,
          parsing: false,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { 
            type: 'time',
            time: {
              unit: 'hour',
              tooltipFormat: 'MMM d, yyyy HH:mm',
              displayFormats: { 
                minute: 'HH:mm', 
                hour: 'HH:mm',
                day: 'MMM d'
              }
            },
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Time',
              color: textColor
            }
          },
          y: { 
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Cumulative Net Profit (USDT)',
              color: textColor
            }
          }
        },
        plugins: {
          legend: { labels: { color: textColor } },
          zoom: {
            pan: { enabled: true, mode: 'x', modifierKey: 'ctrl' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, drag: { enabled: true }, mode: 'x' }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `Cumulative Net Profit: ${context.parsed.y.toFixed(2)} USDT`;
              }
            }
          }
        }
      }
    };
    cumChart = new Chart(ctx1, cfg);
  } else { 
    cumChart.data.datasets[0].label = 'Cumulative Net Profit';
    cumChart.data.datasets[0].data = cumPoints; 
  }
  // Reset zoom to show all data
  try { 
    cumChart.resetZoom(); 
  } catch {/* ignore */}
  cumChart.update('none');

  // Histogram of net profit
  const netProfitValues = rows.map(t => calculateNetProfit(t));
  const { centers, counts } = computeHistogram(netProfitValues, 30);
  const ctx2=document.getElementById('histChart').getContext('2d');
  if(!histChart){
    const cfg2 = {
      type: 'bar',
      data: { labels: centers, datasets: [{ label: 'Net Profit Frequency', data: counts, backgroundColor: 'rgba(96,165,250,0.6)' }] },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        scales: { 
          x: { 
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Net Profit (USDT)',
              color: textColor
            }
          }, 
          y: { 
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Frequency',
              color: textColor
            }
          } 
        }, 
        plugins: { 
          legend: { labels: { color: textColor } },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `Frequency: ${context.parsed.y} trades`;
              },
              title: function(context) {
                const center = context[0].label;
                const binWidth = (Math.max(...centers) - Math.min(...centers)) / centers.length;
                const start = (parseFloat(center) - binWidth/2).toFixed(2);
                const end = (parseFloat(center) + binWidth/2).toFixed(2);
                return `Net Profit: ${start} to ${end} USDT`;
              }
            }
          }
        } 
      }
    };
    histChart = new Chart(ctx2, cfg2);
  } else { 
    histChart.data.datasets[0].label = 'Net Profit Frequency';
    histChart.data.labels=centers; 
    histChart.data.datasets[0].data=counts; 
  }
  // Reset zoom to show all data
  try { 
    histChart.resetZoom(); 
  } catch {/* ignore */}
  histChart.update('none');

  // Scatter X vs Net Profit
  const points=[]; 
  for(const t of rows){ 
    const xv=toNum(prop(t,xKey)||t[xKey]); 
    const yv=toNum(calculateNetProfit(t));
    if(xv!=null && yv!=null) points.push({x:xv,y:yv}); 
  }
  const ctx3=document.getElementById('scatterChart').getContext('2d');
  if(!scatterChart){
    const cfg3 = {
      type: 'scatter',
      data: { datasets: [{ 
        label: `${xKey} vs Net Profit`, 
        data: points, 
        backgroundColor: (context) => {
          const value = context.dataset.data[context.dataIndex].y;
          return value >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)';
        },
        pointRadius: 4,
        pointHoverRadius: 6
      }] },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        scales: { 
          x: { 
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: xKey,
              color: textColor
            }
          }, 
          y: { 
            ticks: { color: textColor },
            grid: { color: gridColor },
            title: {
              display: true,
              text: 'Net Profit (USDT)',
              color: textColor
            }
          } 
        }, 
        plugins: { 
          legend: { labels: { color: textColor } }, 
          zoom: { 
            pan:{enabled:true, mode:'xy', modifierKey:'ctrl'}, 
            zoom:{wheel:{enabled:true}, pinch:{enabled:true}, drag:{enabled:true}, mode:'xy'} 
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: textColor,
            bodyColor: textColor,
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `Net Profit: ${context.parsed.y.toFixed(2)} USDT`;
              },
              title: function(context) {
                return `${xKey}: ${context[0].parsed.x.toFixed(4)}`;
              }
            }
          }
        } 
      }
    };
    scatterChart = new Chart(ctx3, cfg3);
  } else { 
    scatterChart.data.datasets[0].label=`${xKey} vs Net Profit`;
    scatterChart.data.datasets[0].data=points; 
  }
  // Reset zoom to show all data
  try { 
    scatterChart.resetZoom(); 
  } catch {/* ignore */}
  scatterChart.update('none');

  statusEl.textContent = `Rows: ${rows.length}`;
}

// Event listeners
runBtn.addEventListener('click', run);

document.getElementById('theme-switcher').addEventListener('click', () => {
  run();
});

pairSearchEl.addEventListener('input', (e)=>{ 
  renderPairOptions(e.target.value); 
});

netProfitBtn.addEventListener('click', () => {
  if (!currentData || currentData.length === 0) {
    statusEl.textContent = 'No data available. Please run analysis first.';
    return;
  }
  
  additionalChartsEl.style.display = 'block';
  renderNetProfitPerTradeChart(currentData);
  
  // Scroll to the additional charts
  additionalChartsEl.scrollIntoView({ behavior: 'smooth' });
});

exportBtn.addEventListener('click', () => {
  if (!currentData || currentData.length === 0) {
    alert('No data available to export. Please run analysis first.');
    return;
  }
  exportDataAsCSV(currentData);
});

// Initialize
loadPairs().then(() => {
  // Try to run analysis if a pair is already selected
  if (pairEl.value) {
    run();
  }
}).catch(e => statusEl.textContent = e.message);
