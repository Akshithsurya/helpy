const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');
const { Notification } = require('electron');

const NOTIFICATIONS_DATA_PATH = 'notifications-data.json';

const NOTIFICATION_TYPE = {
  TASK: 'task',
  REMINDER: 'reminder',
  ACHIEVEMENT: 'achievement',
  FOCUS: 'focus',
  SYSTEM: 'system',
};

class NotificationManager {
  constructor(logger, taskManager) {
    this.logger = logger || console;
    this.taskManager = taskManager;
    this.notificationsData = this._loadNotificationsData();
    this.deadlineCheckInterval = null;
  }

  _loadNotificationsData() {
    try {
      const filePath = getDataFilePath(NOTIFICATIONS_DATA_PATH);
      return safeReadJson(filePath, {
        notifications: [],
        settings: {
          soundEnabled: true,
          desktopNotificationsEnabled: true,
          reminderInterval: 60,
        },
      });
    } catch (error) {
      this.logger.error('Error loading notifications data:', error);
      return {
        notifications: [],
        settings: {
          soundEnabled: true,
          desktopNotificationsEnabled: true,
          reminderInterval: 60,
        },
      };
    }
  }

  _saveNotificationsData() {
    try {
      const filePath = getDataFilePath(NOTIFICATIONS_DATA_PATH);
      writeJsonAtomic(filePath, this.notificationsData);
    } catch (error) {
      this.logger.error('Error saving notifications data:', error);
    }
  }

  sendNotification(title, body, type = NOTIFICATION_TYPE.SYSTEM) {
    return this.createNotification({ title, body, type });
  }

  createNotification(notificationData) {
    try {
      const id = `notif-${Date.now()}`;
      const notification = {
        id,
        title: notificationData.title || 'New Notification',
        body: notificationData.body || '',
        type: notificationData.type || NOTIFICATION_TYPE.SYSTEM,
        read: false,
        dismissed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...notificationData,
      };

      this.notificationsData.notifications.unshift(notification);
      this._saveNotificationsData();

      if (this.notificationsData.settings.desktopNotificationsEnabled) {
        this._showDesktopNotification(notification);
      }

      this.logger.info(`Created notification: ${notification.title}`);
      return { success: true, notification };
    } catch (error) {
      this.logger.error('Error creating notification:', error);
      return { success: false, error: error.message };
    }
  }

  _showDesktopNotification(notification) {
    try {
      const notif = new Notification({
        title: notification.title,
        body: notification.body,
      });
      notif.show();
    } catch (error) {
      this.logger.error('Error showing desktop notification:', error);
    }
  }

  getNotification(id) {
    return this.notificationsData.notifications.find((n) => n.id === id) || null;
  }

  getAllNotifications() {
    return this.notificationsData.notifications;
  }

