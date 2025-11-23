document.addEventListener('DOMContentLoaded', async () => {
    const tokenSelector = document.getElementById('tokenSelector');
    const btnAnalyze = document.getElementById('btnAnalyze');
    const btnTrain = document.getElementById('btnTrain');
    const trainingStatus = document.getElementById('trainingStatus');
    const predictionScore = document.getElementById('predictionScore');
    const predictionLabel = document.getElementById('predictionLabel');
    const activeModelName = document.getElementById('activeModelName');
    const liquidityDisplay = document.getElementById('liquidityDisplay');
    const liquidityValue = document.getElementById('liquidityValue');
    const sensitivityMetric = document.getElementById('sensitivityMetric');
    
    let sensitivityChart = null;
    let currentLiquidityData = new Map();

    // Inputs
    const inputs = {
        diff: document.getElementById('input-diff'),
        dexslip: document.getElementById('input-dexslip'),
        cexslip: document.getElementById('input-cexslip'),
        spread: document.getElementById('input-spread'),
    };

    // Value displays
    const displays = {
        diff: document.getElementById('val-diff'),
        dexslip: document.getElementById('val-dexslip'),
        cexslip: document.getElementById('val-cexslip'),
        spread: document.getElementById('val-spread'),
    };

    // Bind range inputs to displays
    Object.keys(inputs).forEach(key => {
        inputs[key].addEventListener('input', (e) => {
            displays[key].textContent = e.target.value;
        });
    });

    // Fetch available tokens
    async function loadTokens() {
        try {
            // Get tokens from liquidity data or server status
            const resp = await fetch('/status/server'); // Or a dedicated tokens endpoint
            const data = await resp.json();
            if (data && data.sdiff && data.sdiff.tokens) {
                tokenSelector.innerHTML = '<option value="">Select a token...</option>';
                data.sdiff.tokens.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.name;
                    opt.textContent = t.name;
                    tokenSelector.appendChild(opt);
                });
            }
            
            // Also fetch latest liquidity to have it ready
            // We might need a new endpoint for this, but let's try fetching status first
        } catch (err) {
            console.error('Failed to load tokens:', err);
        }
    }

    // Fetch active model metadata
    async function loadModelInfo() {
        try {
            const resp = await fetch('/api/ml/model-info');
            if (resp.ok) {
                const data = await resp.json();
                activeModelName.textContent = data.experiment || 'Unknown Model';
                
                // Render feature importance if available
                if (data.feature_importance) {
                    renderFeatureImportance(data.feature_importance);
                }
            } else {
                activeModelName.textContent = 'Service Unavailable';
            }
        } catch (err) {
            activeModelName.textContent = 'Connection Error';
        }
    }

    // Render Feature Importance
    function renderFeatureImportance(features) {
        const container = document.getElementById('featureImportanceChart');
        if (!features || Object.keys(features).length === 0) {
            container.innerHTML = '<div class="text-muted">No feature importance data available.</div>';
            return;
        }

        let html = '<ul class="feature-importance-list">';
        // Sort by importance
        const sorted = Object.entries(features).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
        const maxVal = Math.max(...sorted.map(s => Math.abs(s[1])));

        sorted.forEach(([name, val]) => {
            const pct = (Math.abs(val) / maxVal) * 100;
            html += `
                <li class="feature-item">
                    <span style="width: 100px;">${name}</span>
                    <div class="feature-bar-bg">
                        <div class="feature-bar-fill" style="width: ${pct}%"></div>
                    </div>
                    <span style="width: 50px; text-align: right;">${val.toFixed(3)}</span>
                </li>
            `;
        });
        html += '</ul>';
        container.innerHTML = html;
    }

    // Analyze Button Click
    btnAnalyze.addEventListener('click', async () => {
        const token = tokenSelector.value;
        if (!token) {
            alert('Please select a token first.');
            return;
        }

        btnAnalyze.disabled = true;
        btnAnalyze.textContent = 'Analyzing...';

        try {
            // 1. Get basic prediction
            const payload = {
                buyDiffBps: Number(inputs.spread.value), // Approximating spread as buy/sell diffs
                sellDiffBps: Number(inputs.spread.value),
                Diff: Number(inputs.diff.value),
                DexSlip: Number(inputs.dexslip.value),
                CexSlip: Number(inputs.cexslip.value),
                // Add dummy context for now, or fetch real context if possible
            };

            const resp = await fetch('/api/ml/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payloads: [payload] })
            });

            const result = await resp.json();
            
            if (result && result.success_probability != null) {
                const prob = result.success_probability;
                const pct = (prob * 100).toFixed(1);
                predictionScore.textContent = `${pct}%`;
                
                // Color coding
                predictionScore.style.color = prob > 0.7 ? 'var(--success)' : (prob < 0.4 ? 'var(--error)' : 'var(--warning)');
                
                if (prob > 0.8) predictionLabel.textContent = 'High Probability of Profit';
                else if (prob > 0.6) predictionLabel.textContent = 'Moderate Probability';
                else predictionLabel.textContent = 'Low Probability / Risky';
            } else {
                predictionScore.textContent = '--';
                predictionLabel.textContent = 'Error in Prediction';
            }

            // 2. Get Liquidity Data
            await fetchLiquidity(token);

            // 3. Run Sensitivity Analysis
            await runSensitivityAnalysis(payload);

        } catch (err) {
            console.error(err);
            alert('Analysis failed. Is the ML service running?');
        } finally {
            btnAnalyze.disabled = false;
            btnAnalyze.textContent = 'Analyze Scenario';
        }
    });

    async function fetchLiquidity(token) {
        try {
            // Normalize token name (e.g. BASE_WETH_123 -> WETH)
            let symbol = token.includes('_') ? token.split('_')[1] : token;
            symbol = symbol.toUpperCase();

            const resp = await fetch(`/api/liquidity/latest?symbol=${symbol}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.liquidity) {
                    liquidityDisplay.style.display = 'inline-flex';
                    liquidityValue.textContent = `$${Number(data.liquidity).toLocaleString()}`;
                } else {
                    liquidityDisplay.style.display = 'none';
                }
            }
        } catch (e) {
            console.error('Liquidity fetch error', e);
            liquidityDisplay.style.display = 'none';
        }
    }

    async function runSensitivityAnalysis(basePayload) {
        const metric = sensitivityMetric.value; // 'diff', 'dexslip', etc.
        const steps = 20;
        const payloads = [];
        const xLabels = [];

        let min, max, step;
        if (metric === 'diff') { min = -1; max = 2; }
        else if (metric === 'dexslip') { min = 0; max = 2; }
        else { min = 0; max = 2; } // cexslip

        step = (max - min) / steps;

        for (let i = 0; i <= steps; i++) {
            const val = min + (i * step);
            const p = { ...basePayload };
            
            if (metric === 'diff') p.Diff = val;
            else if (metric === 'dexslip') p.DexSlip = val;
            else if (metric === 'cexslip') p.CexSlip = val;

            payloads.push(p);
            xLabels.push(val.toFixed(2));
        }

        const resp = await fetch('/api/ml/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payloads })
        });
        const data = await resp.json();
        
        // The response format from proxyMlServicePredict is normalized? 
        // Actually the batch endpoint in app.js might return an array if we set it up that way,
        // or we might need to parse 'probabilities' array from the result.
        // Let's assume standard format: { predictions: [], probabilities: [[fail, success], ...] }
        
        const probs = data.probabilities ? data.probabilities.map(p => p[1]) : [];

        renderSensitivityChart(xLabels, probs, metric);
    }

    function renderSensitivityChart(labels, data, metric) {
        const ctx = document.getElementById('sensitivityChart').getContext('2d');
        const labelMap = {
            'diff': 'Price Difference (%)',
            'dexslip': 'DEX Slippage (%)',
            'cexslip': 'CEX Slippage (%)'
        };

        if (sensitivityChart) {
            sensitivityChart.destroy();
        }

        sensitivityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Success Probability',
                    data: data,
                    borderColor: '#00E5FF',
                    backgroundColor: 'rgba(0, 229, 255, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 0,
                        max: 1,
                        grid: { color: '#333' }
                    },
                    x: {
                        title: { display: true, text: labelMap[metric] },
                        grid: { color: '#333' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }

    // Training Logic
    btnTrain.addEventListener('click', async () => {
        if (!confirm('Training may take several minutes. Continue?')) return;
        
        const modelType = document.getElementById('modelTypeSelector').value;
        btnTrain.disabled = true;
        trainingStatus.className = 'training-status active';
        trainingStatus.textContent = 'Training started... Please wait.';

        try {
            const resp = await fetch('/api/ml/train', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelType })
            });
            
            if (resp.ok) {
                trainingStatus.className = 'training-status active success';
                trainingStatus.textContent = 'Training command issued. Check logs or wait for completion.';
                // Poll for status could be added here
            } else {
                throw new Error('Training request failed');
            }
        } catch (err) {
            trainingStatus.className = 'training-status active error';
            trainingStatus.textContent = 'Error starting training: ' + err.message;
        } finally {
            setTimeout(() => { btnTrain.disabled = false; }, 5000);
        }
    });

    // Sensitivity metric dropdown change
    sensitivityMetric.addEventListener('change', () => {
        // If we have inputs, re-run analysis without clicking button? 
        // Or just let user click Analyze again. Let's trigger click if inputs are set.
        if (predictionScore.textContent !== '--%') {
            btnAnalyze.click();
        }
    });

    loadTokens();
    loadModelInfo();
});
