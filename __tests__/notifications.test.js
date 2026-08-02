const { NotificationManager, NOTIFICATION_TYPE } = require('../notifications');

// Mock file store
jest.mock('../shared/file-store', () => ({
  safeReadJson: jest.fn(() => ({ notifications: [], settings: {} })),
  writeJsonAtomic: jest.fn(),
}));

// Mock app paths
jest.mock('../shared/app-paths', () => ({
  getDataFilePath: jest.fn(() => 'test-path'),
}));

// Mock electron Notification
jest.mock('electron', () => ({
  Notification: jest.fn().mockImplementation(() => ({
    show: jest.fn(),
  })),
}));

describe('NotificationManager', () => {
  let notificationManager;

  beforeEach(() => {
    notificationManager = new NotificationManager();
  });

  describe('Basic Notification Operations', () => {
    test('should create notification manager with empty notifications', () => {
      const notifications = notificationManager.getAllNotifications();
      expect(notifications.length).toBe(0);
    });

    test('should create a new notification', () => {
      const result = notificationManager.createNotification({
        title: 'Test Notification',
        body: 'This is a test notification',
        type: NOTIFICATION_TYPE.TASK,
      });
      expect(result.success).toBe(true);
    });

    test('should get a notification by ID', () => {
      const createResult = notificationManager.createNotification({ title: 'Get Me' });
      const notification = notificationManager.getNotification(createResult.notification.id);
      expect(notification).toBeDefined();
      expect(notification.title).toBe('Get Me');
    });

    test('should delete a notification', () => {
      const createResult = notificationManager.createNotification({ title: 'Delete Me' });
      const deleteResult = notificationManager.deleteNotification(createResult.notification.id);
      expect(deleteResult.success).toBe(true);
    });
  });

  describe('Notification Status Management', () => {
    test('should mark notification as read', () => {
      const createResult = notificationManager.createNotification({ title: 'Read Me' });
      const result = notificationManager.markAsRead(createResult.notification.id);
      expect(result.success).toBe(true);
    });

    test('should mark all notifications as read', () => {
      notificationManager.createNotification({ title: 'Notification 1' });
      notificationManager.createNotification({ title: 'Notification 2' });
      const result = notificationManager.markAllAsRead();
      expect(result.success).toBe(true);
    });

    test('should dismiss a notification', () => {
      const createResult = notificationManager.createNotification({ title: 'Dismiss Me' });
      const result = notificationManager.dismissNotification(createResult.notification.id);
      expect(result.success).toBe(true);
    });
  });

  describe('Notification Settings', () => {
    test('should get notification settings', () => {
      const settings = notificationManager.getSettings();
      expect(settings).toBeDefined();
    });

    test('should update notification settings', () => {
      const result = notificationManager.updateSettings({ soundEnabled: false });
      expect(result.success).toBe(true);
    });
  });

  describe('Notification Statistics', () => {
    test('should get unread count', () => {
      notificationManager.createNotification({ title: 'Test' });
      const count = notificationManager.getUnreadCount();
      expect(count).toBeDefined();
    });

    test('should get notification stats', () => {
      const stats = notificationManager.getNotificationStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Convenience Methods', () => {
    test('should send achievement notification', () => {
      const result = notificationManager.sendAchievementNotification({
        title: 'First Achievement',
        description: 'Great job!',
      });
      expect(result.success).toBe(true);
    });

    test('should send focus reminder', () => {
      const result = notificationManager.sendFocusReminder('Stay focused!');
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent notification gracefully', () => {
      const notification = notificationManager.getNotification('non-existent-id');
      expect(notification).toBeNull();
    });

    test('should return error when updating non-existent notification', () => {
      const result = notificationManager.markAsRead('non-existent-id');
      expect(result.success).toBe(false);
    });
  });
});
