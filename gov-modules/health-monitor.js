/**
 * æ”¿åŠ¡çº§å¥åº·ç›‘æŽ§æ¨¡å—
 * ç›‘æŽ§ç³»ç»Ÿå„ä¸ªç»„ä»¶çš„å¥åº·çŠ¶æ€
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

class HealthMonitor {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval || 30000; // 30ç§’
    this.alertThreshold = options.alertThreshold || {
      cpu: 80,
      memory: 85,
      disk: 90,
    };
    this.healthHistory = [];
    this.maxHistoryLength = 100;
    this.checks = [];
    this.isRunning = false;
    this.monitorInterval = null;

    this.initializeDefaultChecks();
  }

  initializeDefaultChecks() {
    // ç³»ç»Ÿèµ„æºæ£€æŸ¥
    this.addCheck('cpu', this.checkCPU.bind(this));
    this.addCheck('memory', this.checkMemory.bind(this));
    this.addCheck('disk', this.checkDisk.bind(this));
    this.addCheck('process', this.checkProcess.bind(this));
  }

  addCheck(name, checkFn) {
    this.checks.push({ name, checkFn });
  }

  removeCheck(name) {
    this.checks = this.checks.filter((check) => check.name !== name);
  }

  async checkCPU() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const usage = 100 - ~~((100 * totalIdle) / totalTick);
    const status = usage > this.alertThreshold.cpu ? 'warning' : 'healthy';

    return {
      name: 'cpu',
      status,
      value: usage,
      unit: '%',
      message: usage > this.alertThreshold.cpu ? 'CPU usage is high' : 'CPU usage is normal',
      timestamp: new Date().toISOString(),
    };
  }

  async checkMemory() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const usagePercent = (usedMemory / totalMemory) * 100;
    const status = usagePercent > this.alertThreshold.memory ? 'warning' : 'healthy';

    return {
      name: 'memory',
      status,
      value: usagePercent.toFixed(2),
      unit: '%',
      details: {
        total: (totalMemory / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        used: (usedMemory / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        free: (freeMemory / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      },
      message:
        usagePercent > this.alertThreshold.memory
          ? 'Memory usage is high'
          : 'Memory usage is normal',
      timestamp: new Date().toISOString(),
    };
  }

  async checkDisk() {
    try {
      const platform = os.platform();
      let diskInfo = { total: 1, free: 1 };

      // ç®€åŒ–çš„ç£ç›˜æ£€æŸ¥ï¼ˆè¿™é‡Œéœ€è¦æ ¹æ®å®žé™…æ“ä½œç³»ç»Ÿè°ƒæ•´ï¼‰
      // å®žé™…é¡¹ç›®ä¸­å¯èƒ½éœ€è¦ä½¿ç”¨ç¬¬ä¸‰æ–¹åº“å¦‚ 'diskusage'
      if (platform === 'win32') {
        // Windows ç³»ç»Ÿæ£€æŸ¥
        const drives = ['C:', 'D:', 'E:'];
        for (let drive of drives) {
          try {
            const stats = fs.statfsSync(drive);
            diskInfo = {
              total: stats.blocks * stats.bsize,
              free: stats.bfree * stats.bsize,
            };
            break;
          } catch (e) {
            // ç»§ç»­å°è¯•ä¸‹ä¸€ä¸ªé©±åŠ¨å™¨
          }
        }
      } else {
        // Unix-like ç³»ç»Ÿ
        const stats = fs.statfsSync('/');
        diskInfo = {
          total: stats.blocks * stats.bsize,
          free: stats.bfree * stats.bsize,
        };
      }

      const used = diskInfo.total - diskInfo.free;
      const usagePercent = (used / diskInfo.total) * 100;
      const status = usagePercent > this.alertThreshold.disk ? 'warning' : 'healthy';

      return {
        name: 'disk',
        status,
        value: usagePercent.toFixed(2),
        unit: '%',
        details: {
          total: (diskInfo.total / 1024 / 1024 / 1024).toFixed(2) + ' GB',
          used: (used / 1024 / 1024 / 1024).toFixed(2) + ' GB',
          free: (diskInfo.free / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        },
        message:
          usagePercent > this.alertThreshold.disk ? 'Disk usage is high' : 'Disk usage is normal',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        name: 'disk',
        status: 'error',
        value: 'N/A',
        unit: '',
        message: 'Failed to check disk usage: ' + error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async checkProcess() {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const status = 'healthy';

    return {
      name: 'process',
      status,
      value: 'running',
      unit: '',
      details: {
        uptime: this.formatUptime(uptime),
        memory: (memoryUsage.rss / 1024 / 1024).toFixed(2) + ' MB',
      },
      message: 'Process is running normally',
      timestamp: new Date().toISOString(),
    };
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  }

  async runChecks() {
    const results = [];
    for (const check of this.checks) {
      try {
        const result = await check.checkFn();
        results.push(result);
      } catch (error) {
        results.push({
          name: check.name,
          status: 'error',
          value: 'N/A',
          unit: '',
          message: `Check failed: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.recordHealthHistory(results);
    return results;
  }

  getOverallStatus(checkResults) {
    const hasErrors = checkResults.some((r) => r.status === 'error');
    const hasWarnings = checkResults.some((r) => r.status === 'warning');

    if (hasErrors) {
      return 'critical';
    } else if (hasWarnings) {
      return 'warning';
    }
    return 'healthy';
  }

  recordHealthHistory(checkResults) {
    const record = {
      timestamp: new Date().toISOString(),
      overallStatus: this.getOverallStatus(checkResults),
      checks: checkResults,
    };

    this.healthHistory.push(record);
    if (this.healthHistory.length > this.maxHistoryLength) {
      this.healthHistory.shift();
    }
  }

  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('[Health Monitor] Starting health monitoring...');

    // ç«‹å³æ‰§è¡Œä¸€æ¬¡æ£€æŸ¥
    this.runChecks().catch(console.error);

    // è®¾ç½®å®šæ—¶æ£€æŸ¥
    this.monitorInterval = setInterval(() => {
      this.runChecks().catch(console.error);
    }, this.checkInterval);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    console.log('[Health Monitor] Stopped health monitoring');
  }

  getHealthHistory() {
    return this.healthHistory;
  }

  getCurrentStatus() {
    if (this.healthHistory.length === 0) {
      return null;
    }
    return this.healthHistory[this.healthHistory.length - 1];
  }
}

module.exports = { HealthMonitor };
