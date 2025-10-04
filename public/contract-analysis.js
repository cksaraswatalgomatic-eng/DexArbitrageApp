const summaryEl = document.getElementById('summary');
const failedTblBody = document.querySelector('#failedTbl tbody');
const failedSearch = document.getElementById('failedSearch');
const reloadBtn = document.getElementById('reloadBtn');
const mlStatusEl = document.getElementById('mlStatus');
const mlForm = document.getElementById('mlPredictForm');
const mlResultEl = document.getElementById('mlPredictResult');
const mlTopFactorsEl = document.getElementById('mlTopFactors');
const mlRefreshExplainBtn = document.getElementById('mlRefreshExplainBtn');
const mlResetBtn = document.getElementById('mlResetBtn');

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function fmtNum(n, d = 2) {
  if (!isFinite(n)) return '-';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

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
    const rows = factors.map(([name, score]) => `<li><code>${name}</code> - ${fmtNum(Number(score), 4)}</li>`).join('');
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
      parts.push(`<strong>Prediction:</strong> ${fmtNum(Number(body.predictions[0]), 4)}`);
    }
    if (Array.isArray(body.probabilities) && Array.isArray(body.probabilities[0])) {
      const probs = body.probabilities[0];
      const positive = probs[probs.length - 1];
      if (positive !== undefined) {
        parts.push(`<strong>Success Prob.:</strong> ${fmtNum(Number(positive) * 100, 2)}%`);
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

function renderSummary(periods, meta = {}) {
  const keys = ['1h', '4h', '8h', '12h', '24h'];
  const parts = [];
  if (meta.address) parts.push(`Contract: <code>${meta.address}</code>`);
  if (meta.chainId) parts.push(`Chain ID: ${meta.chainId}`);
  const header = parts.length ? `<p class="muted">${parts.join(' &bull; ')}</p>` : '';

  let html = `${header}<div class="table-wrap"><table><thead><tr><th>Period</th><th>Success</th><th>Fail</th><th>Success Rate</th></tr></thead><tbody>`;
  for (const k of keys) {
    const p = periods[k] || { success: 0, fail: 0 };
    const total = (p.success || 0) + (p.fail || 0);
    const rate = total ? ((p.success / total) * 100) : 0;
    html += `<tr><td>${k}</td><td class="text-pos">${p.success || 0}</td><td class="${(p.fail || 0) > 0 ? 'text-neg' : ''}">${p.fail || 0}</td><td>${fmtNum(rate, 1)}%</td></tr>`;
  }
  html += '</tbody></table></div>';
  summaryEl.innerHTML = html;
}

function applyFailedSearch() {
  const q = (failedSearch.value || '').toLowerCase();
  Array.from(failedTblBody.rows).forEach((row) => {
    row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function loadData() {
  summaryEl.innerHTML = '<span class="muted">Loading...</span>';
  failedTblBody.innerHTML = '';
  try {
    const cfg = await (await fetch('/servers')).json();
    const sid = cfg.activeId;
    if (mlForm?.elements?.serverId && !mlForm.elements.serverId.value) {
      mlForm.elements.serverId.value = sid;
    }
    const data = await fetchJSON(`/contracts/analysis?serverId=${encodeURIComponent(sid)}&hours=24`);
    renderSummary(data.periods || {}, { address: data.address, chainId: data.chainId });

    for (const f of (data.failed || [])) {
      const tr = document.createElement('tr');
      const hashLabel = `${f.hash.slice(0, 10)}...${f.hash.slice(-8)}`;
      const link = f.link || null;
      const hashCell = link ? `<a href="${link}" target="_blank" rel="noopener">${hashLabel}</a>` : hashLabel;
      const logsIcon = f.traceUrl ? `<a href="${f.traceUrl}" target="_blank" rel="noopener" title="View trace">&#128221;</a>` : '';
      tr.innerHTML = `<td>${f.time}</td><td>${hashCell}</td><td>${f.reason || ''}</td><td>${fmtNum(f.gasFee, 2)}</td><td class="logs-cell">${logsIcon}</td>`;
      failedTblBody.appendChild(tr);
    }
    applyFailedSearch();
  } catch (err) {
    summaryEl.innerHTML = `<span class="text-neg">Error: ${err.message}</span>`;
  }
}

failedSearch.addEventListener('input', applyFailedSearch);
reloadBtn.addEventListener('click', loadData);
if (mlForm) {
  mlForm.addEventListener('submit', submitMlPrediction);
}
if (mlResetBtn) {
  mlResetBtn.addEventListener('click', resetMlForm);
}
if (mlRefreshExplainBtn) {
  mlRefreshExplainBtn.addEventListener('click', () => loadMlExplain());
}

function initContractAnalysis() {
  loadData();
  if (mlStatusEl) loadMlMetadata();
  if (mlTopFactorsEl) loadMlExplain();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initContractAnalysis);
} else {
  initContractAnalysis();
}
