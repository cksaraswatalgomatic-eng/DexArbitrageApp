const summaryEl = document.getElementById('summary');
const failedTblBody = document.querySelector('#failedTbl tbody');
const failedSearch = document.getElementById('failedSearch');
const reloadBtn = document.getElementById('reloadBtn');

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function fmtNum(n, d = 2) {
  if (!isFinite(n)) return '-';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
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
    const data = await fetchJSON(`/contracts/analysis?serverId=${encodeURIComponent(sid)}&hours=24`);
    renderSummary(data.periods || {}, { address: data.address, chainId: data.chainId });

    for (const f of (data.failed || [])) {
      const tr = document.createElement('tr');
      const hashLabel = `${f.hash.slice(0, 10)}...${f.hash.slice(-8)}`;
      const link = f.link || null;
      const hashCell = link ? `<a href="${link}" target="_blank" rel="noopener">${hashLabel}</a>` : hashLabel;
      const logsIcon = f.traceUrl ? `<a href="${f.traceUrl}" target="_blank" rel="noopener" title="View trace">&#128221;</a>` : '';
      tr.innerHTML = `<td>${f.time}</td><td>${hashCell}</td><td>${f.reason || ''}</td><td>${fmtNum(f.gasFee, 6)}</td><td class="logs-cell">${logsIcon}</td>`;
      failedTblBody.appendChild(tr);
    }
    applyFailedSearch();
  } catch (err) {
    summaryEl.innerHTML = `<span class="text-neg">Error: ${err.message}</span>`;
  }
}

failedSearch.addEventListener('input', applyFailedSearch);
reloadBtn.addEventListener('click', loadData);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadData);
} else {
  loadData();
}
