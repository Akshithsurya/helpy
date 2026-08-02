const { logger, LogLevel } = require('../src/utils/logger');

describe('Logger', () => {
  beforeEach(() => {
    logger.clearHistory();
    logger.setLevel(LogLevel.DEBUG);
  });

  test('should log messages at different levels', () => {
    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warn message');
    logger.error('Error message');

    const history = logger.getHistory();
    expect(history.length).toBe(4);
    expect(history[0].message).toBe('Debug message');
    expect(history[1].message).toBe('Info message');
    expect(history[2].message).toBe('Warn message');
    expect(history[3].message).toBe('Error message');
  });

  test('should filter messages by level', () => {
    logger.setLevel(LogLevel.WARN);
    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warn message');
    logger.error('Error message');

    const history = logger.getHistory();
    expect(history.length).toBe(2);
  });

  test('should export history as JSON', () => {
    logger.info('Test message');
    const json = logger.exportHistory();
    expect(typeof json).toBe('string');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('should get history as formatted string', () => {
    logger.info('Test message');
    const str = logger.getHistoryString();
    expect(typeof str).toBe('string');
    expect(str).toContain('Test message');
  });
});
