/**
 * Represents a single timer with start, pause, resume, and stop functionality
 * @class Timer
 */
class Timer {
  /**
   * Creates a new Timer instance
   * @param {Object} options - Timer configuration
   * @param {string} [options.id] - Unique identifier for the timer (auto-generated if not provided)
   * @param {string} [options.name='Unnamed Timer'] - Name of the timer
   * @param {string} [options.description=''] - Description of the timer
   * @param {number|null} [options.timeoutDuration] - Timeout duration in milliseconds
   * @param {Function|null} [options.onTimeout] - Callback when timer times out
   */
  constructor(options = {}) {
    /** @type {string} */
    this.id = options.id || `timer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    /** @type {string} */
    this.name = options.name || 'Unnamed Timer';

    /** @type {string} */
    this.description = options.description || '';

    /** @type {number|null} */
    this.timeoutDuration = options.timeoutDuration || null;

    /** @type {Date|null} */
    this.startTime = null;

    /** @type {Date|null} */
    this.endTime = null;

    /** @type {Date|null} */
    this.pauseTime = null;

    /** @type {number} */
    this.totalPausedDuration = 0;

    /** @type {boolean} */
    this.isRunning = false;

    /** @type {boolean} */
    this.isPaused = false;

    /** @type {NodeJS.Timeout|null} */
    this.timeoutId = null;

    /** @type {Array<{timestamp: string, action: string, elapsedTime: number}>} */
    this.logs = [];

    /** @type {Function|null} */
    this.onTimeout = options.onTimeout || null;
  }

  /**
   * Starts the timer
   * @returns {Timer} The timer instance for method chaining
   * @throws {Error} If timer is already running
   */
  start() {
    if (this.isRunning) {
      throw new Error('Timer is already running');
    }

    this.startTime = new Date();
    this.isRunning = true;
    this.isPaused = false;
    this._log('START');

    if (this.timeoutDuration) {
      this._setTimeout();
    }

    return this;
  }

  /**
   * Pauses the timer
   * @returns {Timer} The timer instance for method chaining
   * @throws {Error} If timer is not running or already paused
   */
  pause() {
    if (!this.isRunning || this.isPaused) {
      throw new Error('Timer is not running or already paused');
    }

    this.pauseTime = new Date();
    this.isPaused = true;
    this._clearTimeout();
    this._log('PAUSE');

    return this;
  }

  /**
   * Resumes a paused timer
   * @returns {Timer} The timer instance for method chaining
   * @throws {Error} If timer is not paused
   */
  resume() {
    if (!this.isPaused) {
      throw new Error('Timer is not paused');
    }

    if (this.pauseTime) {
      const pausedDuration = new Date() - this.pauseTime;
      this.totalPausedDuration += pausedDuration;
      this.pauseTime = null;
    }

    this.isPaused = false;
    this._log('RESUME');

    if (this.timeoutDuration) {
      this._setTimeout();
    }

    return this;
  }

  /**
   * Stops the timer
   * @returns {Timer} The timer instance for method chaining
   * @throws {Error} If timer is not running
   */
  stop() {
    if (!this.isRunning) {
      throw new Error('Timer is not running');
    }

    this.endTime = new Date();
    this.isRunning = false;
    this.isPaused = false;
    this._clearTimeout();
    this._log('STOP');

    return this;
  }

  /**
   * Gets the elapsed time in milliseconds
   * @returns {number} Elapsed time in milliseconds
   */
  getElapsedTime() {
    if (!this.startTime) {
      return 0;
    }

    const end = this.endTime || (this.isPaused ? this.pauseTime : new Date());
    const totalElapsed = end - this.startTime - this.totalPausedDuration;

    return Math.max(0, totalElapsed);
  }

  /**
   * Resets the timer to initial state
   * @returns {Timer} The timer instance for method chaining
   */
  reset() {
    this._clearTimeout();
    this.startTime = null;
    this.endTime = null;
    this.pauseTime = null;
    this.totalPausedDuration = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.logs = [];

    return this;
  }

  /**
   * Gets the current state of the timer
   * @returns {Object} Timer state
   */
  getState() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      startTime: this.startTime ? this.startTime.toISOString() : null,
      endTime: this.endTime ? this.endTime.toISOString() : null,
      pauseTime: this.pauseTime ? this.pauseTime.toISOString() : null,
      totalPausedDuration: this.totalPausedDuration,
      elapsedTime: this.getElapsedTime(),
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      timeoutDuration: this.timeoutDuration,
      logs: [...this.logs],
    };
  }

  /**
   * Sets up timeout callback (internal method)
   * @private
   */
  _setTimeout() {
    if (this.timeoutDuration && this.onTimeout) {
      const remainingTime = this.timeoutDuration - this.getElapsedTime();
      if (remainingTime > 0) {
        this.timeoutId = setTimeout(() => {
          this._log('TIMEOUT');
          if (this.onTimeout) {
            this.onTimeout(this.getState());
          }
        }, remainingTime);
      } else {
        this._log('TIMEOUT');
        if (this.onTimeout) {
          this.onTimeout(this.getState());
        }
      }
    }
  }

  /**
   * Clears timeout (internal method)
   * @private
   */
  _clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Logs an action (internal method)
   * @param {string} action - Action to log
   * @private
   */
  _log(action) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      action,
      elapsedTime: this.getElapsedTime(),
    });
  }
}

/**
 * Manages multiple timers
 * @class TimerManager
 */
class TimerManager {
  /**
   * Creates a new TimerManager instance
   */
  constructor() {
    /** @type {Map<string, Timer>} */
    this.timers = new Map();
  }

  /**
   * Creates a new timer and adds it to the manager
   * @param {Object} options - Timer options
   * @returns {Timer} New timer instance
   */
  createTimer(options) {
    const timer = new Timer(options);
    this.timers.set(timer.id, timer);
    return timer;
  }

  /**
   * Gets a timer by ID
   * @param {string} id - Timer ID
   * @returns {Timer|undefined} Timer instance if found
   */
  getTimer(id) {
    return this.timers.get(id);
  }

  /**
   * Gets all timers' states
   * @returns {Array<Object>} Array of timer states
   */
  getAllTimers() {
    return Array.from(this.timers.values()).map((timer) => timer.getState());
  }

  /**
   * Removes a timer by ID
   * @param {string} id - Timer ID
   * @returns {boolean} True if timer was removed, false if not found
   */
  removeTimer(id) {
    const timer = this.timers.get(id);
    if (timer) {
      if (timer.isRunning) {
        timer.stop();
      }
      timer.reset();
      this.timers.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Clears all timers
   */
  clearAllTimers() {
    for (const timer of this.timers.values()) {
      if (timer.isRunning) {
        timer.stop();
      }
      timer.reset();
    }
    this.timers.clear();
  }
}

module.exports = { Timer, TimerManager };
