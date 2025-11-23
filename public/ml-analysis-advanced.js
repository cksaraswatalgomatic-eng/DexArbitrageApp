document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

let scatterChart = null;
let distChart = null;
let analysisData = [];

function formatMoney(val) {
    if (val === null || val === undefined) return '0.00';
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function initDashboard() {
    // auth-check.js handles redirect
    // servers-client.js handles header server selector

    loadModelInfo();
    
    document.getElementById('btnRunAnalysis').addEventListener('click', runAnalysis);
    document.getElementById('btnOpenTrain').addEventListener('click', () => {
        document.getElementById('trainModal').style.display = 'block';
    });
    document.getElementById('btnConfirmTrain').addEventListener('click', startTraining);
    
    // Initial analysis run
    runAnalysis();
}

async function loadModelInfo() {
    try {
        const res = await fetch('/api/ml/model-info');
        if (res.ok) {
            const meta = await res.json();
            const modelType = meta.config?.model_type || 'Unknown';
            const date = meta.dataset?.time_end ? new Date(meta.dataset.time_end).toLocaleDateString() : 'Unknown';
            document.getElementById('activeModelDisplay').textContent = `${modelType} (${date})`;
            
            if (meta.holdout) {
                // Assuming classification metrics
                const acc = meta.holdout.precision || meta.holdout.accuracy || 0; // Simplified
                document.getElementById('statModelAcc').textContent = (acc * 100).toFixed(1) + '%';
            }
        }
    } catch (e) {
        console.error('Failed to load model info', e);
    }
}

async function runAnalysis() {
    const btn = document.getElementById('btnRunAnalysis');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    
    // Get active server
    const serverId = document.getElementById('serverSelect').value;
    const limit = document.getElementById('limitSelect').value;

    try {
        const url = `/api/ml/analysis?limit=${limit}&servers=${serverId}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        analysisData = data;
        updateStats(data);
        render3DChart(data);
        renderTable(data);
        
    } catch (e) {
        console.error(e);
        alert('Analysis failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Run Market Analysis';
    }
}

function updateStats(data) {
    const highProb = data.filter(d => d.probability > 0.8).length;
    const avgProb = data.reduce((sum, d) => sum + (d.probability||0), 0) / (data.length || 1);
    const totalVol = data.reduce((sum, d) => sum + (d.liquidity||0), 0);
    
    document.getElementById('statHighProb').textContent = highProb;
    document.getElementById('statAvgProb').textContent = (avgProb * 100).toFixed(1) + '%';
    document.getElementById('statTotalVol').textContent = '$' + formatMoney(totalVol);
}

function render3DChart(data) {
    const container = 'scatterChart3D';
    
    // Allow plotting all points, even if liquidity/price is 0.
    // The model still returned a probability for them.
    const cleanData = data; 
    
    const trace = {
        x: cleanData.map(d => d.buyDiffBps || 0), // X: Spread (Buy Diff)
        y: cleanData.map(d => d.dexSlip || 0),    // Y: Slippage (DEX)
        z: cleanData.map(d => d.probability * 100),
        text: cleanData.map(d => `${d.token}<br>BuyDiff: ${d.buyDiffBps}<br>DexSlip: ${d.dexSlip}`),
        mode: 'markers',
        marker: {
            size: 5,
            color: cleanData.map(d => d.probability),
            colorscale: 'Viridis',
            opacity: 0.8
        },
        type: 'scatter3d'
    };

    const layout = {
        margin: {l: 0, r: 0, b: 0, t: 0},
        scene: {
            xaxis: { title: 'Buy Diff (Bps)' },
            yaxis: { title: 'DEX Slip (Bps)' },
            zaxis: { title: 'Profit Prob (%)' }
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#aaa' }
    };

    Plotly.newPlot(container, [trace], layout, {responsive: true});
}

function renderTable(data) {
    const tbody = document.getElementById('topTokensTableBody');
    tbody.innerHTML = '';
    
    // Sort by probability desc
    const sorted = [...data].sort((a, b) => (b.probability || 0) - (a.probability || 0));
    
    // Top 50
    sorted.slice(0, 50).forEach(row => {
        const tr = document.createElement('tr');
        const probPct = ((row.probability || 0) * 100).toFixed(1);
        const isHigh = row.probability > 0.8;
        
        tr.innerHTML = `
            <td><span class="token-badge">${row.token.toUpperCase()}</span></td>
            <td>$${formatMoney(row.price)}</td>
            <td>$${formatMoney(row.liquidity)}</td>
            <td>${row.spread?.toFixed(1) || '--'}</td>
            <td style="color: ${isHigh ? '#00E5FF' : 'inherit'}; font-weight: ${isHigh ? 'bold' : 'normal'}">
                ${probPct}%
            </td>
            <td>--</td>
            <td>
                <button class="btn-xs btn-primary" onclick="showTokenDetails('${row.token}')">
                    View Details
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function showTokenDetails(token) {
    const row = analysisData.find(d => d.token === token);
    if (!row) return;
    
    // Show section
    const section = document.getElementById('tokenDetailsSection');
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth' });
    
    // Fill metrics
    document.getElementById('detailTokenName').textContent = token.toUpperCase();
    document.getElementById('detailProb').textContent = ((row.probability||0)*100).toFixed(1) + '%';
    document.getElementById('detailLiq').textContent = '$' + formatMoney(row.liquidity);
    document.getElementById('detailPrice').textContent = '$' + formatMoney(row.price);
    document.getElementById('detailSpread').textContent = row.spread?.toFixed(1) || '--';
    
    document.getElementById('btnViewPairDetail').onclick = () => {
        window.location.href = `/pair-analysis.html?token=${token}`;
    };

    // Run Heatmap Analysis (Sensitivity)
    runHeatmapAnalysis(token, row.spread || 0.1);
}

async function runHeatmapAnalysis(token, baseSpread) {
    // We want to see Probability vs Price Diff (X) and Dex Slip (Y)
    const xSteps = 10; // Price Diff
    const ySteps = 10; // Dex Slip
    
    const xValues = []; // Diff range: -1% to 2%
    const yValues = []; // Slip range: 0% to 3%
    
    for(let i=0; i<xSteps; i++) xValues.push(-1 + (3 * i/xSteps));
    for(let i=0; i<ySteps; i++) yValues.push(0 + (3 * i/ySteps));
    
    const payloads = [];
    
    // Create grid
    for (let y of yValues) {
        for (let x of xValues) {
            payloads.push({
                buyDiffBps: x * 100,
                sellDiffBps: x * 100,
                Diff: x,
                DexSlip: y,
                CexSlip: 0.1, // Constant
                // Other features default to 0 or model mean (handled by backend/script logic if robust)
            });
        }
    }
    
    try {
        const resp = await fetch('/api/ml/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payloads })
        });
        const res = await resp.json();
        const probs = res.probabilities ? res.probabilities.map(p => p[1]) : [];
        
        // Reshape 1D array to 2D for heatmap
        const zData = [];
        let k = 0;
        for (let i=0; i<ySteps; i++) {
            const row = [];
            for (let j=0; j<xSteps; j++) {
                row.push(probs[k++] * 100);
            }
            zData.push(row);
        }
        
        renderHeatmap(xValues, yValues, zData);
        
    } catch (e) {
        console.error('Heatmap failed', e);
    }
}

function renderHeatmap(x, y, z) {
    const data = [{
        z: z,
        x: x.map(v => v.toFixed(1) + '%'),
        y: y.map(v => v.toFixed(1) + '%'),
        type: 'heatmap',
        colorscale: 'Viridis',
        colorbar: { title: 'Prob (%)' }
    }];
    
    const layout = {
        title: 'Profitability Heatmap: Diff vs DexSlip',
        xaxis: { title: 'Price Difference (Diff)' },
        yaxis: { title: 'DEX Slippage' },
        margin: { t: 40, b: 40, l: 50, r: 0 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#aaa' }
    };
    
    Plotly.newPlot('heatmapContainer', data, layout, {responsive: true});
}

async function startTraining() {
    const modelType = document.getElementById('trainModelType').value;
    const target = document.getElementById('trainTarget').value; // 'classification' or 'regression'
    
    const statusDiv = document.getElementById('trainStatus');
    statusDiv.textContent = 'Requesting training...';
    
    try {
        const res = await fetch('/api/ml/train', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelType, task: target })
        });
        const json = await res.json();
        if (res.ok) {
            statusDiv.textContent = `Training started (PID: ${json.pid}). This may take several minutes. Check server logs or refresh later.`;
            setTimeout(() => { document.getElementById('trainModal').style.display = 'none'; }, 3000);
        } else {
            statusDiv.textContent = 'Error: ' + json.error;
        }
    } catch (e) {
        statusDiv.textContent = 'Error: ' + e.message;
    }
}

