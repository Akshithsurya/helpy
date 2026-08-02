const activeWin = require('active-win');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { appHistoryStore } = require('./history-store');
const { getDataDirectory } = require('./shared/app-paths');

function inlineDebounce(fn, wait) {
  let timer = null;
  const debounced = function () {
    const args = arguments;
    const ctx = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(ctx, args);
    }, wait);
  };
  debounced.cancel = function () {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  debounced.flush = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn.apply(this, arguments);
    }
  };
  return debounced;
}

class ActivityTracker {
  constructor(options = {}) {
    this.logger = options.logger || {
      info: function () {},
      error: function () {},
      warn: function () {},
      debug: function () {},
    };
    this.pollInterval = options.pollInterval || 2000;
    this.intervalId = null;
    this.currentApp = null;
    this.currentAppStartTime = null;
    this.isTracking = false;

    this.pendingEntries = [];
    this.flushTimerId = null;
    this.flushPending = false;
    this.needsFlush = false;

    this._finalizeCurrentAppDebounced = inlineDebounce(
      this._finalizeCurrentAppImmediate.bind(this),
      200
    );

    this._registerExitHooks();
  }

  _registerExitHooks() {
    try {
      if (typeof process !== 'undefined' && process && typeof process.on === 'function') {
        const doFlush = () => this._syncFlushFallback();
        process.on('beforeExit', doFlush);
        process.on('SIGTERM', doFlush);
        process.on('SIGINT', doFlush);
      }
    } catch (e) {
      // ignore (browser environment)
    }
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
    if (this.intervalId && typeof this.intervalId.unref === 'function') {
      try { this.intervalId.unref(); } catch (_) {}
    }
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
    this._finalizeCurrentAppDebounced.cancel();
    this._finalizeCurrentAppImmediate();
    this._syncFlushFallback();
  }

  async _tick() {
    try {
      const window = await activeWin();
      if (!window) {
        return;
      }

      const appName = window.owner?.name || 'Unknown';

      if (this.currentApp !== appName) {
        this._finalizeCurrentAppDebounced();
        this.currentApp = appName;
        this.currentAppStartTime = Date.now();
      }
    } catch (error) {
      this.logger.error('Error tracking active window', error);
    }
  }

  _finalizeCurrentAppImmediate() {
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

  _finalizeCurrentApp() {
    this._finalizeCurrentAppDebounced();
  }

  _saveEntry(entry) {
    this.pendingEntries.push(entry);
    this.needsFlush = true;

    if (this.pendingEntries.length > 1000) {
      this.pendingEntries.splice(0, this.pendingEntries.length - 1000);
    }

    if (!this.flushTimerId || this.pendingEntries.length >= 10) {
      if (this.flushTimerId) {
        clearTimeout(this.flushTimerId);
      }
      this.flushTimerId = setTimeout(() => this.flushPendingEntries(), 5000);
    }
  }

  async flushPendingEntries(forceSync = false) {
    if (forceSync) {
      this._syncFlushFallback();
      return;
    }
    if (this.flushPending) return;
    this.flushPending = true;
    if (this.flushTimerId) {
      clearTimeout(this.flushTimerId);
      this.flushTimerId = null;
    }
    const toWrite = this.pendingEntries;
    this.pendingEntries = [];
    this.needsFlush = false;

    if (toWrite.length === 0) {
      this.flushPending = false;
      return;
    }

    try {
      const dataDir = getDataDirectory();
      const filePath = path.join(dataDir, 'app-history.json');
      let history = [];
      try {
        const raw = await fsp.readFile(filePath, 'utf8');
        history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
      } catch (_) {
        history = [];
      }
      history.push(...toWrite);
      const capCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const pruned = history.length > 5000
        ? history.filter((e) => (e.startTime || 0) >= capCutoff).slice(-5000)
        : history;
      await fsp.writeFile(filePath, JSON.stringify(pruned), 'utf8');
    } catch (error) {
      this.logger.error('Error async flushing activity entries', error);
      this.pendingEntries.unshift(...toWrite);
      if (this.pendingEntries.length > 2000) {
        this.pendingEntries.splice(0, this.pendingEntries.length - 2000);
      }
      if (!this.flushTimerId) {
        this.flushTimerId = setTimeout(() => this.flushPendingEntries(), 10000);
      }
    } finally {
      this.flushPending = false;
    }
  }

  _syncFlushFallback() {
    if (this.pendingEntries.length === 0) return;
    try {
      const toWrite = this.pendingEntries;
      this.pendingEntries = [];
      this.needsFlush = false;
      const history = appHistoryStore.load();
      history.push(...toWrite);
      appHistoryStore.save(history);
    } catch (error) {
      this.logger.error('Error sync flushing activity entries', error);
    }
  }

  getActivityHistory(limit = 100) {
    try {
      const history = appHistoryStore.load();
      const pendingForRead = [...this.pendingEntries];
      const combined = history.concat(pendingForRead);
      return combined.slice(-limit);
    } catch (error) {
      this.logger.error('Error loading activity history', error);
      return [];
    }
  }

  getAppUsageStats(days = 7) {
    try {
      const history = appHistoryStore.load();
      const combined = history.concat(this.pendingEntries);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const recentEntries = combined.filter((e) => e.startTime > cutoff);
      const appStats = {};
      for (let i = 0; i < recentEntries.length; i++) {
        const entry = recentEntries[i];
        if (!appStats[entry.appName]) {
          appStats[entry.appName] = { totalDuration: 0, count: 0 };
        }
        appStats[entry.appName].totalDuration += entry.duration || 0;
        appStats[entry.appName].count += 1;
      }
      return appStats;
    } catch (error) {
      this.logger.error('Error calculating app usage stats', error);
      return {};
    }
  }
}

module.exports = ActivityTracker;