  updateNotification(id, updates) {
    try {
      const index = this.notificationsData.notifications.findIndex((n) => n.id === id);
      if (index === -1) {
        return { success: false, error: 'Notification not found' };
      }

      this.notificationsData.notifications[index] = {
        ...this.notificationsData.notifications[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      this._saveNotificationsData();

      return { success: true, notification: this.notificationsData.notifications[index] };
    } catch (error) {
      this.logger.error('Error updating notification:', error);
      return { success: false, error: error.message };
    }
  }

  deleteNotification(id) {
    try {
      this.notificationsData.notifications = this.notificationsData.notifications.filter(
        (n) => n.id !== id
      );
      this._saveNotificationsData();
      this.logger.info(`Deleted notification: ${id}`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error deleting notification:', error);
      return { success: false, error: error.message };
    }
  }

  clearAllNotifications() {
    try {
      this.notificationsData.notifications = [];
      this._saveNotificationsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error clearing all notifications:', error);
      return { success: false, error: error.message };
    }
  }

  markAsRead(id) {
    return this.updateNotification(id, { read: true });
  }

  markAllAsRead() {
    try {
      this.notificationsData.notifications.forEach((n) => {
        n.read = true;
        n.updatedAt = new Date().toISOString();
      });
      this._saveNotificationsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error marking all notifications as read:', error);
      return { success: false, error: error.message };
    }
  }

  dismissNotification(id) {
    return this.updateNotification(id, { dismissed: true });
  }

  getSettings() {
    return this.notificationsData.settings;
  }

  updateSettings(updates) {
    try {
      this.notificationsData.settings = {
        ...this.notificationsData.settings,
        ...updates,
      };
      this._saveNotificationsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error updating notification settings:', error);
      return { success: false, error: error.message };
    }
  }

  getUnreadCount() {
    return this.notificationsData.notifications.filter((n) => !n.read && !n.dismissed).length;
  }

  getNotificationStats() {
    const total = this.notificationsData.notifications.length;
    const unread = this.getUnreadCount();
    const today = new Date().toDateString();
    const todayCount = this.notificationsData.notifications.filter(
      (n) => new Date(n.createdAt).toDateString() === today
    ).length;

    return {
      total,
      unread,
      todayCount,
      read: total - unread,
    };
  }

  sendAchievementNotification(achievementData) {
    return this.createNotification({
      title: achievementData.title || 'Achievement Unlocked!',
      body: achievementData.description || '',
      type: NOTIFICATION_TYPE.ACHIEVEMENT,
    });
  }

  sendFocusReminder(message) {
    return this.createNotification({
      title: 'Focus Reminder',
      body: message,
      type: NOTIFICATION_TYPE.FOCUS,
    });
  }

  startDeadlineChecker() {
    if (this.deadlineCheckInterval) {
      clearInterval(this.deadlineCheckInterval);
    }
    this.logger.info('Starting deadline checker');
    this.deadlineCheckInterval = setInterval(() => this._checkDeadlines(), 60000); // Check every minute
    this._checkDeadlines(); // Check immediately on start
  }

  stopDeadlineChecker() {
    if (this.deadlineCheckInterval) {
      clearInterval(this.deadlineCheckInterval);
      this.deadlineCheckInterval = null;
    }
  }

  _checkDeadlines() {
    if (!this.taskManager) {
      return;
    }
    try {
      const tasks = this.taskManager.getTasks();
      const now = new Date();
      tasks.forEach((task) => {
        if (task.deadline && !task.completed) {
          const deadline = new Date(task.deadline);
          const timeUntil = deadline - now;

          // Check for upcoming deadlines (1 hour, 30 minutes, 10 minutes)
          if (timeUntil > 0 && timeUntil <= 3600000 && !task.notified1h) {
            this.sendNotification(
              'Task Deadline Soon!',
              `Task "${task.title}" is due in 1 hour!`,
              NOTIFICATION_TYPE.TASK
            );
            this.taskManager.updateTask(task.id, { notified1h: true });
          } else if (timeUntil > 0 && timeUntil <= 1800000 && !task.notified30m) {
            this.sendNotification(
              'Task Deadline Soon!',
              `Task "${task.title}" is due in 30 minutes!`,
              NOTIFICATION_TYPE.TASK
            );
            this.taskManager.updateTask(task.id, { notified30m: true });
          } else if (timeUntil > 0 && timeUntil <= 600000 && !task.notified10m) {
            this.sendNotification(
              'Task Deadline Soon!',
              `Task "${task.title}" is due in 10 minutes!`,
              NOTIFICATION_TYPE.TASK
            );
            this.taskManager.updateTask(task.id, { notified10m: true });
          } else if (timeUntil <= 0 && !task.notifiedOverdue) {
            this.sendNotification(
              'Task Overdue!',
              `Task "${task.title}" is past its deadline!`,
              NOTIFICATION_TYPE.TASK
            );
            this.taskManager.updateTask(task.id, { notifiedOverdue: true });
          }
        }
      });
    } catch (error) {
      this.logger.error('Error checking deadlines:', error);
    }
  }
}

module.exports = {
  NotificationManager,
  NOTIFICATION_TYPE,
};
