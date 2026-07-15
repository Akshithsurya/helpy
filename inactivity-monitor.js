class InactivityMonitor {
  constructor(options = {}) {
    this.logger = options.logger || {
      info: function () {},
      error: function () {},
      warn: function () {},
      debug: function () {},
    };
    this.inactivityThreshold = options.inactivityThreshold || 5 * 60 * 1000; // 5 minutes
    this.checkInterval = options.checkInterval || 1000; // 1 second
    this.lastActivityTime = Date.now();
    this.intervalId = null;
    this.isMonitoring = false;
    this.reminderCallback = options.reminderCallback || null;
  }

  startActivityMonitoring() {
    if (this.isMonitoring) {
      this.logger.warn('Inactivity monitoring already started');
      return;
    }
    this.isMonitoring = true;
    this.lastActivityTime = Date.now();
    this.logger.info('Starting inactivity monitoring');
    this.intervalId = setInterval(() => this._checkInactivity(), this.checkInterval);
  }

  stopActivityMonitoring() {
    if (!this.isMonitoring) {
      this.logger.warn('Inactivity monitoring not started');
      return;
    }
    this.isMonitoring = false;
    this.logger.info('Stopping inactivity monitoring');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  recordActivity() {
    this.lastActivityTime = Date.now();
    this.logger.debug('Activity recorded');
  }

  setInactivityThreshold(thresholdMs) {
    this.inactivityThreshold = thresholdMs;
    this.logger.info(`Inactivity threshold set to ${thresholdMs}ms`);
  }

  setReminderCallback(callback) {
    this.reminderCallback = callback;
  }

  _checkInactivity() {
    const now = Date.now();
    const inactiveTime = now - this.lastActivityTime;
    if (inactiveTime >= this.inactivityThreshold) {
      this.logger.warn(`User inactive for ${inactiveTime}ms`);
      if (this.reminderCallback) {
        this.reminderCallback(inactiveTime);
      }
    }
  }

  getInactiveTime() {
    return Date.now() - this.lastActivityTime;
  }
}

module.exports = InactivityMonitor;
