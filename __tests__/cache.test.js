const { Cache } = require('../src/utils/cache');

describe('Cache', () => {
  let cache;

  beforeEach(() => {
    cache = new Cache(100); // 100ms TTL for tests
  });

  test('should set and get values', () => {
    cache.set('test', 'value');
    expect(cache.get('test')).toBe('value');
  });

  test('should check if key exists', () => {
    cache.set('test', 'value');
    expect(cache.has('test')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  test('should delete keys', () => {
    cache.set('test', 'value');
    expect(cache.delete('test')).toBe(true);
    expect(cache.has('test')).toBe(false);
  });

  test('should clear all keys', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  test('should respect TTL', async () => {
    cache.set('test', 'value', 50); // 50ms TTL
    expect(cache.get('test')).toBe('value');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cache.get('test')).toBeUndefined();
  });
});
