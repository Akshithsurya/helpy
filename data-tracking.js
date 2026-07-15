const {
  DATA_TRACKING_TYPES,
  normalizeTrackingItem,
  normalizeTrackingRecord,
  normalizeTrackingItemArray,
  normalizeTrackingRecordArray,
} = require('./shared/schemas');
const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');

const TRACKING_ITEMS_FILE = getDataFilePath('tracking-items.json');
const TRACKING_RECORDS_FILE = getDataFilePath('tracking-records.json');

class DataTrackingManager {
  constructor() {
    this.trackingItems = this.loadTrackingItems();
    this.trackingRecords = this.loadTrackingRecords();
    this.listeners = new Map();
  }

  loadTrackingItems() {
    try {
      const items = safeReadJson(TRACKING_ITEMS_FILE, [], normalizeTrackingItemArray);
      if (items.length === 0) {
        return this.getDefaultTrackingItems();
      }
      return items;
    } catch (error) {
      console.error('Error loading tracking items:', error);
      return this.getDefaultTrackingItems();
    }
  }

  loadTrackingRecords() {
    try {
      return safeReadJson(TRACKING_RECORDS_FILE, [], normalizeTrackingRecordArray);
    } catch (error) {
      console.error('Error loading tracking records:', error);
      return [];
    }
  }

  saveTrackingItems() {
    try {
      writeJsonAtomic(TRACKING_ITEMS_FILE, this.trackingItems);
    } catch (error) {
      console.error('Error saving tracking items:', error);
    }
  }

  saveTrackingRecords() {
    try {
      const prunedRecords = this.pruneOldRecords(this.trackingRecords);
      writeJsonAtomic(TRACKING_RECORDS_FILE, prunedRecords);
    } catch (error) {
      console.error('Error saving tracking records:', error);
    }
  }

  pruneOldRecords(records, maxAgeDays = 90) {
    const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return records.filter((record) => record.timestamp >= cutoffTime).slice(-10000);
  }

  getDefaultTrackingItems() {
    return [
      {
        id: 'tab_visits',
        name: 'Tab Visits',
        type: DATA_TRACKING_TYPES.USER_BEHAVIOR,
        enabled: true,
        config: { trackDomain: true, trackDuration: true },
      },
      {
        id: 'app_usage',
        name: 'App Usage',
        type: DATA_TRACKING_TYPES.USER_BEHAVIOR,
        enabled: true,
        config: { trackActiveTime: true },
      },
      {
        id: 'task_completion',
        name: 'Task Completion',
        type: DATA_TRACKING_TYPES.PROCESS_NODE,
        enabled: true,
        config: { trackTimeSpent: true },
      },
      {
        id: 'performance_metrics',
        name: 'Performance Metrics',
        type: DATA_TRACKING_TYPES.PERFORMANCE,
        enabled: false,
        config: { trackMemory: false, trackCPU: false },
      },
    ];
  }

  getTrackingItems() {
    return [...this.trackingItems];
  }

  getTrackingItem(id) {
    return this.trackingItems.find((item) => item.id === id) || null;
  }

  addTrackingItem(item) {
    const normalized = normalizeTrackingItem(item);
    if (!normalized) return null;

    if (this.trackingItems.find((i) => i.id === normalized.id)) {
      return this.updateTrackingItem(normalized.id, normalized);
    }

    this.trackingItems.push(normalized);
    this.saveTrackingItems();
    this.emit('itemAdded', normalized);
    return normalized;
  }

  updateTrackingItem(id, updates) {
    const index = this.trackingItems.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = normalizeTrackingItem({ ...this.trackingItems[index], ...updates });
    if (!updated) return null;

    this.trackingItems[index] = updated;
    this.saveTrackingItems();
    this.emit('itemUpdated', updated);
    return updated;
  }

  deleteTrackingItem(id) {
    const index = this.trackingItems.findIndex((item) => item.id === id);
    if (index === -1) return false;

    const deleted = this.trackingItems.splice(index, 1)[0];
    this.saveTrackingItems();
    this.emit('itemDeleted', deleted);
    return true;
  }

  record(trackingItemId, value, metadata = {}) {
    const item = this.getTrackingItem(trackingItemId);
    if (!item || !item.enabled) return null;

    const record = normalizeTrackingRecord({
      trackingItemId,
      timestamp: Date.now(),
      value,
      metadata,
    });

    if (!record) return null;

    this.trackingRecords.push(record);
    this.saveTrackingRecords();
    this.emit('recordAdded', record);
    return record;
  }

  getRecords(trackingItemId, options = {}) {
    let records = trackingItemId
      ? this.trackingRecords.filter((r) => r.trackingItemId === trackingItemId)
      : [...this.trackingRecords];

    if (options.startTime) {
      records = records.filter((r) => r.timestamp >= options.startTime);
    }
    if (options.endTime) {
      records = records.filter((r) => r.timestamp <= options.endTime);
    }
    if (options.limit) {
      records = records.slice(-options.limit);
    }

    return records;
  }

  getAggregatedData(trackingItemId, startTime, endTime, aggregation = 'count') {
    const records = this.getRecords(trackingItemId, { startTime, endTime });

    switch (aggregation) {
      case 'count':
        return records.length;
      case 'sum':
        return records.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
      case 'average':
        if (records.length === 0) return 0;
        return records.reduce((sum, r) => sum + (Number(r.value) || 0), 0) / records.length;
      case 'min':
        if (records.length === 0) return null;
        return Math.min(...records.map((r) => Number(r.value) || 0));
      case 'max':
        if (records.length === 0) return null;
        return Math.max(...records.map((r) => Number(r.value) || 0));
      default:
        return records.length;
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    });
  }

  clearRecords(trackingItemId) {
    if (trackingItemId) {
      this.trackingRecords = this.trackingRecords.filter(
        (r) => r.trackingItemId !== trackingItemId
      );
    } else {
      this.trackingRecords = [];
    }
    this.saveTrackingRecords();
  }

  exportData(options = {}) {
    const startTime = options.startTime || 0;
    const endTime = options.endTime || Date.now();

    return {
      trackingItems: this.trackingItems,
      trackingRecords: this.trackingRecords.filter(
        (r) => r.timestamp >= startTime && r.timestamp <= endTime
      ),
      exportTime: new Date().toISOString(),
    };
  }

  importData(data) {
    if (data.trackingItems) {
      this.trackingItems = normalizeTrackingItemArray(data.trackingItems);
      this.saveTrackingItems();
    }
    if (data.trackingRecords) {
      const newRecords = normalizeTrackingRecordArray(data.trackingRecords);
      this.trackingRecords = [...this.trackingRecords, ...newRecords];
      this.saveTrackingRecords();
    }
    return true;
  }
}

module.exports = DataTrackingManager;
