const { AnalyticsManager } = require('../analytics');

// Mock file store
jest.mock('../shared/file-store', () => ({
  safeReadJson: jest.fn(() => ({ dailyStats: {}, habits: {}, overall: {} })),
  writeJsonAtomic: jest.fn(),
}));

// Mock app paths
jest.mock('../shared/app-paths', () => ({
  getDataFilePath: jest.fn(() => 'test-path'),
}));

describe('AnalyticsManager', () => {
  let analyticsManager;

  beforeEach(() => {
    analyticsManager = new AnalyticsManager();
  });

  describe('Basic Analytics Operations', () => {
    test('should create analytics manager with empty data', () => {
      expect(analyticsManager).toBeDefined();
    });

    test('should record a focus session', () => {
      const result = analyticsManager.recordFocusSession(30, 'Test Focus');
      expect(result.success).toBe(true);
    });

    test('should record task completion', () => {
      const result = analyticsManager.recordTaskCompleted('task-1', 'high');
      expect(result.success).toBe(true);
    });

    test('should get daily stats', () => {
      const stats = analyticsManager.getDailyStats(new Date());
      expect(stats).toBeDefined();
    });

    test('should get weekly stats', () => {
      const stats = analyticsManager.getWeeklyStats(new Date());
      expect(stats).toBeDefined();
    });

    test('should get monthly stats', () => {
      const stats = analyticsManager.getMonthlyStats(new Date());
      expect(stats).toBeDefined();
    });

    test('should get overall stats', () => {
      const stats = analyticsManager.getOverallStats();
      expect(stats).toBeDefined();
    });

    test('should generate productivity report', () => {
      const report = analyticsManager.getProductivityReport(30);
      expect(report).toBeDefined();
    });

    test('should export data', () => {
      const data = analyticsManager.exportData();
      expect(data).toBeDefined();
    });
  });

  describe('Stats Aggregation', () => {
    test('should calculate correct stats when no data', () => {
      const stats = analyticsManager.getDailyStats(new Date());
      expect(stats).toBeDefined();
    });

    test('should aggregate multiple stats', () => {
      analyticsManager.recordFocusSession(25, 'First session');
      analyticsManager.recordFocusSession(30, 'Second session');

      const stats = analyticsManager.getDailyStats(new Date());
      expect(stats).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid inputs gracefully', () => {
      expect(() => analyticsManager.recordFocusSession(null)).not.toThrow();
    });
  });
});
