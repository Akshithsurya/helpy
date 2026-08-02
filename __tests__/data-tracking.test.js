const DataTrackingManager = require('../data-tracking');

// Mock file operations to prevent actual file writing
jest.mock('../shared/file-store', () => ({
  safeReadJson: jest.fn().mockReturnValue([]),
  writeJsonAtomic: jest.fn(),
}));
jest.mock('../shared/app-paths', () => ({
  getDataFilePath: jest.fn().mockReturnValue('/tmp/test.json'),
}));

describe('DataTrackingManager', () => {
  let manager;

  beforeEach(() => {
    // Clear mock calls and create a fresh manager with mocked files
    jest.clearAllMocks();
    manager = new DataTrackingManager();

    // Manually set up default tracking items for testing
    manager.trackingItems = [
      {
        id: 'tab_visits',
        name: 'Tab Visits',
        type: 'user_behavior',
        enabled: true,
        config: { trackDomain: true, trackDuration: true },
      },
      {
        id: 'app_usage',
        name: 'App Usage',
        type: 'user_behavior',
        enabled: true,
        config: { trackActiveTime: true },
      },
      {
        id: 'task_completion',
        name: 'Task Completion',
        type: 'process_node',
        enabled: true,
        config: { trackTimeSpent: true },
      },
      {
        id: 'performance_metrics',
        name: 'Performance Metrics',
        type: 'performance',
        enabled: false,
        config: { trackMemory: false, trackCPU: false },
      },
    ];

    // Clear any existing records
    manager.trackingRecords = [];
  });

  describe('Initialization', () => {
    test('should have tracking items available', () => {
      const items = manager.getTrackingItems();
      expect(items).toBeDefined();
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe('Tracking Items', () => {
    test('should add a new tracking item', () => {
      const newItem = {
        id: 'test-item',
        name: 'Test Item',
        type: 'custom',
        enabled: true,
        config: {},
      };

      const added = manager.addTrackingItem(newItem);
      expect(added).toBeDefined();
      expect(added.id).toBe('test-item');
      expect(added.name).toBe('Test Item');
    });

    test('should get a tracking item by id', () => {
      const item = manager.getTrackingItem('tab_visits');
      expect(item).toBeDefined();
      expect(item.id).toBe('tab_visits');
    });

    test('should update a tracking item', () => {
      const updated = manager.updateTrackingItem('tab_visits', {
        name: 'Updated Tab Visits',
      });
      expect(updated).toBeDefined();
      expect(updated.name).toBe('Updated Tab Visits');
    });

    test('should delete a tracking item', () => {
      const result = manager.deleteTrackingItem('app_usage');
      expect(result).toBe(true);
      expect(manager.getTrackingItem('app_usage')).toBeNull();
    });
  });

  describe('Tracking Records', () => {
    test('should record tracking data', () => {
      const record = manager.record('tab_visits', 1, { url: 'https://example.com' });
      expect(record).toBeDefined();
      expect(record.trackingItemId).toBe('tab_visits');
      expect(record.value).toBe(1);
      expect(record.metadata.url).toBe('https://example.com');
    });

    test('should get tracking records', () => {
      manager.record('tab_visits', 1, { url: 'https://example1.com' });
      manager.record('tab_visits', 1, { url: 'https://example2.com' });

      const records = manager.getRecords('tab_visits');
      expect(records).toBeDefined();
      expect(Array.isArray(records)).toBe(true);
      expect(records.length).toBe(2);
    });

    test('should clear tracking records', () => {
      manager.record('tab_visits', 1, { url: 'https://example.com' });
      manager.clearRecords('tab_visits');

      const records = manager.getRecords('tab_visits');
      expect(records.length).toBe(0);
    });
  });

  describe('Aggregation', () => {
    beforeEach(() => {
      // Add some test data
      manager.record('task_completion', 1, { task: 'Task 1' });
      manager.record('task_completion', 1, { task: 'Task 2' });
      manager.record('task_completion', 1, { task: 'Task 3' });
    });

    test('should count records', () => {
      const result = manager.getAggregatedData('task_completion', undefined, undefined, 'count');
      expect(result).toBe(3);
    });

    test('should sum values', () => {
      const result = manager.getAggregatedData('task_completion', undefined, undefined, 'sum');
      expect(result).toBe(3);
    });

    test('should calculate average', () => {
      const result = manager.getAggregatedData('task_completion', undefined, undefined, 'average');
      expect(result).toBe(1);
    });
  });

  describe('Export/Import', () => {
    test('should export data', () => {
      const data = manager.exportData();
      expect(data).toBeDefined();
      expect(data.trackingItems).toBeDefined();
      expect(data.trackingRecords).toBeDefined();
    });

    test('should import data', () => {
      const testData = {
        trackingItems: [
          {
            id: 'imported-item',
            name: 'Imported Item',
            type: 'custom',
            enabled: true,
            config: {},
          },
        ],
        trackingRecords: [],
      };

      const result = manager.importData(testData);
      expect(result).toBe(true);

      const items = manager.getTrackingItems();
      const hasImportedItem = items.some((item) => item.id === 'imported-item');
      expect(hasImportedItem).toBe(true);
    });
  });
});
