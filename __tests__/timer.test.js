const { Timer, TimerManager } = require('../timer.js');

describe('Timer', () => {
  describe('Basic functionality', () => {
    test('should create a timer with default values', () => {
      const timer = new Timer();
      expect(timer.isRunning).toBe(false);
      expect(timer.isPaused).toBe(false);
      expect(timer.name).toBe('Unnamed Timer');
    });

    test('should create a timer with custom options', () => {
      const options = {
        id: 'custom-timer',
        name: 'Test Timer',
        description: 'A test timer',
        timeoutDuration: 10000,
      };
      const timer = new Timer(options);
      expect(timer.id).toBe('custom-timer');
      expect(timer.name).toBe('Test Timer');
      expect(timer.description).toBe('A test timer');
      expect(timer.timeoutDuration).toBe(10000);
    });

    test('should start the timer', () => {
      const timer = new Timer();
      timer.start();
      expect(timer.isRunning).toBe(true);
      expect(timer.startTime).not.toBeNull();
    });

    test('should throw error when starting already running timer', () => {
      const timer = new Timer();
      timer.start();
      expect(() => timer.start()).toThrow('Timer is already running');
    });

    test('should pause and resume the timer', () => {
      const timer = new Timer();
      timer.start();
      timer.pause();
      expect(timer.isPaused).toBe(true);
      timer.resume();
      expect(timer.isPaused).toBe(false);
    });

    test('should throw error when pausing non-running timer', () => {
      const timer = new Timer();
      expect(() => timer.pause()).toThrow('Timer is not running or already paused');
    });

    test('should stop the timer', () => {
      const timer = new Timer();
      timer.start();
      timer.stop();
      expect(timer.isRunning).toBe(false);
      expect(timer.endTime).not.toBeNull();
    });

    test('should throw error when stopping non-running timer', () => {
      const timer = new Timer();
      expect(() => timer.stop()).toThrow('Timer is not running');
    });

    test('should reset the timer', () => {
      const timer = new Timer();
      timer.start();
      timer.stop();
      timer.reset();
      expect(timer.isRunning).toBe(false);
      expect(timer.startTime).toBeNull();
      expect(timer.endTime).toBeNull();
    });

    test('should get elapsed time', () => {
      const timer = new Timer();
      expect(timer.getElapsedTime()).toBe(0);
      timer.start();
      expect(timer.getElapsedTime()).toBeGreaterThanOrEqual(0);
      timer.stop();
      expect(timer.getElapsedTime()).toBeGreaterThanOrEqual(0);
    });

    test('should get timer state', () => {
      const timer = new Timer();
      const state = timer.getState();
      expect(state).toHaveProperty('id');
      expect(state).toHaveProperty('name');
      expect(state).toHaveProperty('elapsedTime');
      expect(state).toHaveProperty('isRunning');
    });
  });

  describe('Timeout functionality', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should trigger timeout callback after specified duration', () => {
      const timeoutCallback = jest.fn();
      const timer = new Timer({
        timeoutDuration: 1000,
        onTimeout: timeoutCallback,
      });

      timer.start();
      jest.advanceTimersByTime(1000);

      expect(timeoutCallback).toHaveBeenCalled();
    });
  });

  describe('Logging', () => {
    test('should log actions', () => {
      const timer = new Timer();
      timer.start();
      timer.pause();
      timer.resume();
      timer.stop();

      expect(timer.logs.length).toBe(4);
      expect(timer.logs[0].action).toBe('START');
      expect(timer.logs[1].action).toBe('PAUSE');
      expect(timer.logs[2].action).toBe('RESUME');
      expect(timer.logs[3].action).toBe('STOP');
    });
  });
});

describe('TimerManager', () => {
  test('should create and manage multiple timers', () => {
    const manager = new TimerManager();

    const timer1 = manager.createTimer({ name: 'Timer 1' });
    const timer2 = manager.createTimer({ name: 'Timer 2' });

    expect(manager.getAllTimers().length).toBe(2);
    expect(manager.getTimer(timer1.id)).toBe(timer1);
    expect(manager.getTimer(timer2.id)).toBe(timer2);
  });

  test('should remove a timer', () => {
    const manager = new TimerManager();
    const timer = manager.createTimer();

    expect(manager.removeTimer(timer.id)).toBe(true);
    expect(manager.getAllTimers().length).toBe(0);
  });

  test('should clear all timers', () => {
    const manager = new TimerManager();
    manager.createTimer();
    manager.createTimer();

    manager.clearAllTimers();
    expect(manager.getAllTimers().length).toBe(0);
  });
});
