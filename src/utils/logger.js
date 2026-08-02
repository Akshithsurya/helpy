'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.logger = exports.LogLevel = void 0;
var LogLevel;
(function (LogLevel) {
  LogLevel[(LogLevel['DEBUG'] = 0)] = 'DEBUG';
  LogLevel[(LogLevel['INFO'] = 1)] = 'INFO';
  LogLevel[(LogLevel['WARN'] = 2)] = 'WARN';
  LogLevel[(LogLevel['ERROR'] = 3)] = 'ERROR';
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class Logger {
  constructor() {
    this.logHistory = [];
    this.maxHistorySize = 1000;
    this.currentLevel = LogLevel.INFO;
  }
  setLevel(level) {
    this.currentLevel = level;
  }
  debug(message, metadata) {
    this.log(LogLevel.DEBUG, message, metadata);
  }
  info(message, metadata) {
    this.log(LogLevel.INFO, message, metadata);
  }
  warn(message, metadata) {
    this.log(LogLevel.WARN, message, metadata);
  }
  error(message, metadata) {
    this.log(LogLevel.ERROR, message, metadata);
  }
  log(level, message, metadata) {
    if (level < this.currentLevel) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
    this.output(entry);
  }
  output(entry) {
    const levelStr = LogLevel[entry.level].toLowerCase();
    const output = `[${entry.timestamp}] [${levelStr.toUpperCase()}] ${entry.message}`;
    if (entry.level >= LogLevel.ERROR) {
      console.error(output, entry.metadata || '');
    } else if (entry.level === LogLevel.WARN) {
      console.warn(output, entry.metadata || '');
    } else {
      console.log(output, entry.metadata || '');
    }
  }
  getHistory(level) {
    if (level !== undefined) {
      return this.logHistory.filter((entry) => entry.level === level);
    }
    return [...this.logHistory];
  }
  clearHistory() {
    this.logHistory = [];
  }
  exportHistory() {
    return JSON.stringify(this.logHistory, null, 2);
  }
  // Helper method to get history as a formatted string
  getHistoryString() {
    return this.logHistory
      .map((entry) => {
        const levelStr = LogLevel[entry.level].toLowerCase();
        const metaStr = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : '';
        return `[${entry.timestamp}] [${levelStr.toUpperCase()}] ${entry.message}${metaStr}`;
      })
      .join('\n');
  }
}
exports.logger = new Logger();
