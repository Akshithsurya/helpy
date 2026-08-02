// Integration Tests for Multi-language Modules
const { SecurityManager, BehaviorAnalytics, PlanEnhancer } = require('../src/coffee-compiled');

describe('Multi-language Integration Tests', () => {
  describe('SecurityManager Module', () => {
    let security;

    beforeEach(() => {
      security = new SecurityManager();
    });

    test('should encrypt and decrypt data correctly', () => {
      const originalData = { message: 'Hello, multi-language integration!', plan: 'test-plan-123' };
      const encrypted = security.encrypt(originalData);
      const decrypted = security.decrypt(encrypted);

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(originalData);
    });

    test('should hash and verify hash', async () => {
      const data = 'sensitive data to hash';
      const hashed = await security.hash(data);

      expect(await security.verifyHash(data, hashed)).toBe(true);
      expect(await security.verifyHash('wrong data', hashed)).toBe(false);
    });

    test('should generate secure tokens', () => {
      const token1 = security.generateToken();
      const token2 = security.generateToken();

      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(0);
    });
  });

  describe('BehaviorAnalytics Module', () => {
    let analytics;
    let mockStore;

    beforeEach(() => {
      mockStore = {
        data: {},
        get: jest.fn((key) => mockStore.data[key] || []),
        set: jest.fn((key, value) => {
          mockStore.data[key] = value;
        }),
      };
      analytics = new BehaviorAnalytics(mockStore);
    });

    test('should track events', () => {
      const event = analytics.trackEvent('test-event', { test: 'data' });

      expect(event).not.toBeNull();
      expect(event.id).toBeTruthy();
      expect(event.type).toBe('test-event');
    });

    test('should track plan actions', () => {
      analytics.trackPlanAction('create', 'plan-1', { duration: 60 });
      analytics.flush();

      expect(mockStore.set).toHaveBeenCalled();
    });

    test('should generate usage statistics', () => {
      analytics.trackEvent('test1');
      analytics.trackEvent('test2');

      const stats = analytics.getUsageStatistics(1);

      expect(stats.totalEvents).toBeGreaterThan(0);
    });

    test('should provide personalized suggestions', () => {
      analytics.trackPlanAction('complete', 'plan-1', {});

      const suggestions = analytics.getPersonalizedSuggestions();

      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('PlanEnhancer Module', () => {
    let enhancer;

    beforeEach(() => {
      enhancer = new PlanEnhancer(null);
    });

    test('should generate fallback plans without Wasm', () => {
      const plan = enhancer.generateOptimizedPlan(120, {
        chunkSize: 25,
        breakDuration: 5,
      });

      expect(plan).not.toBeNull();
      expect(plan.chunkSize).toBe(25);
      expect(plan.breakDuration).toBe(5);
    });

    test('should recommend presets', () => {
      const preset = enhancer.recommendPreset({ averageSession: 30 });

      expect(preset).not.toBeNull();
      expect(preset.name).toBeTruthy();
    });

    test('should decompose tasks', () => {
      const task = { title: 'Test Task', duration: 120 };
      const chunks = enhancer.decomposeTask(task, 30);

      expect(chunks.length).toBe(4);
      expect(chunks[0].duration).toBe(30);
    });

    test('should calculate efficiency score', () => {
      const plan = {
        tasks: [
          { completed: true, completedOnTime: true },
          { completed: true, completedOnTime: true },
          { completed: false, completedOnTime: false },
        ],
      };

      const score = enhancer.calculateEfficiencyScore(plan);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('Cross-module Integration', () => {
    test('Security and Analytics should work together', () => {
      const security = new SecurityManager();
      const analytics = new BehaviorAnalytics(null);

      // Track an event
      const event = analytics.trackEvent('integration-test', { timestamp: Date.now() });

      // Encrypt the event data
      const encrypted = security.encrypt(event);

      // Decrypt and verify
      const decrypted = security.decrypt(encrypted);

      expect(decrypted.id).toBe(event.id);
      expect(decrypted.type).toBe(event.type);
    });

    test('PlanEnhancer should handle optimization with behavioral data', () => {
      const analytics = new BehaviorAnalytics(null);
      const enhancer = new PlanEnhancer(null);

      // Track some usage
      analytics.trackPlanAction('create', 'plan-1', { duration: 90 });

      // Get stats and use for optimization
      const stats = analytics.getUsageStatistics(7);

      // Generate a plan based on stats
      const plan = enhancer.generateOptimizedPlan(90, {
        chunkSize: 30,
        breakDuration: 5,
      });

      expect(plan).not.toBeNull();
    });
  });

  describe('Performance Tests', () => {
    test('should handle 1000 events efficiently', () => {
      const analytics = new BehaviorAnalytics(null);
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        analytics.trackEvent(`event-${i}`, { index: i });
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in under 2 seconds under test runner load
      expect(duration).toBeLessThan(2000);
    });

    test('encryption should be fast', () => {
      const security = new SecurityManager();
      const testData = {
        tasks: Array(100).fill({ id: 'test', data: 'some data' }),
      };

      const startTime = Date.now();
      const encrypted = security.encrypt(testData);
      const decrypted = security.decrypt(encrypted);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);
      expect(decrypted).toEqual(testData);
    });
  });
});
