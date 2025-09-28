document.addEventListener('DOMContentLoaded', () => {
    const tokenSelectEl = document.getElementById('tokenSelect');
    const trainModelBtn = document.getElementById('trainModelBtn');
    const trainingStatusEl = document.getElementById('trainingStatus');
    const predictionTableBody = document.querySelector('#predictionTable tbody');

    async function fetchJSON(url, options = {}) {
        const r = await fetch(url, options); 
        if (!r.ok) {
            const errorText = await r.text();
            throw new Error(`HTTP ${r.status}: ${errorText}`);
        }
        return r.json();
    }

    async function loadTokens() {
        try {
            const tokens = await fetchJSON('/diffdata/tokens');
            tokenSelectEl.innerHTML = '<option value="">-- Select a Token --</option>';
            for (const token of tokens) {
                const opt = document.createElement('option');
                opt.value = token;
                opt.textContent = token.split('_')[1];
                tokenSelectEl.appendChild(opt);
            }
        } catch (err) {
            console.error('Error loading tokens:', err);
        }
    }

    async function loadPredictionData() {
        const curId = tokenSelectEl.value;
        if (!curId) {
            predictionTableBody.innerHTML = '';
            return;
        }

        try {
            const data = await fetchJSON(`/diffdata/history?curId=${curId}`);
            const { diffData } = data;
            
            predictionTableBody.innerHTML = '';
            for (const d of diffData) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${curId.split('_')[1]}</td>
                    <td>${d.buyDiffBps}</td>
                    <td>${d.sellDiffBps}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td><button class="btn btn-predict" data-buy-diff="${d.buyDiffBps}" data-sell-diff="${d.sellDiffBps}">Predict</button></td>
                    <td class="prediction-result">-</td>
                `;
                predictionTableBody.appendChild(tr);
            }
        } catch (err) {
            console.error('Error loading prediction data:', err);
        }
    }

    async function trainModel() {
        trainingStatusEl.textContent = 'Training in progress...';
        try {
            const result = await fetchJSON('/ml/train', { method: 'POST' });
            trainingStatusEl.textContent = result.message;
        } catch (err) {
            trainingStatusEl.textContent = `Error: ${err.message}`;
        }
    }

    async function predict(event) {
        const target = event.target;
        if (!target.classList.contains('btn-predict')) return;

        const buyDiffBps = target.dataset.buyDiff;
        const sellDiffBps = target.dataset.sellDiff;
        
        // Using dummy values for Diff, DexSlip, CexSlip as they are not available yet.
        const features = {
            buyDiffBps: parseFloat(buyDiffBps),
            sellDiffBps: parseFloat(sellDiffBps),
            Diff: 0, 
            DexSlip: 0,
            CexSlip: 0
        };

        const resultCell = target.parentElement.nextElementSibling;
        resultCell.textContent = 'Predicting...';

        try {
            const result = await fetchJSON('/ml/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(features)
            });
            resultCell.textContent = `${(result.success_probability * 100).toFixed(2)}%`;
        } catch (err) {
            resultCell.textContent = 'Error';
            console.error('Prediction failed:', err);
        }
    }

    trainModelBtn.addEventListener('click', trainModel);
    tokenSelectEl.addEventListener('change', loadPredictionData);
    predictionTableBody.addEventListener('click', predict);

    loadTokens();
});