const util = require('util');

const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

class Logger {
  constructor(prefix = '') {
    this.prefix = prefix ? '[' + prefix + '] ' : '';
    this.level = LOG_LEVELS.INFO;
  }

  setLevel(level) {
    if (Object.values(LOG_LEVELS).indexOf(level) !== -1) {
      this.level = level;
    }
  }

  _format() {
    const args = Array.prototype.slice.call(arguments);
    const message = args
      .map(function (arg) {
        return typeof arg === 'object'
          ? util.inspect(arg, { depth: null, colors: false })
          : String(arg);
      })
      .join(' ');
    return this.prefix + message;
  }

  _shouldLog(level) {
    const levels = [LOG_LEVELS.DEBUG, LOG_LEVELS.INFO, LOG_LEVELS.WARN, LOG_LEVELS.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug() {
    if (this._shouldLog(LOG_LEVELS.DEBUG)) {
      console.debug(this._format('[DEBUG]', Array.prototype.slice.call(arguments)));
    }
  }

  info() {
    if (this._shouldLog(LOG_LEVELS.INFO)) {
      console.info(this._format('[INFO]', Array.prototype.slice.call(arguments)));
    }
  }

  warn() {
    if (this._shouldLog(LOG_LEVELS.WARN)) {
      console.warn(this._format('[WARN]', Array.prototype.slice.call(arguments)));
    }
  }

  error() {
    if (this._shouldLog(LOG_LEVELS.ERROR)) {
      console.error(this._format('[ERROR]', Array.prototype.slice.call(arguments)));
    }
  }

  createChild(prefix) {
    const childPrefix = this.prefix + '[' + prefix + ']';
    return new Logger(childPrefix);
  }
}

module.exports = Logger;
