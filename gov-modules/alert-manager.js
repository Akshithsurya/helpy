/**
 * æ”¿åŠ¡çº§å‘Šè­¦ç®¡ç†æ¨¡å—
 * å¤„ç†ç³»ç»Ÿå‘Šè­¦çš„å‘é€å’Œç®¡ç†
 */
const fs = require('fs');
const path = require('path');
const { HealthMonitor } = require('./health-monitor');

class AlertManager {
  constructor(options = {}) {
    this.alertHistory = [];
    this.maxAlertHistory = 1000;
    this.alertChannels = [];
    this.alertRules = [];
    this.alertHistoryPath =
      options.alertHistoryPath || path.join(__dirname, '..', 'alert-history.json');

    this.loadAlertHistory();
  }

  addChannel(channel) {
    this.alertChannels.push(channel);
  }

  removeChannel(channelId) {
    this.alertChannels = this.alertChannels.filter((c) => c.id !== channelId);
  }

  addRule(rule) {
    this.alertRules.push(rule);
  }

  removeRule(ruleId) {
    this.alertRules = this.alertRules.filter((r) => r.id !== ruleId);
  }

  createAlert(alert) {
    const newAlert = {
      id: this.generateAlertId(),
      ...alert,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false,
    };

    this.alertHistory.push(newAlert);
    if (this.alertHistory.length > this.maxAlertHistory) {
      this.alertHistory.shift();
    }

    this.sendAlert(newAlert);
    this.saveAlertHistory();

    return newAlert;
  }

  generateAlertId() {
    return 'alert_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  async sendAlert(alert) {
    for (const channel of this.alertChannels) {
      try {
        await channel.send(alert);
      } catch (error) {
        console.error(`[Alert Manager] Failed to send alert via ${channel.name}:`, error);
      }
    }
  }

  acknowledgeAlert(alertId) {
    const alert = this.alertHistory.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      this.saveAlertHistory();
    }
    return alert;
  }

  resolveAlert(alertId) {
    const alert = this.alertHistory.find((a) => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      this.saveAlertHistory();
    }
    return alert;
  }

  getActiveAlerts() {
    return this.alertHistory.filter((a) => !a.resolved);
  }

  getAlertHistory(filters = {}) {
    let history = [...this.alertHistory];

    if (filters.level) {
      history = history.filter((a) => a.level === filters.level);
    }
    if (filters.startDate) {
      history = history.filter((a) => a.timestamp >= filters.startDate);
    }
    if (filters.endDate) {
      history = history.filter((a) => a.timestamp <= filters.endDate);
    }

    return history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  checkHealthStatus(healthStatus) {
    if (!healthStatus) {
      return;
    }

    const { overallStatus, checks } = healthStatus;

    for (const check of checks) {
      if (check.status === 'error' || check.status === 'warning') {
        this.createAlert({
          level: check.status === 'error' ? 'critical' : 'warning',
          source: check.name,
          message: check.message,
          details: check,
        });
      }
    }

    if (overallStatus === 'critical') {
      this.createAlert({
        level: 'critical',
        source: 'system',
        message: 'System overall health status is critical',
        details: healthStatus,
      });
    }
  }

  saveAlertHistory() {
    try {
      const dir = path.dirname(this.alertHistoryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.alertHistoryPath, JSON.stringify(this.alertHistory, null, 2));
    } catch (error) {
      console.error('[Alert Manager] Failed to save alert history:', error);
    }
  }

  loadAlertHistory() {
    try {
      if (fs.existsSync(this.alertHistoryPath)) {
        const data = fs.readFileSync(this.alertHistoryPath, 'utf8');
        this.alertHistory = JSON.parse(data);
      }
    } catch (error) {
      console.error('[Alert Manager] Failed to load alert history:', error);
      this.alertHistory = [];
    }
  }
}

// æŽ§åˆ¶å°å‘Šè­¦é€šé“
class ConsoleAlertChannel {
  constructor() {
    this.id = 'console';
    this.name = 'Console';
  }

  async send(alert) {
    const logMethod = alert.level === 'critical' ? console.error : console.warn;
    logMethod(`[ALERT] [${alert.level.toUpperCase()}] ${alert.message}`);
  }
}

// æ–‡ä»¶å‘Šè­¦é€šé“
class FileAlertChannel {
  constructor(filePath) {
    this.id = 'file';
    this.name = 'File';
    this.filePath = filePath || path.join(__dirname, '..', 'alerts.log');
  }

  async send(alert) {
    const logLine = `[${alert.timestamp}] [${alert.level.toUpperCase()}] ${alert.source}: ${alert.message}\n`;
    fs.appendFileSync(this.filePath, logLine);
  }
}

module.exports = {
  AlertManager,
  ConsoleAlertChannel,
  FileAlertChannel,
};
