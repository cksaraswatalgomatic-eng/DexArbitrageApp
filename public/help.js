(() => {
  const HELP = {
    // Dashboard
    'total-chart': { title: 'Total USDT Balance Over Time', body: 'Combined totals across DEX venues and BinanceF. Scroll or pinch to explore history.', link: '/docs.html#total-chart' },
    'gas-consumption-chart': { title: 'Gas Consumption', body: 'Hourly gas usage adjusted for manual deposits.', link: null },
    'consolidated-total-balance-chart': { title: 'Total USDT Balance Over Time (All Servers)', body: 'Combined totals across all configured servers. Outlier filter hides data points below a specified threshold to improve chart readability.', link: null },
    'arbitrage-opportunity-analysis': { title: 'Arbitrage Opportunity Analysis', body: 'Analyze historical arbitrage opportunities, including buy/sell differences, CEX/DEX volumes, and server prices. Use filters to refine the data.', link: null },
    'pair-analysis-overview': { title: 'Pair Analysis Overview', body: 'Summary of trade data, including options to filter by limit, reload data, visualize tables, and access a detailed pair deep dive.', link: null },
    'individual-pair-profitability-analysis': { title: 'Individual Pair Profitability Analysis', body: 'Detailed analysis of a selected pair\'s profitability, including time-wise net profit distribution and net profit correlation with various attributes.', link: null },
    'pair-selection-configuration': { title: 'Pair Selection & Configuration', body: 'Select a trading pair and configure parameters for detailed analysis, including data limit and the X variable for scatter plots.', link: null },
    'additional-analysis': { title: 'Additional Analysis', body: 'Access further analytical tools such as net profit per trade visualization and data export options for the selected pair.', link: null },
    'dex-table': { title: 'DEX Exchange Balances', body: 'Per DEX exchange totals and top tokens (totalUsdt > 0.1). Columns sortable; search to filter.', link: '/docs.html#dex-table' },
    'cex-table': { title: 'BinanceF Balances', body: 'USDT total = wallet USDT + sum of unrealized PnL. Token USDT ≈ (entryPrice * total)/leverage + unrealizedProfit. Columns sortable; use search.', link: '/docs.html#cex-table' },
    'trades-table': { title: 'Completed Trades', body: 'Includes pair, executedGrossProfit (green/red), Quantity = executedSrcPrice * executedQtySrc, timestamps, and parsed props (Dex/Diff/slips).', link: '/docs.html#trades-table' },
    'server-status': { title: 'Server Status', body: 'Provides a real-time overview of the bot\'s operational status, including strategy parameters, recent profitability, trade counts, and gas balances.' },
    'daily-profit': { title: 'Daily Profit', body: 'A bar chart summarizing daily net profits. Use the navigation buttons to view different weeks.' },
    'gas-consumption': { title: 'Gas Consumption', body: 'Tracks hourly gas usage and manual deposits to help manage on-chain costs.' },
    'dex-cex-comparison': { title: 'DEX vs CEX Comparison', body: 'A side-by-side comparison of token balances (in USDT) between DEX and CEX wallets.' },
    'bot-status-summary': { title: 'Bot Status Summary', body: 'Operational parameters, recent profit windows (1h–24h), trade counts, strategy hints, and gas balances (alerts <2 USDT).', link: '/docs.html#bot-status' },

    // Pair Analysis
    'bar-total-profit': { title: 'Total Net Profit by Pair', body: 'Top pairs by total net profit. Helps spot consistently profitable markets.', link: '/docs.html#bar-total-profit' },
    'winners-rate': { title: 'Win Rate (Top Winners)', body: 'Win rate for top profitable pairs. Use to confirm consistency.', link: '/docs.html#winners-rate' },
    'losers-loss': { title: 'Total Loss (Top Losers)', body: 'Absolute total loss for weakest pairs. Consider avoiding or hedging.', link: '/docs.html#losers-loss' },
    'features-table': { title: 'Pair Feature Differences', body: 'Trades, total profit, and averages of Diff/DexSlip/CexSlip for wins vs losses + overall CexSlip.', link: '/docs.html#features-table' },

    // Pair Deep Dive
    'cum-gp': { title: 'Cumulative Gross Profit', body: 'Per-pair cumulative executedGrossProfit over time. Zoom/drag; loads fully zoomed out.', link: '/docs.html#cum-gp' },
    'hist-gp': { title: 'Distribution', body: 'Histogram of gross profits or chosen metric to see spread and skew.', link: '/docs.html#hist-gp' },
    'scatter-deep': { title: 'Feature vs Profit', body: 'Scatter of chosen X against gross profit. Inspect relationships and dispersion.', link: '/docs.html#scatter-deep' },


    // Token Analysis
    'bar-total-profit-token': { title: 'Total Net Profit by Token', body: 'Top tokens by total net profit. Identify consistently profitable assets.', link: '/docs.html#token-bar-total-profit' },
    'winners-rate-token': { title: 'Win Rate (Top Winners)', body: 'Win rate for top profitable tokens. Use to confirm consistency.', link: '/docs.html#token-winners-rate' },
    'losers-loss-token': { title: 'Total Loss (Top Losers)', body: 'Total loss for weakest tokens. Consider avoiding or hedging exposure.', link: '/docs.html#token-losers-loss' },

    // Contract Analysis
    'contract-summary': { title: 'Contract Summary', body: 'Shows success/failure counts for the configured contract over 1h, 4h, 8h, 12h, 24h windows. Configure explorer + contract under Servers.', link: '/servers.html' },
    'contract-failed': { title: 'Failed Transactions', body: 'Lists failed transactions in the last 24h with best-effort failure reason scraped from the explorer; not all explorers expose reasons.', link: '/servers.html' }
  };

  function showPopover(btn, title, body, link) {
    hidePopover();
    const rect = btn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'popover';
    const linkHtml = link ? `<p style="margin-top:8px"><a href="${link}" class="nav-link" style="padding:4px 8px;font-weight:600">Learn more</a></p>` : '';
    pop.innerHTML = `<button class="close" aria-label="Close" title="Close">&times;</button><h4 style="margin:0 0 6px">${title}</h4><p style="margin:0">${body}</p>${linkHtml}`;
    document.body.appendChild(pop);
    const top = window.scrollY + rect.top + rect.height + 8;
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - pop.offsetWidth - 16);
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    pop.querySelector('.close').addEventListener('click', hidePopover);
    document.addEventListener('keydown', escListener);
  }

  function hidePopover() {
    const p = document.querySelector('.popover');
    if (p) p.remove();
    document.removeEventListener('keydown', escListener);
  }

  function escListener(e) {
    if (e.key === 'Escape') hidePopover();
  }

  function wire() {
    document.querySelectorAll('.info-btn[data-help]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.addEventListener('click', () => {
        const id = btn.dataset.help;
        const h = HELP[id];
        if (!h) {
          console.warn('[help] No help entry for id:', id);
          showPopover(btn, 'Info', 'No help is available for this section yet.', null);
          return;
        }
        showPopover(btn, h.title, h.body, h.link);
      });
      btn.dataset.bound = '1';
    });
    document.addEventListener('click', (e) => {
      const p = document.querySelector('.popover');
      if (!p) return;
      const b = e.target.closest('.info-btn');
      if (!b && !p.contains(e.target)) hidePopover();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  document.addEventListener('DOMContentLoaded', () => {
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
})();
