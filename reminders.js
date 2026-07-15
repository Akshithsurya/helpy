const { Notification } = require('electron');
const { getSystemInfo } = require('./system-info');
const { getAddressName, personalizeLabel } = require('./personalization');

const REMINDER_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Manages reminders
 * @class ReminderManager
 */
class ReminderManager {
  /**
   * Creates a new ReminderManager instance
   * @param {Object} taskManager - Task manager
   * @param {Object} [settingsManager=null] - Settings manager
   */
  constructor(taskManager, settingsManager = null) {
    /** @type {Object} Task manager */
    this.taskManager = taskManager;

    /** @type {Object|null} Settings manager */
    this.settingsManager = settingsManager;

    /** @type {NodeJS.Timeout|null} Reminder interval */
    this.intervalId = null;

    /** @type {Array<Object>} Tracked browser tabs */
    this.trackedTabs = [];
  }

  /**
   * Sets tracked browser tabs
   * @param {Array<Object>} tabs - Tabs array
   */
  setTrackedTabs(tabs) {
    this.trackedTabs = tabs;
  }

  /**
   * Gets tracked browser tabs
   * @returns {Array<Object>} Tracked tabs
   */
  getTrackedTabs() {
    return this.trackedTabs;
  }

  /**
   * Sends a reminder
   */
  async sendReminder() {
    try {
      console.log('\n=== Reminder at', new Date().toLocaleString(), '===');

      let systemInfo = { activeWindow: null, openApps: [] };
      try {
        systemInfo = await getSystemInfo();
      } catch (err) {
        console.error('Error getting system info for reminder:', err);
      }

      let dueSoonTasks = [];
      try {
        dueSoonTasks = this.taskManager.getDueSoonTasks();
      } catch (err) {
        console.error('Error getting due soon tasks for reminder:', err);
      }

      const tabs = this.getTrackedTabs();
      const settings = this.settingsManager?.getSettings?.() || {};
      const addressName = getAddressName(settings);

      const lines = [`Quick check-in for ${addressName}.`];

      if (systemInfo.activeWindow?.owner?.name) {
        lines.push(`Active app: ${systemInfo.activeWindow.owner.name}`);
        if (systemInfo.activeWindow.title) {
          lines.push(`Window: ${systemInfo.activeWindow.title}`);
        }
      }

      if (tabs.length > 0) {
        const topTabs = tabs
          .slice(0, 3)
          .map((tab) => tab.title?.substring(0, 40) || 'Untitled')
          .join(', ');
        lines.push(`Tracked tabs (${tabs.length}): ${topTabs}`);
      }

      if (systemInfo.openApps.length > 0) {
        lines.push(`Other apps: ${systemInfo.openApps.slice(0, 4).join(', ')}`);
      }

      if (dueSoonTasks.length > 0) {
        const dueSoonSummary = dueSoonTasks
          .slice(0, 3)
          .map((task) => `${task.title?.substring(0, 40) || 'Untitled'} (${task.dueDate})`)
          .join(', ');
        lines.push(`Due soon: ${dueSoonSummary}`);
      } else {
        lines.push('No tasks due soon.');
      }

      const message = lines.join('\n');

      // Log to console
      console.log(message);

      // Send desktop notification using Electron with subtler settings
      const notification = new Notification({
        title: personalizeLabel('Helpy reminder', settings),
        body: message.substring(0, 250), // Limit message length for notifications
        silent: true, // No sound
      });

      notification.on('error', (err) => {
        console.error('Notification error:', err);
      });

      notification.show();
    } catch (error) {
      console.error('Error sending reminder:', error);
    }
  }

  /**
   * Starts sending periodic reminders
   */
  startReminders() {
    try {
      if (this.intervalId) {
        console.log('Reminders already running!');
        return;
      }

      console.log('Starting reminders (every 10 minutes)...');
      this.sendReminder(); // Send first reminder immediately

      // Set interval for every 10 minutes (600000 ms)
      this.intervalId = setInterval(() => {
        this.sendReminder();
      }, REMINDER_INTERVAL_MS);
    } catch (error) {
      console.error('Error starting reminders:', error);
    }
  }

  /**
   * Stops sending periodic reminders
   */
  stopReminders() {
    try {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
        console.log('Reminders stopped');
      }
    } catch (error) {
      console.error('Error stopping reminders:', error);
    }
  }
}

module.exports = ReminderManager;