// ... existing code ...

function render3DChart(data) {
    const container = 'scatterChart3D';
    const cleanData = data; 
    
    // Determine if we are showing Probability or Prediction (ROI)
    // Check if probabilities are all 0 or 1 (hard class) or null
    const isRegression = data.every(d => d.probability == null);
    
    const zValues = isRegression ? cleanData.map(d => d.prediction) : cleanData.map(d => d.probability * 100);
    const zLabel = isRegression ? 'Predicted ROI ($)' : 'Profit Prob (%)'; // Assuming regression target is netProfit or ROI

    const trace = {
        x: cleanData.map(d => d.buyDiffBps || 0), 
        y: cleanData.map(d => d.dexSlip || 0),
        z: zValues,
        text: cleanData.map(d => `${d.token}<br>BuyDiff: ${d.buyDiffBps}<br>DexSlip: ${d.dexSlip}`),
        mode: 'markers',
        marker: {
            size: 5,
            color: zValues,
            colorscale: 'Viridis',
            opacity: 0.8
        },
        type: 'scatter3d'
    };

    const layout = {
        margin: {l: 0, r: 0, b: 0, t: 0},
        scene: {
            xaxis: { title: 'Buy Diff (Bps)' },
            yaxis: { title: 'DEX Slip (Bps)' },
            zaxis: { title: zLabel }
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#aaa' }
    };

    Plotly.newPlot(container, [trace], layout, {responsive: true});
}
