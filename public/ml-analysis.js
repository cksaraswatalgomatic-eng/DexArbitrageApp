/* eslint-disable no-unused-vars */
document.addEventListener('DOMContentLoaded', () => {
  const mlStatusEl = document.getElementById('mlStatus');
  const mlForm = document.getElementById('mlPredictForm');
  const mlResultEl = document.getElementById('mlPredictResult');
  const mlTopFactorsEl = document.getElementById('mlTopFactors');
  const mlRefreshExplainBtn = document.getElementById('mlRefreshExplainBtn');
  const mlResetBtn = document.getElementById('mlResetBtn');
  const tokenSelectEl = document.getElementById('tokenSelect');
  const trainModelBtn = document.getElementById('trainModelBtn');
  const trainingStatusEl = document.getElementById('trainingStatus');
  const predictionTableBody = document.querySelector('#predictionTable tbody');
  const optimalDiffEl = document.getElementById('optimalDiff');
  const diffChartCanvas = document.getElementById('diffChart');
  const buyBaselineInput = document.getElementById('buyBaseline');
  const sellBaselineInput = document.getElementById('sellBaseline');
  const applySweepBtn = document.getElementById('applySweep');

  let lastDiffData = [];
  let diffChart = null;
  let modelTrained = false;
  let latestFeatureInsights = null;
  let latestChartSummary = null;
  let diffStats = null;
  let buyDiffContexts = new Map();
  let sellDiffContexts = new Map();
  const MIN_DIFF_BPS = -99;
  const MAX_DIFF_BPS = 99;

  const cleanNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const formatNumber = (value, decimals = 2) => {
    const num = cleanNumber(value);
    if (num === null) return '--';
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const formatBps = (value) => {
    const num = cleanNumber(value);
    if (num === null) return '--';
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const formatTime = (value) => {
    if (value == null) return '--';
    if (value instanceof Date) {
      return value.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && Math.abs(numeric) > 1e10) {
        return formatTime(numeric);
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.replace('T', ' ').replace('Z', ' UTC');
      }
      return value;
    }
    if (typeof value === 'number') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
      }
    }
    return '--';
  };

  const median = (values) => {
    const filtered = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!filtered.length) return null;
    const mid = Math.floor(filtered.length / 2);
    return filtered.length % 2 === 0
      ? (filtered[mid - 1] + filtered[mid]) / 2
      : filtered[mid];
  };

  const clampBaseline = (value) => {
    if (!Number.isFinite(value)) return 0;
    if (value < MIN_DIFF_BPS) return MIN_DIFF_BPS;
    if (value > MAX_DIFF_BPS) return MAX_DIFF_BPS;
    return value;
  };

  const parseBaselineInput = (inputEl, fallback) => {
    if (!inputEl) return clampBaseline(fallback ?? 0);
    const parsed = cleanNumber(inputEl.value);
    if (parsed === null) return clampBaseline(fallback ?? 0);
    return clampBaseline(parsed);
  };

  const setBaselineInputs = (stats) => {
    if (buyBaselineInput) {
      const defaultBuy = stats?.latestBuyDiffBps ?? stats?.medianBuyDiffBps;
      buyBaselineInput.value = Number.isFinite(defaultBuy) ? Math.round(defaultBuy) : '';
    }
    if (sellBaselineInput) {
      const defaultSell = stats?.latestSellDiffBps ?? stats?.medianSellDiffBps;
      sellBaselineInput.value = Number.isFinite(defaultSell) ? Math.round(defaultSell) : '';
    }
  };

  const renderSummary = () => {
    const parts = [];
    const feature = latestFeatureInsights?.optimalDiff;
    if (feature) {
      parts.push(`Trade diff wins: ${feature.wins}/${feature.total} (win rate ${(feature.winRate * 100).toFixed(1)}%, avg profit ${formatNumber(feature.avgProfit, 2)})`);
    }
    if (latestChartSummary?.message) {
      parts.push(latestChartSummary.message);
    } else if (latestChartSummary) {
      const {
        configBuy,
        configSell,
        configuredBuyProb,
        configuredSellProb,
        bestBuy,
        bestBuyProb,
        bestSell,
        bestSellProb,
      } = latestChartSummary;
      parts.push(`Baseline buy/sell: ${formatNumber(configBuy, 2)} / ${formatNumber(configSell, 2)} | Best buy ${formatNumber(bestBuy, 2)} (${(bestBuyProb * 100).toFixed(1)}%) | Best sell ${formatNumber(bestSell, 2)} (${(bestSellProb * 100).toFixed(1)}%) | Baseline probs: ${(configuredBuyProb * 100).toFixed(1)}% / ${(configuredSellProb * 100).toFixed(1)}%`);
    }
    optimalDiffEl.textContent = parts.length ? parts.join(' | ') : 'Optimal Diff: --';
  };

  const fetchJSON = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    return response.json();
  };

  const loadTokens = async () => {
    try {
      const tokens = await fetchJSON('/diffdata/tokens');
      tokenSelectEl.innerHTML = '<option value="">-- Select a Token --</option>';
      for (const token of tokens) {
        const opt = document.createElement('option');
        opt.value = token;
        const parts = token.split('_').filter(Boolean);
        opt.textContent = parts[1] || parts[0] || token;
        tokenSelectEl.appendChild(opt);
      }
    } catch (err) {
      console.error('Error loading tokens:', err);
    }
  };


  const clearPredictionTable = (message) => {
    predictionTableBody.innerHTML = '';
    if (message) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="9" class="muted">${message}</td>`;
      predictionTableBody.appendChild(tr);
    }
  };

  const destroyDiffChart = () => {
    if (diffChart) {
      diffChart.destroy();
      diffChart = null;
    }
  };

  const computeBaselines = () => {
    const pickValue = (latest, medianValue, fallbackValue) => {
      const latestNum = cleanNumber(latest);
      if (Number.isFinite(latestNum)) return latestNum;
      const medianNum = cleanNumber(medianValue);
      if (Number.isFinite(medianNum)) return medianNum;
      const fallbackNum = cleanNumber(fallbackValue);
      return Number.isFinite(fallbackNum) ? fallbackNum : 0;
    };

    const dexSlipValues = [];
    const cexSlipValues = [];
    const cexVolValues = [];
    const serverBuyValues = [];
    const serverSellValues = [];
    const dexVolumeValues = [];

    for (const row of lastDiffData) {
      const dex = cleanNumber(row.DexSlip);
      if (dex !== null) dexSlipValues.push(dex);
      const cexSlip = cleanNumber(row.CexSlip);
      if (cexSlip !== null) cexSlipValues.push(cexSlip);
      const cexVol = cleanNumber(row.cexVol);
      if (cexVol !== null) cexVolValues.push(cexVol);
      const sBuy = cleanNumber(row.serverBuy);
      if (sBuy !== null) serverBuyValues.push(sBuy);
      const sSell = cleanNumber(row.serverSell);
      if (sSell !== null) serverSellValues.push(sSell);
      const dVol = cleanNumber(row.dexVolume);
      if (dVol !== null) dexVolumeValues.push(dVol);
    }

    const baselineDexSlip = pickValue(null, null, median(dexSlipValues));
    const baselineCexSlip = pickValue(null, null, median(cexSlipValues));
    const baselineCexVol = pickValue(diffStats?.latestCexVol, diffStats?.medianCexVol, median(cexVolValues));
    const baselineServerBuy = pickValue(diffStats?.latestServerBuy, diffStats?.medianServerBuy, median(serverBuyValues));
    const baselineServerSell = pickValue(diffStats?.latestServerSell, diffStats?.medianServerSell, median(serverSellValues));
    const baselineDexVolume = pickValue(diffStats?.latestDexVolume, diffStats?.medianDexVolume, median(dexVolumeValues));

    return {
      baselineDexSlip,
      baselineCexSlip,
      baselineCexVol,
      baselineServerBuy,
      baselineServerSell,
      baselineDexVolume,
    };
  };

  const getContextForValue = (value, contexts, fallback) => {
    const bucket = clampBaseline(Math.round(value));
    if (contexts.has(bucket)) return contexts.get(bucket);
    for (let offset = 1; offset <= (MAX_DIFF_BPS - MIN_DIFF_BPS); offset += 1) {
      const lower = bucket - offset;
      const upper = bucket + offset;
      if (lower >= MIN_DIFF_BPS && contexts.has(lower)) return contexts.get(lower);
      if (upper <= MAX_DIFF_BPS && contexts.has(upper)) return contexts.get(upper);
    }
    return fallback;
  };

  const buildDiffContexts = () => {
    buyDiffContexts = new Map();
    sellDiffContexts = new Map();

    for (const row of lastDiffData) {
      const buyDiffBps = cleanNumber(row.buyDiffBps);
      const sellDiffBps = cleanNumber(row.sellDiffBps);

      if (Number.isFinite(buyDiffBps)) {
        const bucket = clampBaseline(Math.round(buyDiffBps));
        let contexts = buyDiffContexts.get(bucket);
        if (!contexts) {
          contexts = [];
          buyDiffContexts.set(bucket, contexts);
        }
        contexts.push({
          DexSlip: cleanNumber(row.DexSlip),
          CexSlip: cleanNumber(row.CexSlip),
          cexVol: cleanNumber(row.cexVol),
          serverBuy: cleanNumber(row.serverBuy),
          serverSell: cleanNumber(row.serverSell),
          dexVolume: cleanNumber(row.dexVolume),
        });
      }

      if (Number.isFinite(sellDiffBps)) {
        const bucket = clampBaseline(Math.round(sellDiffBps));
        let contexts = sellDiffContexts.get(bucket);
        if (!contexts) {
          contexts = [];
          sellDiffContexts.set(bucket, contexts);
        }
        contexts.push({
          DexSlip: cleanNumber(row.DexSlip),
          CexSlip: cleanNumber(row.CexSlip),
          cexVol: cleanNumber(row.cexVol),
          serverBuy: cleanNumber(row.serverBuy),
          serverSell: cleanNumber(row.serverSell),
          dexVolume: cleanNumber(row.dexVolume),
        });
      }
    }
  };

  const findNearestIndex = (value, range) => {
    if (!Array.isArray(range) || !range.length) return -1;
    let bestIdx = 0;
    let bestDelta = Math.abs(range[0] - value);
    for (let idx = 1; idx < range.length; idx += 1) {
      const delta = Math.abs(range[idx] - value);
      if (delta < bestDelta) {
        bestIdx = idx;
        bestDelta = delta;
      }
    }
    return bestIdx;
  };

  const findBestIndex = (values) => {
    if (!Array.isArray(values) || !values.length) return -1;
    let bestIdx = 0;
    for (let idx = 1; idx < values.length; idx += 1) {
      if (values[idx] > values[bestIdx]) bestIdx = idx;
    }
    return bestIdx;
  };

  const renderPredictionTable = (curId, diffData = []) => {
    predictionTableBody.innerHTML = '';
    const parts = curId.split('_').filter(Boolean);
    const tokenName = parts[1] || parts[0] || curId;

    if (!diffData.length) {
      clearPredictionTable('No diff history available for this token.');
      return;
    }

    for (const row of diffData) {
      const tr = document.createElement('tr');
      // Prefer values from trade props if available, otherwise use diff data
      // The data from the backend should already have integrated trade features
      const diffVal = cleanNumber(row.Diff);
      const dexSlipVal = cleanNumber(row.DexSlip);
      const cexSlipVal = cleanNumber(row.CexSlip);
      const buyDiffVal = cleanNumber(row.buyDiffBps);
      const sellDiffVal = cleanNumber(row.sellDiffBps);
      const featureTs = row.featureTimestamp ?? row.ts;
      
      // Format values for display
      const displayDiff = diffVal != null ? formatNumber(diffVal, 4) : '--';
      const displayDexSlip = dexSlipVal != null ? formatNumber(dexSlipVal, 4) : '--';
      const displayCexSlip = cexSlipVal != null ? formatNumber(cexSlipVal, 4) : '--';

      tr.innerHTML = `
        <td>${tokenName}</td>
        <td>${formatTime(featureTs)}</td>
        <td>${formatBps(buyDiffVal)}</td>
        <td>${formatBps(sellDiffVal)}</td>
        <td>${displayDiff}</td>
        <td>${displayDexSlip}</td>
        <td>${displayCexSlip}</td>
        <td><button class="btn btn-predict">Predict</button></td>
        <td class="prediction-result">-</td>
      `;

      const predictBtn = tr.querySelector('.btn-predict');
      // Use the values from the data row with fallbacks to 0 if null
      predictBtn.dataset.buyDiff = buyDiffVal != null ? String(buyDiffVal) : '';
      predictBtn.dataset.sellDiff = sellDiffVal != null ? String(sellDiffVal) : '';
      predictBtn.dataset.diff = diffVal != null ? String(diffVal) : '0';
      predictBtn.dataset.dexSlip = dexSlipVal != null ? String(dexSlipVal) : '0';
      predictBtn.dataset.cexSlip = cexSlipVal != null ? String(cexSlipVal) : '0';
      predictBtn.dataset.token = tokenName;
      predictBtn.dataset.timestamp = featureTs != null ? String(featureTs) : '';
      
      // Check if we have enough features for prediction
      const hasAllFeatures = [buyDiffVal, sellDiffVal, diffVal, dexSlipVal, cexSlipVal].every(val => val != null);
      if (!hasAllFeatures) {
        predictBtn.title = 'Some features missing; prediction will use default values for missing features.';
      }

      predictionTableBody.appendChild(tr);
    }
  };

  const buildDiffChart = async () => {
    if (!diffChartCanvas || !window.Chart) return;
    if (!modelTrained) {
      destroyDiffChart();
      latestChartSummary = { message: 'Train the model to view probability sweeps for baseline buy/sell diff settings.' };
      renderSummary();
      return;
    }

    const curId = tokenSelectEl.value;
    if (!curId) {
      destroyDiffChart();
      latestChartSummary = { message: 'Select a token to evaluate buy/sell diff sweeps.' };
      renderSummary();
      return;
    }

    if (!lastDiffData.length) {
      destroyDiffChart();
      latestChartSummary = { message: 'Insufficient diff history to chart predictions for this token.' };
      renderSummary();
      return;
    }

    if (!diffStats) {
      destroyDiffChart();
      latestChartSummary = { message: 'Diff statistics unavailable for this token.' };
      renderSummary();
      return;
    }

    try {
      const defaultBuy = diffStats.latestBuyDiffBps ?? diffStats.medianBuyDiffBps ?? 0;
      const defaultSell = diffStats.latestSellDiffBps ?? diffStats.medianSellDiffBps ?? 0;
      const baseBuy = parseBaselineInput(buyBaselineInput, defaultBuy);
      const baseSell = parseBaselineInput(sellBaselineInput, defaultSell);

      const {
        baselineDexSlip,
        baselineCexSlip,
        baselineCexVol,
        baselineServerBuy,
        baselineServerSell,
        baselineDexVolume,
      } = computeBaselines();

      const baselineContext = {
        DexSlip: baselineDexSlip,
        CexSlip: baselineCexSlip,
        cexVol: baselineCexVol,
        serverBuy: baselineServerBuy,
        serverSell: baselineServerSell,
        dexVolume: baselineDexVolume,
      };

      let buyRange = Array.from(buyDiffContexts.keys()).sort((a, b) => a - b);
      if (!buyRange.length) {
        buyRange = Array.from({ length: MAX_DIFF_BPS - MIN_DIFF_BPS + 1 }, (_, idx) => MIN_DIFF_BPS + idx);
      }

      let sellRange = Array.from(sellDiffContexts.keys()).sort((a, b) => a - b);
      if (!sellRange.length) {
        sellRange = Array.from({ length: MAX_DIFF_BPS - MIN_DIFF_BPS + 1 }, (_, idx) => MIN_DIFF_BPS + idx);
      }

      const MAX_CONTEXT_SAMPLES = 10;

      const buildContextSamples = (value, contextsMap) => {
        const contexts = contextsMap.get(value);
        if (contexts && contexts.length) return contexts.slice(0, MAX_CONTEXT_SAMPLES);
        return [baselineContext];
      };

      const createPayloadsForRange = (range, contextsMap, mode) => {
        const payloads = [];
        const meta = [];
        for (const value of range) {
          const samples = buildContextSamples(value, contextsMap);
          for (const context of samples) {
            // Create payload with the most relevant features for the prediction
            payloads.push({
              buyDiffBps: mode === 'buy' ? value : baseBuy,
              sellDiffBps: mode === 'buy' ? baseSell : value,
              Diff: mode === 'buy' ? value - baseSell : baseBuy - value,
              DexSlip: cleanNumber(context.DexSlip) ?? baselineDexSlip,
              CexSlip: cleanNumber(context.CexSlip) ?? baselineCexSlip,
              cexVol: cleanNumber(context.cexVol) ?? baselineCexVol,
              serverBuy: cleanNumber(context.serverBuy) ?? baselineServerBuy,
              serverSell: cleanNumber(context.serverSell) ?? baselineServerSell,
              dexVolume: cleanNumber(context.dexVolume) ?? baselineDexVolume,
            });
            meta.push({ mode, value });
          }
        }
        return { payloads, meta };
      };

      const { payloads: buyPayloads, meta: buyMeta } = createPayloadsForRange(buyRange, buyDiffContexts, 'buy');
      const { payloads: sellPayloads, meta: sellMeta } = createPayloadsForRange(sellRange, sellDiffContexts, 'sell');
      const payloads = buyPayloads.concat(sellPayloads);
      const meta = buyMeta.concat(sellMeta);
      
      const predictionResponse = await fetchJSON('/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payloads, includeProbabilities: true }),
      });

      const probabilitiesRaw = Array.isArray(predictionResponse?.probabilities) ? predictionResponse.probabilities : [];

      if (!probabilitiesRaw.length) {
        destroyDiffChart();
        latestChartSummary = { message: 'Prediction response did not include probability data for charting.' };
        renderSummary();
        return;
      }

      // Process the probability data properly to handle both array of arrays and flat arrays
      const toProb = (entry) => {
        if (Array.isArray(entry) && entry.length > 1) return cleanNumber(entry[1]) ?? 0;
        if (Array.isArray(entry) && entry.length === 1) return cleanNumber(entry[0]) ?? 0;
        const num = cleanNumber(entry);
        return num !== null ? num : 0;
      };
      const probabilities = probabilitiesRaw.map(toProb);

      const accumulate = (map, key, value) => {
        let entry = map.get(key);
        if (!entry) {
          entry = { sum: 0, count: 0 };
          map.set(key, entry);
        }
        entry.sum += value;
        entry.count += 1;
      };

      const buyProbMap = new Map();
      const sellProbMap = new Map();
      meta.forEach((info, idx) => {
        const prob = probabilities[idx] ?? 0;
        if (info.mode === 'buy') accumulate(buyProbMap, info.value, prob);
        else accumulate(sellProbMap, info.value, prob);
      });

      const computeSeries = (range, agg) => range.map((value) => {
        const stats = agg.get(value);
        const avg = stats && stats.count ? stats.sum / stats.count : 0;
        return { x: value, y: avg };
      });

      const buyDatasetPoints = computeSeries(buyRange, buyProbMap);
      const sellDatasetPoints = computeSeries(sellRange, sellProbMap);
      if (!buyDatasetPoints.length && !sellDatasetPoints.length) {
        destroyDiffChart();
        latestChartSummary = { message: 'Not enough diff history samples to build the sweep.' };
        renderSummary();
        return;
      }

      const buyProbabilities = buyDatasetPoints.map((pt) => pt.y);
      const sellProbabilities = sellDatasetPoints.map((pt) => pt.y);

      const bestBuyIdx = findBestIndex(buyProbabilities);
      const bestSellIdx = findBestIndex(sellProbabilities);

      const configBuyIdx = buyRange.length ? findNearestIndex(baseBuy, buyRange) : -1;
      const configSellIdx = sellRange.length ? findNearestIndex(baseSell, sellRange) : -1;

      latestChartSummary = {
        configBuy: baseBuy,
        configSell: baseSell,
        configuredBuyProb: configBuyIdx >= 0 ? buyProbabilities[configBuyIdx] ?? 0 : 0,
        configuredSellProb: configSellIdx >= 0 ? sellProbabilities[configSellIdx] ?? 0 : 0,
        bestBuy: bestBuyIdx >= 0 ? buyRange[bestBuyIdx] : undefined,
        bestBuyProb: bestBuyIdx >= 0 ? buyProbabilities[bestBuyIdx] ?? 0 : 0,
        bestSell: bestSellIdx >= 0 ? sellRange[bestSellIdx] : undefined,
        bestSellProb: bestSellIdx >= 0 ? sellProbabilities[bestSellIdx] ?? 0 : 0,
      };
      renderSummary();

      destroyDiffChart();
      const highlightPoint = (targetIdx, bestIdx) => (context) => {
        const idx = context.dataIndex;
        if (targetIdx >= 0 && idx === targetIdx) return 6;
        if (bestIdx >= 0 && idx === bestIdx) return 5;
        return idx % 5 === 0 ? 3 : 1.5;
      };

      const highlightColor = (targetIdx, bestIdx, baseColor, bestColor, targetColor) => (context) => {
        const idx = context.dataIndex;
        if (targetIdx >= 0 && idx === targetIdx) return targetColor;
        if (bestIdx >= 0 && idx === bestIdx) return bestColor;
        return baseColor;
      };

      const buildChartDataset = (label, data, targetIdx, bestIdx, baseColor, bestColor, targetColor) => ({
        label,
        data,
        parsing: false,
        showLine: true,
        borderColor: baseColor,
        backgroundColor: baseColor === '#ff9800' ? 'rgba(255, 152, 0, 0.2)' : 'rgba(3, 169, 244, 0.2)',
        fill: false,
        tension: 0.25,
        pointRadius: highlightPoint(targetIdx, bestIdx),
        pointBackgroundColor: highlightColor(targetIdx, bestIdx, baseColor, bestColor, targetColor),
      });

      const ctx = diffChartCanvas.getContext('2d');
      diffChart = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            buildChartDataset(
              `Buy Diff sweep (Sell baseline ${formatNumber(baseSell, 2)})`,
              buyDatasetPoints,
              configBuyIdx,
              bestBuyIdx,
              '#ff9800',
              '#4caf50',
              '#f44336'
            ),
            buildChartDataset(
              `Sell Diff sweep (Buy baseline ${formatNumber(baseBuy, 2)})`,
              sellDatasetPoints,
              configSellIdx,
              bestSellIdx,
              '#03a9f4',
              '#4caf50',
              '#f44336'
            ),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: 'Diff (bps)' },
              suggestedMin: MIN_DIFF_BPS,
              suggestedMax: MAX_DIFF_BPS,
            },
            y: {
              title: { display: true, text: 'Success Probability' },
              min: 0,
              max: 1,
              ticks: { callback: (value) => `${(value * 100).toFixed(0)}%` },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const point = ctx.raw || {};
                  const xVal = point.x ?? ctx.parsed.x;
                  return `${ctx.dataset.label}: ${(ctx.parsed.y * 100).toFixed(2)}% at ${xVal} bps`;
                },
              },
            },
          },
        },
      });
    } catch (err) {
      console.error('Unable to build diff chart:', err);
      destroyDiffChart();
      latestChartSummary = { message: 'Failed to build diff chart. Check console for details.' };
      renderSummary();
    }
  };

  const loadPredictionData = async () => {
    const curId = tokenSelectEl.value;
    lastDiffData = [];
    diffStats = null;
    latestFeatureInsights = null;
    latestChartSummary = null;
    buyDiffContexts = new Map();
    sellDiffContexts = new Map();
    if (!curId) {
      clearPredictionTable('Select a token to view diff history.');
      setBaselineInputs(null);
      renderSummary();
      await buildDiffChart();
      return;
    }

    try {
      const data = await fetchJSON(`/diffdata/history?curId=${encodeURIComponent(curId)}`);
      const diffData = Array.isArray(data?.diffData) ? data.diffData : [];
      lastDiffData = diffData;
      buildDiffContexts();
      diffStats = data?.diffStats || null;
      latestFeatureInsights = data?.featureInsights || null;
      setBaselineInputs(diffStats);
      renderSummary();
      renderPredictionTable(curId, diffData);
      
      // Log insights about trade correlation with diff data
      if (latestFeatureInsights && latestFeatureInsights.buckets && latestFeatureInsights.buckets.length > 0) {
        console.log("Trade feature insights available for prediction:", latestFeatureInsights);
        const tradeCount = latestFeatureInsights.buckets.reduce((sum, bucket) => sum + bucket.total, 0);
        if (tradeCount > 0) {
          console.log(`Found ${tradeCount} trades correlated with diff data for ${curId}`);
        }
      } else {
        console.log(`No trade feature insights for ${curId}. The model might not have trade outcomes to learn from.`);
      }
    } catch (err) {
      console.error('Error loading prediction data:', err);
      clearPredictionTable('Failed to load diff history. See console for details.');
      lastDiffData = [];
      diffStats = null;
      latestFeatureInsights = null;
      renderSummary();
    }

    await buildDiffChart();
  };

  const trainModel = async () => {
    trainingStatusEl.textContent = 'Training in progress...';
    try {
      const result = await fetchJSON('/ml/train', { method: 'POST' });
      trainingStatusEl.textContent = result.message || 'Model trained successfully.';
      modelTrained = true;
      await buildDiffChart();
    } catch (err) {
      trainingStatusEl.textContent = `Error: ${err.message}`;
    }
  };

  const predict = async (event) => {
    const target = event.target;
    if (!target.classList.contains('btn-predict')) return;

    // Get features from the button's dataset
    const buyDiff = cleanNumber(target.dataset.buyDiff);
    const sellDiff = cleanNumber(target.dataset.sellDiff);
    const diff = cleanNumber(target.dataset.diff);
    const dexSlip = cleanNumber(target.dataset.dexSlip);
    const cexSlip = cleanNumber(target.dataset.cexSlip);

    // Ensure we have valid numbers, defaulting to 0 if null
    const features = {
      buyDiffBps: buyDiff != null ? buyDiff : 0,
      sellDiffBps: sellDiff != null ? sellDiff : 0,
      Diff: diff != null ? diff : 0,
      DexSlip: dexSlip != null ? dexSlip : 0,
      CexSlip: cexSlip != null ? cexSlip : 0,
    };

    const resultCell = target.parentElement.nextElementSibling;
    resultCell.textContent = 'Predicting...';

    try {
      const result = await fetchJSON('/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(features),
      });
      
      // Extract probability from the result
      let probability = cleanNumber(result?.success_probability);
      
      // If no success_probability, try to extract from probabilities array
      if (probability === null && Array.isArray(result?.probabilities)) {
        const probs = result.probabilities;
        if (probs.length > 0) {
          // If probabilities is an array of arrays (e.g., [[0.3, 0.7], [0.1, 0.9]]), take the second value from the first array
          if (Array.isArray(probs[0]) && probs[0].length > 1) {
            probability = probs[0][1];
          } else {
            // If it's a flat array of probabilities (e.g., [0.7, 0.9])
            probability = probs[0];
          }
        }
      }
      
      resultCell.textContent = probability === null ? 'Unknown' : `${(probability * 100).toFixed(2)}%`;
    } catch (err) {
      resultCell.textContent = 'Error';
      console.error('Prediction failed:', err);
    }
  };

  trainModelBtn.addEventListener('click', trainModel);
  tokenSelectEl.addEventListener('change', () => {
    loadPredictionData();
  });
  predictionTableBody.addEventListener('click', predict);
  applySweepBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    if (modelTrained) {
      buildDiffChart();
    }
  });
  buyBaselineInput?.addEventListener('change', () => {
    if (modelTrained) buildDiffChart();
  });
  sellBaselineInput?.addEventListener('change', () => {
    if (modelTrained) buildDiffChart();
  });

  clearPredictionTable('Select a token to view diff history.');
  renderSummary();
  loadTokens();

  function sanitizeFormValue(value) {
    if (value == null) return undefined;
    const trimmed = String(value).trim();
    if (!trimmed) return undefined;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'true' || lowered === 'false') return lowered === 'true';
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
    return trimmed;
  }

  async function loadMlMetadata() {
    if (!mlStatusEl) return;
    try {
      mlStatusEl.textContent = 'Loading model metadata...';
      const metadata = await fetchJSON('/ml/metadata');
      const config = metadata.config || {};
      const dataset = metadata.dataset || {};
      const featureCount = Array.isArray(metadata.features?.all) ? metadata.features.all.length : undefined;
      const bits = [];
      if (config.task) bits.push(`<strong>Task:</strong> ${config.task}`);
      if (config.model_type) bits.push(`<strong>Model:</strong> ${config.model_type}`);
      if (featureCount) bits.push(`<strong>Features:</strong> ${featureCount}`);
      if (dataset.time_start && dataset.time_end) bits.push(`<strong>Window:</strong> ${dataset.time_start} -> ${dataset.time_end}`);
      mlStatusEl.innerHTML = bits.length ? bits.join(' &bull; ') : 'Model metadata loaded.';
    } catch (err) {
      mlStatusEl.innerHTML = `<span class="text-neg">Metadata error: ${err.message}</span>`;
    }
  }

  async function loadMlExplain(topK = 10) {
    if (!mlTopFactorsEl) return;
    try {
      mlTopFactorsEl.textContent = 'Loading top contributing factors...';
      const data = await fetchJSON(`/ml/explain?topK=${encodeURIComponent(topK)}`);
      const factors = data.feature_importance || data.features || [];
      if (!Array.isArray(factors) || !factors.length) {
        mlTopFactorsEl.textContent = 'No feature importance data available.';
        return;
      }
      const rows = factors.map(([name, score]) => `<li><code>${name}</code> - ${formatNumber(Number(score), 4)}</li>`).join('');
      mlTopFactorsEl.innerHTML = `<strong>Top Factors:</strong><ul class="compact-list">${rows}</ul>`;
    } catch (err) {
      mlTopFactorsEl.innerHTML = `<span class="text-neg">Failed to load factors: ${err.message}</span>`;
    }
  }

  async function submitMlPrediction(event) {
    event.preventDefault();
    if (!mlForm || !mlResultEl) return;
    const formData = new FormData(mlForm);
    const payload = {};
    for (const [key, val] of formData.entries()) {
      const clean = sanitizeFormValue(val);
      if (clean !== undefined) payload[key] = clean;
    }
    if (!Object.keys(payload).length) {
      mlResultEl.innerHTML = '<span class="text-neg">Enter at least one feature to request a prediction.</span>';
      return;
    }
    try {
      mlResultEl.textContent = 'Scoring...';
      const resp = await fetch('/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payloads: [payload] }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      const parts = [];
      if (Array.isArray(body.predictions) && body.predictions.length) {
        parts.push(`<strong>Prediction:</strong> ${formatNumber(Number(body.predictions[0]), 4)}`);
      }
      if (Array.isArray(body.probabilities) && Array.isArray(body.probabilities[0])) {
        const probs = body.probabilities[0];
        const positive = probs[probs.length - 1];
        if (positive !== undefined) {
          parts.push(`<strong>Success Prob.:</strong> ${formatNumber(Number(positive) * 100, 2)}%`);
        }
      }
      mlResultEl.innerHTML = parts.length ? parts.join(' &bull; ') : 'Prediction completed.';
    } catch (err) {
      mlResultEl.innerHTML = `<span class="text-neg">Prediction error: ${err.message}</span>`;
    }
  }

  function resetMlForm() {
    if (!mlForm) return;
    mlForm.reset();
    if (mlResultEl) mlResultEl.textContent = '';
  }

  if (mlForm) {
    mlForm.addEventListener('submit', submitMlPrediction);
  }
  if (mlResetBtn) {
    mlResetBtn.addEventListener('click', resetMlForm);
  }
  if (mlRefreshExplainBtn) {
    mlRefreshExplainBtn.addEventListener('click', () => loadMlExplain());
  }

  if (mlStatusEl) loadMlMetadata();
  if (mlTopFactorsEl) loadMlExplain();

  // Dropdown menu logic
  const navDropdownButton = document.getElementById('nav-dropdown-button');
  const navDropdown = document.getElementById('nav-dropdown');

  if (navDropdownButton && navDropdown) {
    navDropdownButton.addEventListener('click', (event) => {
      event.stopPropagation(); // Prevent document click from closing immediately
      navDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
      if (!navDropdown.contains(event.target) && !navDropdownButton.contains(event.target)) {
        navDropdown.classList.remove('open');
      }
    });
  }
});

