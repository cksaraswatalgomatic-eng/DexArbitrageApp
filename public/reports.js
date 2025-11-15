(() => {
  const SAVED_VIEWS_KEY = 'reportsSavedViews';
  const DEFAULT_PAGE_SIZE = 50;

  const state = {
    filtersPayload: null,
    uiState: null,
    summary: null,
    trades: [],
    options: {},
    pagination: { page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 },
    breakdown: createEmptyBreakdown(),
    activeTab: 'overview',
  };

  function createEmptyBreakdown() {
    return { pairs: [], totalPairs: 0, generatedAt: null };
  }

  const elements = {};
  const charts = {
    balances: null,
    trade: null,
    pnlHist: null,
    returnHist: null,
  };

  const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const percentFmt = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });

  function getCssVar(name, fallback) {
    const styles = getComputedStyle(document.documentElement);
    const value = styles.getPropertyValue(name);
    return value && value.trim() ? value.trim() : fallback;
  }

  function getChartThemeColors() {
    return {
      text: getCssVar('--text-primary', '#C9D1D9'),
      muted: getCssVar('--text-muted', '#8B949E'),
      grid: getCssVar('--border-color', '#30363D'),
    };
  }

  function applyChartThemeDefaults() {
    if (!window.Chart) return;
    const colors = getChartThemeColors();
    Chart.defaults.color = colors.text;
    Chart.defaults.borderColor = colors.grid;
    Chart.defaults.plugins = Chart.defaults.plugins || {};
    Chart.defaults.plugins.legend = Chart.defaults.plugins.legend || {};
    Chart.defaults.plugins.legend.labels = Chart.defaults.plugins.legend.labels || {};
    Chart.defaults.plugins.legend.labels.color = colors.text;
    Chart.defaults.plugins.tooltip = Chart.defaults.plugins.tooltip || {};
    Chart.defaults.plugins.tooltip.titleColor = colors.text;
    Chart.defaults.plugins.tooltip.bodyColor = colors.text;
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    applyChartThemeDefaults();
    wireEvents();
    toggleCustomRange();
    setDefaultCustomRange();
    loadSavedViews();
    loadOptions().finally(() => applyFilters());
  });

  function cacheElements() {
    elements.timePreset = document.getElementById('timePreset');
    elements.timeStart = document.getElementById('timeStart');
    elements.timeEnd = document.getElementById('timeEnd');
    elements.customRangeGroup = document.getElementById('customRangeGroup');
    elements.tokenFilter = document.getElementById('tokenFilter');
    elements.execFilter = document.getElementById('execFilter');
    elements.dexFilter = document.getElementById('dexFilter');
    elements.hedgeFilter = document.getElementById('hedgeFilter');
    elements.diffMin = document.getElementById('diffMin');
    elements.diffMax = document.getElementById('diffMax');
    elements.dexSlipMin = document.getElementById('dexSlipMin');
    elements.dexSlipMax = document.getElementById('dexSlipMax');
    elements.cexSlipMin = document.getElementById('cexSlipMin');
    elements.cexSlipMax = document.getElementById('cexSlipMax');
    elements.lhDeltaMin = document.getElementById('lhDeltaMin');
    elements.lhDeltaMax = document.getElementById('lhDeltaMax');
    elements.applyBtn = document.getElementById('applyFilters');
    elements.resetBtn = document.getElementById('resetFilters');
    elements.saveViewBtn = document.getElementById('saveViewBtn');
    elements.savedViews = document.getElementById('savedViews');
    elements.reloadBtn = document.getElementById('reloadReports');
    elements.status = document.getElementById('reports-status');
    elements.filtersSummary = document.getElementById('filters-summary');
    elements.kpis = document.querySelectorAll('[data-kpi]');
    elements.tradesBody = document.getElementById('tradesBody');
    elements.tradesPageInfo = document.getElementById('tradesPageInfo');
    elements.prevPage = document.getElementById('prevPage');
    elements.nextPage = document.getElementById('nextPage');
    elements.exportTradesBtn = document.getElementById('exportTradesCsv');
    elements.exportSummaryBtn = document.getElementById('exportSummaryCsv');
    elements.generateReportBtn = document.getElementById('generateReportBtn');
    elements.exportPairsBtn = document.getElementById('exportPairsCsv');
    elements.rawDialog = document.getElementById('rawTradeDialog');
    elements.rawDialogContent = document.getElementById('rawTradeContent');
    elements.rawDialogClose = document.getElementById('closeRawDialog');
    elements.tabButtons = document.querySelectorAll('.tab-btn[data-tab]');
    elements.tabPanels = document.querySelectorAll('[data-tab-panel]');
    elements.pairTableBody = document.getElementById('pairBreakdownBody');
    elements.pairSummary = document.getElementById('pairBreakdownSummary');
  }

  function wireEvents() {
    elements.timePreset.addEventListener('change', () => {
      toggleCustomRange();
      if (elements.timePreset.value !== 'custom') {
        applyFilters();
      }
    });
    elements.applyBtn.addEventListener('click', () => applyFilters());
    elements.resetBtn.addEventListener('click', () => {
      resetControls();
      applyFilters();
    });
    elements.saveViewBtn.addEventListener('click', saveCurrentView);
    elements.savedViews.addEventListener('change', (event) => {
      const name = event.target.value;
      if (!name) return;
      const saved = getSavedViews()[name];
      if (saved) {
        setControlsFromState(saved);
        applyFilters();
      }
      event.target.value = '';
    });
    elements.prevPage.addEventListener('click', () => {
      if (state.pagination.page > 1) {
        loadTradesPage(state.pagination.page - 1);
      }
    });
    elements.nextPage.addEventListener('click', () => {
      if (state.pagination.totalPages && state.pagination.page < state.pagination.totalPages) {
        loadTradesPage(state.pagination.page + 1);
      }
    });
    elements.reloadBtn.addEventListener('click', () => {
      if (!state.filtersPayload) {
        applyFilters();
      } else {
        refreshAll();
      }
    });
    elements.exportTradesBtn.addEventListener('click', exportTradesCsv);
    elements.exportSummaryBtn.addEventListener('click', exportSummaryCsv);
    elements.generateReportBtn.addEventListener('click', openPrintableReport);
    if (elements.exportPairsBtn) {
      elements.exportPairsBtn.addEventListener('click', exportPairsCsv);
    }
    if (elements.rawDialog && elements.rawDialogClose) {
      elements.rawDialogClose.addEventListener('click', () => elements.rawDialog.close());
    }
    if (elements.tabButtons && elements.tabButtons.length) {
      elements.tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          setActiveTab(btn.dataset.tab);
        });
      });
      setActiveTab(state.activeTab);
    }
  }

  function setActiveTab(tab) {
    if (!tab) return;
    state.activeTab = tab;
    if (elements.tabButtons && elements.tabButtons.length) {
      elements.tabButtons.forEach((btn) => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }
    if (elements.tabPanels && elements.tabPanels.length) {
      elements.tabPanels.forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.tabPanel === tab);
      });
    }
  }

  function toggleCustomRange() {
    const showCustom = elements.timePreset.value === 'custom';
    elements.customRangeGroup.style.display = showCustom ? 'flex' : 'none';
  }

  function setDefaultCustomRange() {
    const end = Date.now();
    const start = end - (7 * 24 * 60 * 60 * 1000);
    elements.timeStart.value = toLocalDateInput(start);
    elements.timeEnd.value = toLocalDateInput(end);
  }

  function readFiltersFromControls() {
    const preset = elements.timePreset.value;
    const tokens = getSelectValues(elements.tokenFilter);
    const execs = getSelectValues(elements.execFilter);
    const dexes = getSelectValues(elements.dexFilter);
    const hedgeMode = elements.hedgeFilter.value;
    let customStart = null;
    let customEnd = null;
    if (preset === 'custom') {
      customStart = parseDateInput(elements.timeStart.value);
      customEnd = parseDateInput(elements.timeEnd.value);
      if (!Number.isFinite(customStart) || !Number.isFinite(customEnd) || customStart >= customEnd) {
        setStatus('Provide a valid custom time range.');
        return null;
      }
    }
    const payload = {
      timeRange: preset === 'custom'
        ? { start: customStart, end: customEnd }
        : { preset },
      hedgeMode,
      propsFilters: {
        tokens,
        execs,
        dexes,
        diff: readRange(elements.diffMin, elements.diffMax),
        dexSlip: readRange(elements.dexSlipMin, elements.dexSlipMax),
        cexSlip: readRange(elements.cexSlipMin, elements.cexSlipMax),
        lhDelta: readRange(elements.lhDeltaMin, elements.lhDeltaMax)
      }
    };
    const uiState = {
      timePreset: preset,
      timeStart: elements.timeStart.value,
      timeEnd: elements.timeEnd.value,
      hedgeMode,
      propsFilters: {
        tokens,
        execs,
        dexes,
        diff: { min: elements.diffMin.value, max: elements.diffMax.value },
        dexSlip: { min: elements.dexSlipMin.value, max: elements.dexSlipMax.value },
        cexSlip: { min: elements.cexSlipMin.value, max: elements.cexSlipMax.value },
        lhDelta: { min: elements.lhDeltaMin.value, max: elements.lhDeltaMax.value }
      }
    };
    return { payload, uiState };
  }

  function applyFilters() {
    const built = readFiltersFromControls();
    if (!built) return;
    state.filtersPayload = built.payload;
    state.uiState = built.uiState;
    state.pagination.page = 1;
    state.pagination.total = 0;
    state.pagination.totalPages = 0;
    updateFilterSummary();
    refreshAll();
  }

  async function refreshAll() {
    if (!state.filtersPayload) return;
    setStatus('Loading report…');
    try {
      const payload = state.filtersPayload;
      const [summary, equity, breakdown] = await Promise.all([
        fetchJson('/api/reports/summary', payload),
        fetchJson('/api/reports/equity', payload),
        fetchJson('/api/reports/breakdown', payload),
      ]);
      state.summary = summary;
      updateSummary(summary);
      updateHistograms(summary?.histograms);
      updateFilterSummary(summary);
      updateKpis(summary);
      updateEquityCharts(equity);
      updateBreakdowns(breakdown);
      await loadTradesPage(1);
      setStatus(`Updated ${new Date().toLocaleString()}`);
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Failed to load reporting data');
    }
  }

  async function loadTradesPage(page) {
    if (!state.filtersPayload) return;
    setStatus(`Loading trades (page ${page})…`);
    try {
      const payload = {
        ...state.filtersPayload,
        page,
        pageSize: state.pagination.pageSize
      };
      const response = await fetchJson('/api/reports/trades', payload);
      state.trades = response.rows || [];
      state.pagination = {
        page: response.pagination?.page || page,
        pageSize: response.pagination?.pageSize || state.pagination.pageSize,
        total: response.pagination?.total || 0,
        totalPages: response.pagination?.totalPages || 0,
      };
      renderTrades();
      setStatus(`Trades page ${state.pagination.page} / ${Math.max(state.pagination.totalPages || 1, 1)}`);
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Failed to load trades');
    }
  }

  function updateKpis(summary) {
    if (!summary) {
      elements.kpis.forEach((node) => { node.textContent = '—'; });
      return;
    }
    const totals = summary.totals || {};
    const stats = summary.stats || {};
    setKpi('netPnl', formatUsd(totals.netPnl));
    setKpi('winRate', percentFmt.format(stats.winRate || 0));
    setKpi('trades', formatInteger(totals.trades));
    setKpi('wins', formatInteger(totals.wins));
    setKpi('losses', formatInteger(totals.losses));
    setKpi('avgPnl', formatUsd(stats.avgPnl));
    setKpi('medianPnl', formatUsd(stats.medianPnl));
    setKpi('maxDrawdown', formatUsd(stats.maxDrawdown ? -Math.abs(stats.maxDrawdown) : 0));
    setKpi('sharpe', numberFmt.format(stats.sharpe || 0));
  }

  function updateEquityCharts(data) {
    const balancesCurve = (data?.balancesCurve || []).map(point => ({ x: point.t, y: point.equity }));
    const tradeCurve = (data?.tradeCurve || []).map(point => ({ x: point.t, y: point.value }));
    updateLineChart('balances', 'balancesEquityChart', balancesCurve, 'Balance Equity');
    updateLineChart('trade', 'tradeEquityChart', tradeCurve, 'Trade Cumulative PnL');
  }

  function updateHistograms(histograms) {
    updateHistogramChart('pnlHist', 'pnlHistogram', histograms?.netPnl, 'Net PnL');
    updateHistogramChart('returnHist', 'returnHistogram', histograms?.returns, 'Return');
  }

  function updateHistogramChart(key, elementId, histogram, label) {
    const ctx = document.getElementById(elementId);
    if (!ctx) return;
    const labels = (histogram?.bins || []).map(bin => bin.label);
    const counts = histogram?.counts || [];
    const colors = getChartThemeColors();
    if (!charts[key]) {
      charts[key] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label, data: counts, backgroundColor: 'rgba(0,229,255,0.4)', borderColor: '#00E5FF' }] },
        options: {
          responsive: true,
          animation: false,
          scales: {
            x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
            y: { ticks: { color: colors.muted }, grid: { color: colors.grid }, beginAtZero: true }
          },
          plugins: { legend: { display: false, labels: { color: colors.text } } }
        }
      });
    } else {
      charts[key].data.labels = labels;
      charts[key].data.datasets[0].data = counts;
      charts[key].options.scales.x.ticks.color = colors.muted;
      charts[key].options.scales.x.grid.color = colors.grid;
      charts[key].options.scales.y.ticks.color = colors.muted;
      charts[key].options.scales.y.grid.color = colors.grid;
      charts[key].update('none');
    }
  }

  function updateBreakdowns(data) {
    state.breakdown = { ...createEmptyBreakdown(), ...(data || {}) };
    renderPairBreakdown();
  }

  function renderPairBreakdown() {
    const rows = state.breakdown?.pairs || [];
    renderBreakdownTable(elements.pairTableBody, rows, 6, (row) => {
      const winRate = row.trades ? row.wins / row.trades : 0;
      return [
        row.pair || 'n/a',
        formatInteger(row.trades),
        formatPercentValue(winRate),
        formatUsd(row.netPnl),
        formatUsd(row.avgPnl),
        formatUsd(row.notional),
      ];
    }, 'No pairs match the selected filters.');
    updateBreakdownSummary(elements.pairSummary, rows, state.breakdown?.totalPairs, 'pairs');
  }

  function renderBreakdownTable(container, rows, columnCount, buildRow, emptyText) {
    if (!container) return;
    container.innerHTML = '';
    const hasRows = rows && rows.length;
    if (!hasRows) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columnCount;
      td.className = 'muted';
      td.textContent = emptyText;
      tr.appendChild(td);
      container.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const cells = buildRow(row);
      cells.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      container.appendChild(tr);
    });
  }

  function updateBreakdownSummary(element, rows, total, label) {
    if (!element) return;
    if (!rows || !rows.length) {
      element.textContent = `No ${label} match the selected filters.`;
      return;
    }
    const shown = rows.length;
    const totalText = formatInteger(total || shown);
    const parts = [`Showing ${shown} of ${totalText} ${label}`];
    if (state.breakdown?.generatedAt) {
      parts.push(`Updated ${new Date(state.breakdown.generatedAt).toLocaleString()}`);
    }
    element.textContent = parts.join(' · ');
  }

  function updateLineChart(key, elementId, data, label) {
    const ctx = document.getElementById(elementId);
    if (!ctx) return;
    const colors = getChartThemeColors();
    if (!charts[key]) {
      charts[key] = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [{
            label,
            data,
            parsing: false,
            borderColor: key === 'balances' ? '#1F6FEB' : '#39FF14',
            backgroundColor: 'transparent',
            tension: 0.15,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          animation: false,
          parsing: false,
          scales: {
            x: { type: 'time', ticks: { color: colors.muted }, grid: { color: colors.grid } },
            y: {
              ticks: {
                color: colors.muted,
                callback: (val) => formatCompactCurrency(val)
              },
              grid: { color: colors.grid }
            }
          },
          plugins: {
            legend: { display: false, labels: { color: colors.text } },
            tooltip: {
              callbacks: {
                label: (context) => `${context.dataset.label}: ${formatUsd(context.parsed.y)}`
              }
            }
          }
        }
      });
    } else {
      charts[key].data.datasets[0].data = data;
      charts[key].options.scales.x.ticks.color = colors.muted;
      charts[key].options.scales.x.grid.color = colors.grid;
      charts[key].options.scales.y.ticks.color = colors.muted;
      charts[key].options.scales.y.grid.color = colors.grid;
      charts[key].update('none');
    }
  }

  function renderTrades() {
    if (!elements.tradesBody) return;
    elements.tradesBody.innerHTML = '';
    if (!state.trades.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 9;
      td.className = 'muted';
      td.textContent = 'No trades match the selected filters.';
      tr.appendChild(td);
      elements.tradesBody.appendChild(tr);
    } else {
      for (const trade of state.trades) {
        const tr = document.createElement('tr');
        const timestamp = formatTime(trade.timestamp || trade.lastUpdateTime || trade.executedTime || trade.creationTime);
        const props = getTradeProps(trade);
        const token = props?.Token || trade.pair || '—';
        const lhDelta = formatNumberValue(props?.LHdelta);
        const cexSlip = formatNumberValue(props?.CexSlip);
        const diff = formatNumberValue(props?.Diff);
        const dexSlip = formatNumberValue(props?.DexSlip);

        appendCell(tr, timestamp);

        const tokenCell = document.createElement('td');
        tokenCell.textContent = token;
        const rawBtn = document.createElement('button');
        rawBtn.type = 'button';
        rawBtn.className = 'mini-btn';
        rawBtn.textContent = 'Raw';
        rawBtn.addEventListener('click', () => showRawDialog(trade));
        tokenCell.appendChild(rawBtn);
        tr.appendChild(tokenCell);

        appendCell(tr, formatUsd(trade.netPnl));
        appendCell(tr, lhDelta);
        appendCell(tr, props?.Exec || '—');
        appendCell(tr, cexSlip);
        appendCell(tr, props?.Dex || '—');
        appendCell(tr, diff);
        appendCell(tr, dexSlip);

        elements.tradesBody.appendChild(tr);
      }
    }
    elements.tradesPageInfo.textContent = `Page ${state.pagination.page} / ${Math.max(state.pagination.totalPages || 1, 1)}`;
    elements.prevPage.disabled = state.pagination.page <= 1;
    elements.nextPage.disabled = !state.pagination.totalPages || state.pagination.page >= state.pagination.totalPages;
  }

  function appendCell(row, text) {
    const td = document.createElement('td');
    td.textContent = text;
    row.appendChild(td);
  }

  function getTradeProps(trade) {
    if (trade.propsParsed) return trade.propsParsed;
    if (!trade.props) return null;
    try {
      const parsed = typeof trade.props === 'string' ? JSON.parse(trade.props) : trade.props;
      trade.propsParsed = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  function formatNumberValue(value) {
    const num = Number(value);
    return Number.isFinite(num) ? numberFmt.format(num) : '—';
  }

  function showRawDialog(trade) {
    if (!elements.rawDialog || !elements.rawDialogContent) {
      alert(JSON.stringify(trade, null, 2));
      return;
    }
    const raw = trade.raw_data || trade.rawData || '{}';
    let parsed;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      parsed = raw;
    }
    elements.rawDialogContent.textContent = JSON.stringify(parsed, null, 2);
    elements.rawDialog.showModal();
  }

  function updateFilterSummary(summary) {
    if (!elements.filtersSummary) return;
    if (!state.uiState) {
      elements.filtersSummary.textContent = '';
      return;
    }
    const parts = [];
    const preset = state.uiState.timePreset;
    if (preset === 'custom') {
      parts.push(`Custom ${state.uiState.timeStart || '?'} → ${state.uiState.timeEnd || '?'}`);
    } else {
      parts.push(`Preset: ${preset.toUpperCase()}`);
    }
    const propsFilters = state.filtersPayload?.propsFilters || {};
    if (propsFilters.tokens?.length) parts.push(`tokens:${propsFilters.tokens.length}`);
    if (propsFilters.execs?.length) parts.push(`exec:${propsFilters.execs.length}`);
    if (propsFilters.dexes?.length) parts.push(`dex:${propsFilters.dexes.length}`);
    const diffSummary = describeRangeSummary(propsFilters.diff, 'Diff');
    if (diffSummary) parts.push(diffSummary);
    const dexSlipSummary = describeRangeSummary(propsFilters.dexSlip, 'DexSlip');
    if (dexSlipSummary) parts.push(dexSlipSummary);
    const cexSlipSummary = describeRangeSummary(propsFilters.cexSlip, 'CexSlip');
    if (cexSlipSummary) parts.push(cexSlipSummary);
    const lhSummary = describeRangeSummary(propsFilters.lhDelta, 'LHdelta');
    if (lhSummary) parts.push(lhSummary);
    parts.push(`hedge:${state.uiState.hedgeMode}`);
    if (summary?.totals?.trades) parts.push(`${summary.totals.trades} trades`);
    elements.filtersSummary.textContent = parts.join(' • ');
  }

  async function loadOptions() {
    try {
      const response = await fetch('/api/reports/options');
      if (!response.ok) throw new Error('Failed to load filter options');
      state.options = await response.json();
      populateSelect(elements.tokenFilter, state.options.tokens);
      populateSelect(elements.execFilter, state.options.execs && state.options.execs.length ? state.options.execs : ['Market', 'Limit', 'PostOnly', 'IOC', 'FOK']);
      populateSelect(elements.dexFilter, state.options.dexes && state.options.dexes.length ? state.options.dexes : ['BUY', 'SELL']);
    } catch (err) {
      console.error(err);
      setStatus('Unable to load filter options; continuing with manual inputs.');
    }
  }

  function populateSelect(select, values = []) {
    if (!select) return;
    select.innerHTML = '';
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  }

  function resetControls() {
    elements.timePreset.value = '7d';
    toggleCustomRange();
    setDefaultCustomRange();
    for (const select of [elements.tokenFilter, elements.execFilter, elements.dexFilter]) {
      if (select) {
        Array.from(select.options).forEach(opt => { opt.selected = false; });
      }
    }
    elements.hedgeFilter.value = 'all';
    for (const input of [elements.diffMin, elements.diffMax, elements.dexSlipMin, elements.dexSlipMax, elements.cexSlipMin, elements.cexSlipMax, elements.lhDeltaMin, elements.lhDeltaMax]) {
      if (input) input.value = '';
    }
  }

  function saveCurrentView() {
    const { uiState } = state;
    if (!uiState) return;
    const name = prompt('Name for this view?');
    if (!name) return;
    const views = getSavedViews();
    views[name] = uiState;
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    loadSavedViews();
    setStatus(`Saved view "${name}"`);
  }

  function setControlsFromState(view) {
    if (!view) return;
    elements.timePreset.value = view.timePreset || '7d';
    toggleCustomRange();
    if (view.timePreset === 'custom') {
      elements.timeStart.value = view.timeStart || '';
      elements.timeEnd.value = view.timeEnd || '';
    }
    const props = view.propsFilters || {};
    setMultiSelect(elements.tokenFilter, props.tokens);
    setMultiSelect(elements.execFilter, props.execs);
    setMultiSelect(elements.dexFilter, props.dexes);
    elements.hedgeFilter.value = view.hedgeMode || 'all';
    setRangeInputs(props.diff, elements.diffMin, elements.diffMax);
    setRangeInputs(props.dexSlip, elements.dexSlipMin, elements.dexSlipMax);
    setRangeInputs(props.cexSlip, elements.cexSlipMin, elements.cexSlipMax);
    setRangeInputs(props.lhDelta, elements.lhDeltaMin, elements.lhDeltaMax);
  }

  function setMultiSelect(select, values = []) {
    if (!select) return;
    const set = new Set(values || []);
    Array.from(select.options).forEach(opt => {
      opt.selected = set.has(opt.value);
    });
  }

  function setRangeInputs(range, minInput, maxInput) {
    if (!minInput || !maxInput) return;
    minInput.value = range && range.min != null ? range.min : '';
    maxInput.value = range && range.max != null ? range.max : '';
  }

  function describeRangeSummary(range, label) {
    if (!range) return null;
    const parts = [];
    if (Number.isFinite(range.min)) parts.push(`≥ ${range.min}`);
    if (Number.isFinite(range.max)) parts.push(`≤ ${range.max}`);
    if (!parts.length) return null;
    return `${label} ${parts.join(' & ')}`;
  }

  function loadSavedViews() {
    const views = getSavedViews();
    if (!elements.savedViews) return;
    elements.savedViews.innerHTML = '<option value="">Load view…</option>';
    Object.keys(views).forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      elements.savedViews.appendChild(opt);
    });
  }

  function getSavedViews() {
    try {
      const stored = localStorage.getItem(SAVED_VIEWS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  async function exportTradesCsv() {
    if (!state.filtersPayload) {
      setStatus('Apply filters before exporting.');
      return;
    }
    setStatus('Preparing CSV…');
    try {
      const payload = { ...state.filtersPayload, format: 'csv' };
      const response = await fetch('/api/reports/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Failed to export trades');
      const text = await response.text();
      downloadBlob(text, 'reports-trades.csv', 'text/csv');
      setStatus('Trades CSV exported.');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Failed to export trades CSV');
    }
  }

  async function exportPairsCsv() {
    if (!state.filtersPayload) {
      setStatus('Apply filters before exporting pairs.');
      return;
    }
    setStatus('Preparing pair CSV…');
    try {
      const payload = { ...state.filtersPayload, format: 'csv' };
      const response = await fetch('/api/reports/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Failed to export pair breakdown');
      const text = await response.text();
      downloadBlob(text, 'reports-pairs.csv', 'text/csv');
      setStatus('Pairs CSV exported.');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Failed to export pair breakdown CSV');
    }
  }

  function exportSummaryCsv() {
    if (!state.summary) {
      setStatus('Load summary before exporting.');
      return;
    }
    const rows = [
      ['Metric', 'Value'],
      ['Total Net PnL', formatUsdRaw(state.summary.totals?.netPnl)],
      ['Win Rate', percentFmt.format(state.summary.stats?.winRate || 0)],
      ['Trades', formatInteger(state.summary.totals?.trades)],
      ['Wins', formatInteger(state.summary.totals?.wins)],
      ['Losses', formatInteger(state.summary.totals?.losses)],
      ['Average PnL', formatUsdRaw(state.summary.stats?.avgPnl)],
      ['Median PnL', formatUsdRaw(state.summary.stats?.medianPnl)],
      ['Max Drawdown', formatUsdRaw(-(state.summary.stats?.maxDrawdown || 0))],
      ['Sharpe-like', numberFmt.format(state.summary.stats?.sharpe || 0)],
    ];
    const csv = rows.map((row) => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(csv, 'reports-summary.csv', 'text/csv');
    setStatus('Summary CSV generated.');
  }

  function openPrintableReport() {
    if (!state.summary) {
      alert('Run the report first.');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) return;
    const tradesPreview = state.trades.slice(0, 10).map(trade => `
      <tr>
        <td>${formatTime(trade.timestamp || trade.lastUpdateTime)}</td>
        <td>${trade.pair || ''}</td>
        <td>${formatUsd(trade.netPnl)}</td>
        <td>${percentFmt.format(trade.ret || 0)}</td>
      </tr>
    `).join('');
    win.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Trade Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1, h2 { margin-bottom: 0.5rem; }
            table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
            th { background: #f2f3f5; }
          </style>
        </head>
        <body>
          <h1>Reporting & Analytics</h1>
          <p>Filters: ${elements.filtersSummary.textContent || 'n/a'}</p>
          <h2>KPIs</h2>
          <ul>
            <li>Total Net PnL: ${formatUsd(state.summary.totals?.netPnl)}</li>
            <li>Win Rate: ${percentFmt.format(state.summary.stats?.winRate || 0)}</li>
            <li>Trades: ${formatInteger(state.summary.totals?.trades)} (Wins ${formatInteger(state.summary.totals?.wins)}, Losses ${formatInteger(state.summary.totals?.losses)})</li>
            <li>Average PnL: ${formatUsd(state.summary.stats?.avgPnl)}</li>
            <li>Median PnL: ${formatUsd(state.summary.stats?.medianPnl)}</li>
            <li>Max Drawdown: ${formatUsd(-(state.summary.stats?.maxDrawdown || 0))}</li>
            <li>Sharpe-like: ${numberFmt.format(state.summary.stats?.sharpe || 0)}</li>
          </ul>
          <h2>Sample Trades</h2>
          <table>
            <thead><tr><th>Time</th><th>Pair</th><th>Net PnL</th><th>Return</th></tr></thead>
            <tbody>${tradesPreview || '<tr><td colspan="4">No trades</td></tr>'}</tbody>
          </table>
          <p>Generated at ${new Date().toLocaleString()}</p>
        </body>
      </html>`);
    win.document.close();
  }

  async function fetchJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed (${response.status})`);
    }
    return response.json();
  }

  function getSelectValues(select) {
    if (!select) return [];
    return Array.from(select.selectedOptions || []).map(opt => opt.value).filter(Boolean);
  }

  function parseNumber(value) {
    if (value == null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function readRange(minInput, maxInput) {
    if (!minInput || !maxInput) return { min: null, max: null };
    return {
      min: parseNumber(minInput.value),
      max: parseNumber(maxInput.value),
    };
  }

  function parseDateInput(value) {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toLocalDateInput(ms) {
    const date = new Date(ms);
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(ms - tzOffset).toISOString().slice(0, 16);
  }

  function setKpi(key, value) {
    const el = document.querySelector(`[data-kpi="${key}"]`);
    if (el) el.textContent = value;
  }

  function formatUsd(value) {
    return currencyFmt.format(Number.isFinite(value) ? value : 0);
  }

  function formatUsdRaw(value) {
    return currencyFmt.format(Number.isFinite(value) ? value : 0);
  }

  function formatPercentValue(value) {
    const num = Number(value);
    return percentFmt.format(Number.isFinite(num) ? num : 0);
  }

  function formatCompactCurrency(value) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 2 }).format(value);
  }

  function formatInteger(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString() : '0';
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) return '—';
    return new Date(ms).toLocaleString();
  }

  function setStatus(text) {
    if (elements.status) {
      elements.status.textContent = text;
    }
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function updateSummary(summary) {
    if (!summary || !elements.status) return;
    const totals = summary.totals || {};
    const stats = summary.stats || {};
    const summaryBits = [
      `Net PnL ${formatUsd(totals.netPnl)}`,
      `Trades ${formatInteger(totals.trades)}`,
      `Win ${percentFmt.format(stats.winRate || 0)}`
    ];
    elements.status.textContent = summaryBits.join(' • ');
  }
})();
