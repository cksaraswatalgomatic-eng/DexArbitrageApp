const axios = require('axios');
const nodemailer = require('nodemailer');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function splitList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(/[,;\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

class Notifier {
  constructor({ serverId, serverLabel, config = {}, rules = {}, db }) {
    this.serverId = serverId;
    this.serverLabel = serverLabel || serverId;
    this.config = config || {};
    this.rules = rules || {};
    this.db = db;
    this.emailTransport = null;
    this.emailTransportKey = null;
    this.tablesReady = false;
    this.ensureTables();
  }

  ensureTables() {
    if (!this.db || this.tablesReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT,
        rule TEXT,
        title TEXT,
        channel TEXT,
        status TEXT,
        message TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_state (
        key TEXT PRIMARY KEY,
        last_sent INTEGER NOT NULL
      );
    `);
    this.tablesReady = true;
  }

  getRuleConfig(ruleKey) {
    const rules = this.rules && typeof this.rules === 'object' ? this.rules : {};
    const cfg = rules[ruleKey];
    if (!cfg || typeof cfg !== 'object') return {};
    return cfg;
  }

  resolveCooldownMinutes(ruleKey, override) {
    if (override != null) {
      const num = Number(override);
      return Number.isFinite(num) && num > 0 ? num : 0;
    }
    const ruleCfg = this.getRuleConfig(ruleKey);
    const raw = ruleCfg.cooldownMinutes != null ? ruleCfg.cooldownMinutes : ruleCfg.cooldown;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  resolveChannels(requested) {
    const available = [];
    const telegram = this.config.telegram || {};
    if (telegram.enabled && telegram.botToken && telegram.chatId) {
      available.push('telegram');
    }
    const slack = this.config.slack || {};
    if (slack.enabled && slack.webhookUrl) {
      available.push('slack');
    }
    const email = this.config.email || {};
    const recipients = splitList(email.to || email.recipients);
    if (email.enabled && email.smtpHost && email.from && recipients.length) {
      available.push('email');
    }

    if (Array.isArray(requested) && requested.length) {
      return available.filter((ch) => requested.includes(ch));
    }
    return available;
  }

  makeStateKey(ruleKey, uniqueKey) {
    const suffix = uniqueKey ? String(uniqueKey) : 'default';
    return `${this.serverId}:${ruleKey}:${suffix}`;
  }

  isUnderCooldown(stateKey, cooldownMinutes, now) {
    if (!cooldownMinutes || cooldownMinutes <= 0) return false;
    const row = this.db.prepare('SELECT last_sent FROM notification_state WHERE key = ?').get(stateKey);
    if (!row) return false;
    const last = toNumber(row.last_sent);
    if (!Number.isFinite(last)) return false;
    return (now - last) < cooldownMinutes * 60_000;
  }

  recordState(stateKey, timestamp) {
    this.db.prepare(`
      INSERT INTO notification_state (key, last_sent)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET last_sent = excluded.last_sent
    `).run(stateKey, timestamp);
  }

  logNotification(ruleKey, title, channel, status, message, details) {
    const createdAt = new Date().toISOString();
    const trimmedMessage = message != null ? String(message).slice(0, 2000) : null;
    let serializedDetails = null;
    if (details && typeof details === 'object') {
      try {
        serializedDetails = JSON.stringify(details).slice(0, 4000);
      } catch {
        serializedDetails = null;
      }
    } else if (typeof details === 'string') {
      serializedDetails = details.slice(0, 4000);
    }

    this.db.prepare(`
      INSERT INTO notifications_log (server_id, rule, title, channel, status, message, details, created_at)
      VALUES (@server_id, @rule, @title, @channel, @status, @message, @details, @created_at)
    `).run({
      server_id: this.serverId,
      rule: ruleKey,
      title: title || null,
      channel,
      status,
      message: trimmedMessage,
      details: serializedDetails,
      created_at: createdAt,
    });
  }

  async notify(ruleKey, payload = {}) {
    this.ensureTables();
    const now = Date.now();
    const stateKey = this.makeStateKey(ruleKey, payload.uniqueKey);
    const cooldownMinutes = this.resolveCooldownMinutes(ruleKey, payload.cooldownMinutes);
    if (this.isUnderCooldown(stateKey, cooldownMinutes, now)) {
      return { skipped: 'cooldown' };
    }

    const channels = this.resolveChannels(payload.channels);
    const title = payload.title || `${ruleKey} alert`;
    const message = payload.message || '';
    const subject = payload.subject || `[${this.serverLabel}] ${title}`;
    const baseDetails = payload.details && typeof payload.details === 'object' ? { ...payload.details } : null;

    if (!channels.length) {
      const skipDetails = baseDetails ? { ...baseDetails, reason: 'no_channels_configured' } : { reason: 'no_channels_configured' };
      this.logNotification(ruleKey, title, 'system', 'skipped', message, skipDetails);
      return { skipped: 'no_channels' };
    }

    const results = [];
    for (const channel of channels) {
      try {
        if (channel === 'telegram') {
          const info = await this.sendTelegram(message, title);
          const logDetails = baseDetails ? { ...baseDetails, transport: info } : info;
          this.logNotification(ruleKey, title, channel, 'sent', message, logDetails);
          results.push({ channel, status: 'sent', info });
        } else if (channel === 'slack') {
          const info = await this.sendSlack(message, title);
          const logDetails = baseDetails ? { ...baseDetails, transport: info } : info;
          this.logNotification(ruleKey, title, channel, 'sent', message, logDetails);
          results.push({ channel, status: 'sent', info });
        } else if (channel === 'email') {
          const info = await this.sendEmail(subject, message, payload.emailOptions || {});
          const logDetails = baseDetails ? { ...baseDetails, transport: info } : info;
          this.logNotification(ruleKey, title, channel, 'sent', message, logDetails);
          results.push({ channel, status: 'sent', info });
        } else {
          const detail = baseDetails ? { ...baseDetails, reason: 'unknown_channel' } : { reason: 'unknown_channel' };
          this.logNotification(ruleKey, title, channel, 'skipped', message, detail);
          results.push({ channel, status: 'skipped' });
        }
      } catch (err) {
        const errorMessage = err && err.message ? err.message : String(err);
        const errorDetails = baseDetails ? { ...baseDetails, error: errorMessage } : { error: errorMessage };
        this.logNotification(ruleKey, title, channel, 'failed', message, errorDetails);
        results.push({ channel, status: 'failed', error: errorMessage });
      }
    }

    this.recordState(stateKey, now);
    return { results };
  }

  async sendTelegram(message, title) {
    const telegram = this.config.telegram || {};
    const url = `https://api.telegram.org/bot${telegram.botToken}/sendMessage`;
    const text = title ? `${title}\n${message}` : message;
    const resp = await axios.post(url, {
      chat_id: telegram.chatId,
      text,
      disable_notification: false,
    }, { timeout: 15000 });
    return { ok: resp.data?.ok !== false };
  }

  async sendSlack(message, title) {
    const slack = this.config.slack || {};
    const text = title ? `*${title}*\n${message}` : message;
    const resp = await axios.post(slack.webhookUrl, { text }, { timeout: 15000 });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Slack webhook responded with status ${resp.status}`);
    }
    return { status: resp.status };
  }

  async sendEmail(subject, message, options = {}) {
    const email = this.config.email || {};
    const recipients = splitList(options.to || email.to || email.recipients);
    if (!recipients.length) throw new Error('No email recipients configured');
    const transporter = await this.getEmailTransport(email);
    const resp = await transporter.sendMail({
      from: email.from,
      to: recipients.join(', '),
      subject,
      text: message,
    });
    return { messageId: resp.messageId };
  }

  async getEmailTransport(emailConfig) {
    const key = JSON.stringify({
      host: emailConfig.smtpHost,
      port: Number(emailConfig.smtpPort),
      secure: !!emailConfig.secure,
      user: emailConfig.user || emailConfig.username,
    });
    if (this.emailTransport && this.emailTransportKey === key) {
      return this.emailTransport;
    }
    const port = Number(emailConfig.smtpPort);
    const transporter = nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: Number.isFinite(port) ? port : 587,
      secure: emailConfig.secure === true || String(emailConfig.secure).toLowerCase() === 'true',
      auth: emailConfig.user || emailConfig.username ? {
        user: emailConfig.user || emailConfig.username,
        pass: emailConfig.pass || emailConfig.password,
      } : undefined,
      tls: {
        minVersion: 'TLSv1.2',
      },
    });
    this.emailTransport = transporter;
    this.emailTransportKey = key;
    return transporter;
  }
}

module.exports = { Notifier };
