async function sendHourlyDigest() {
  const cfg = loadServers();
  const servers = cfg.servers;

  // Process each server to send hourly digest
  for (const server of servers) {
    const notifier = ensureNotifier(server.id);
    if (!notifier) continue;

    try {
      const serverIp = server.baseUrl.split(':')[1].substring(2);
      const resp = await axios.get(`http://${serverIp}:3001/`, { timeout: 10000 });
      const text = resp.data;

      if (typeof text !== 'string') {
        throw new Error('Invalid status response from server');
      }

      let message = `**Hourly Digest for ${server.label}**\\n\\n`;

      const lines = text.split(/\\r?\\n/);
      const sdiffLine = lines.find(l => l.startsWith('SDIFF_Uniswap_ckhvar2'));
      if (sdiffLine) {
        const parts = sdiffLine.split(/\\s+/);
        const propsIndex = sdiffLine.indexOf('Mindiff:');
        const propsStr = propsIndex > -1 ? sdiffLine.substring(propsIndex) : '';
        const up = parts.length > 4 ? parts[4] : 'N/A';
        const mindiff = propsStr.match(/Mindiff:([\\d.]+)/)?.[1];
        const maxOrderSize = propsStr.match(/MaxOrderSize: (\\d+)/)?.[1];
        const tokens = propsStr.match(/\\w+\\([\\d.]+,[\\d.]+\\)/g) || [];
        message += `**Server Status**\\nUptime: ${up}, Mindiff: ${mindiff}, MaxOrderSize: ${maxOrderSize}\\n`;
        message += `Tokens: ${tokens.join(', ')}\\n\\n`;
      }

      const blacklistLine = lines.find(l => l.startsWith('SDIFF Uniswap BlackList:'));
      if (blacklistLine) {
        const str = blacklistLine.replace('SDIFF Uniswap BlackList:', '').trim();
        message += `**Blacklist**\\n${str}\\n\\n`;
      }

      const db = ensureDb(server.id);
      const now = Date.now();
      const oneHourAgo = now - (1 * 60 * 60 * 1000);
      const tradesLast1h = db.prepare('SELECT * FROM completed_trades WHERE lastUpdateTime >= ?').all(oneHourAgo);
      const netProfit = (t) => (t.executedQtyDst * t.executedDstPrice) - (t.executedSrcPrice * t.executedQtySrc) - (0.0002 * t.executedQtyDst * t.executedDstPrice);
      const profitLast1h = tradesLast1h.reduce((acc, t) => acc + netProfit(t), 0);

      message += `**Last Hour Performance**\\nTrades: ${tradesLast1h.length}, Profit: ${Number.isFinite(profitLast1h) ? profitLast1h.toFixed(2) : '0.00'}\\n\\n`;

      const balanceRow = db.prepare('SELECT raw_data FROM balances_history ORDER BY id DESC LIMIT 1').get();
      if (balanceRow) {
        const snapshot = safeJsonParse(balanceRow.raw_data);
        const { dexTotal, cexTotal, combined } = computeDexCex(snapshot);
        message += `**Balance**\\nTotal USDT (DEX + BinanceF): ${Number.isFinite(combined) ? combined.toFixed(2) : '0.00'} | BinanceF Total USDT: ${Number.isFinite(cexTotal) ? cexTotal.toFixed(2) : '0.00'} | Total DEX USDT: ${Number.isFinite(dexTotal) ? dexTotal.toFixed(2) : '0.00'}`;
      }

      // Ensure notifications are sent to both telegram and slack by default
      // unless the rule configuration specifies otherwise
      const ruleChannels = notifier.getRuleConfig('hourlyDigest')?.channels;
      const channels = ruleChannels || ['telegram', 'slack'];
      
      await notifier.notify('hourlyDigest', {
        title: `Hourly Digest: ${server.label}`,
        message: message,
        channels: channels
      });

    } catch (err) {
      console.error(`Failed to send hourly digest for server ${server.label}:`, err.message);
    }
  }
}