const activeWin = require('active-win');
const { appHistoryStore } = require('./history-store');

class ActivityTracker {
  constructor(options = {}) {
    this.logger = options.logger || {
      info: function () {},
      error: function () {},
      warn: function () {},
      debug: function () {},
    };
    this.pollInterval = options.pollInterval || 1000; // 1 second
    this.intervalId = null;
    this.currentApp = null;
    this.currentAppStartTime = null;
    this.isTracking = false;
  }

  startTracking() {
    if (this.isTracking) {
      this.logger.warn('Activity tracking already started');
      return;
    }
    this.isTracking = true;
    this.logger.info('Starting activity tracking');
    this._tick();
    this.intervalId = setInterval(() => this._tick(), this.pollInterval);
  }

  stopTracking() {
    if (!this.isTracking) {
      this.logger.warn('Activity tracking not started');
      return;
    }
    this.isTracking = false;
    this.logger.info('Stopping activity tracking');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this._finalizeCurrentApp();
  }

  async _tick() {
    try {
      const window = await activeWin();
      if (!window) {
        return;
      }

      const appName = window.owner?.name || 'Unknown';

      if (this.currentApp !== appName) {
        this._finalizeCurrentApp();
        this.currentApp = appName;
        this.currentAppStartTime = Date.now();
      }
    } catch (error) {
      this.logger.error('Error tracking active window', error);
    }
  }

  _finalizeCurrentApp() {
    if (this.currentApp && this.currentAppStartTime) {
      const endTime = Date.now();
      const duration = endTime - this.currentAppStartTime;
      const entry = {
        appName: this.currentApp,
        windowTitle: this.currentApp,
        startTime: this.currentAppStartTime,
        endTime,
        duration,
      };
      this._saveEntry(entry);
      this.logger.debug(`App usage logged: ${this.currentApp} - ${duration}ms`);
      this.currentApp = null;
      this.currentAppStartTime = null;
    }
  }

  _saveEntry(entry) {
    try {
      const history = appHistoryStore.load();
      history.push(entry);
      appHistoryStore.save(history);
    } catch (error) {
      this.logger.error('Error saving activity entry', error);
    }
  }

  getActivityHistory(limit = 100) {
    try {
      const history = appHistoryStore.load();
      return history.slice(-limit);
    } catch (error) {
      this.logger.error('Error loading activity history', error);
      return [];
    }
  }

  getAppUsageStats(days = 7) {
    try {
      const history = appHistoryStore.load();
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const recentEntries = history.filter((e) => e.startTime > cutoff);
      const appStats = {};
      recentEntries.forEach((entry) => {
        if (!appStats[entry.appName]) {
          appStats[entry.appName] = { totalDuration: 0, count: 0 };
        }
        appStats[entry.appName].totalDuration += entry.duration || 0;
        appStats[entry.appName].count += 1;
      });
      return appStats;
    } catch (error) {
      this.logger.error('Error calculating app usage stats', error);
      return {};
    }
  }
}

module.exports = ActivityTracker;
