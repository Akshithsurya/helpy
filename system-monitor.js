const Store = require('electron-store');

class SystemMonitor {
  constructor() {
    this.store = new Store();
    this.monitorInterval = null;
    this.latestData = this.loadLatestData();
  }

  loadLatestData() {
    return this.store.get('systemMonitorData', { windows: [], tabs: [], timestamp: null });
  }

  saveLatestData() {
    this.store.set('systemMonitorData', this.latestData);
  }

  async collectData() {
    const timestamp = new Date().toISOString();

    // For browser tabs and windows, we'll rely on the browser extension
    this.latestData = {
      windows: [],
      tabs: [], // Will be populated by browser extension
      timestamp,
    };

    this.saveLatestData();
    console.log('System monitor data collected:', this.latestData);
  }

  startMonitoring() {
    // Monitor every 10 minutes as requested
    this.monitorInterval = setInterval(() => this.collectData(), 10 * 60 * 1000);
    // Collect immediately on start
    this.collectData();
  }

  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
  }

  getLatestData() {
    return this.latestData;
  }
}

module.exports = SystemMonitor;
