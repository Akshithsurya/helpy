const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileStore, cloneFallback } = require('../shared/file-store');

describe('file-store utilities', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpy-file-store-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('cloneFallback', () => {
    test('should clone primitive values', () => {
      expect(cloneFallback(42)).toBe(42);
      expect(cloneFallback('test')).toBe('test');
      expect(cloneFallback(true)).toBe(true);
      expect(cloneFallback(null)).toBe(null);
      expect(cloneFallback(undefined)).toBe(undefined);
    });

    test('should deep clone arrays', () => {
      const original = [1, 2, { a: 3 }, [4, 5]];
      const cloned = cloneFallback(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[2]).not.toBe(original[2]);
      expect(cloned[3]).not.toBe(original[3]);
    });

    test('should deep clone objects', () => {
      const original = { a: 1, b: { c: 2 }, d: [3, 4] };
      const cloned = cloneFallback(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
      expect(cloned.d).not.toBe(original.d);
    });

    test('should handle nested structures correctly', () => {
      const original = {
        level1: {
          level2: {
            level3: 'value',
            array: [1, 2, { nested: true }],
          },
        },
      };
      const cloned = cloneFallback(original);
      expect(cloned).toEqual(original);
      expect(cloned.level1).not.toBe(original.level1);
      expect(cloned.level1.level2).not.toBe(original.level1.level2);
      expect(cloned.level1.level2.array).not.toBe(original.level1.level2.array);
    });
  });

  describe('FileStore', () => {
    test('should load a cloned fallback value when the file is missing', () => {
      const fallbackValue = [{ title: 'Missing file fallback' }];
      const store = new FileStore(path.join(tempDir, 'missing.json'), fallbackValue);

      const loaded = store.load();

      expect(loaded).toEqual(fallbackValue);
      expect(loaded).not.toBe(fallbackValue);
      expect(loaded[0]).not.toBe(fallbackValue[0]);
    });

    test('should save validated content atomically and reload it', () => {
      const validator = (value) =>
        Array.isArray(value) ? value.filter((item) => item && item.enabled !== false) : [];
      const filePath = path.join(tempDir, 'store.json');
      const store = new FileStore(filePath, [], validator);

      const saved = store.save([
        { id: 1, enabled: true },
        { id: 2, enabled: false },
      ]);

      expect(saved).toEqual([{ id: 1, enabled: true }]);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
      expect(store.load()).toEqual([{ id: 1, enabled: true }]);
    });

    test('should fall back safely when stored json becomes invalid', () => {
      const filePath = path.join(tempDir, 'broken.json');
      fs.writeFileSync(filePath, '{"broken":', 'utf8');
      const store = new FileStore(filePath, { status: 'fallback' });

      expect(store.load()).toEqual({ status: 'fallback' });
    });
  });
});
