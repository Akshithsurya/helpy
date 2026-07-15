const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  addTask: (task) => ipcRenderer.invoke('add-task', task),
  updateTask: (id, updates) => ipcRenderer.invoke('update-task', id, updates),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),
  getSystemMonitorData: () => ipcRenderer.invoke('get-system-monitor-data'),

  // Activity Tracking API
  getActivityHistory: (limit) => ipcRenderer.invoke('get-activity-history', limit),
  getAppUsageStats: (days) => ipcRenderer.invoke('get-app-usage-stats', days),
  startActivityTracking: () => ipcRenderer.invoke('start-activity-tracking'),
  stopActivityTracking: () => ipcRenderer.invoke('stop-activity-tracking'),

  // Inactivity Monitoring API
  getInactiveTime: () => ipcRenderer.invoke('get-inactive-time'),
  setInactivityThreshold: (thresholdMs) =>
    ipcRenderer.invoke('set-inactivity-threshold', thresholdMs),
  recordActivity: () => ipcRenderer.invoke('record-activity'),
  parsePlanArguments: (args) => ipcRenderer.invoke('parse-plan-arguments', args),
  createPlanFromCommand: (args, options) => ipcRenderer.invoke('create-plan-from-command', args, options),
  createPlan: (planConfig) => ipcRenderer.invoke('create-plan', planConfig),
  addPlanToHistory: (plan, metadata) => ipcRenderer.invoke('add-plan-to-history', plan, metadata),
  getPlanHistory: (limit) => ipcRenderer.invoke('get-plan-history', limit),
  clearPlanHistory: () => ipcRenderer.invoke('clear-plan-history'),
  getPlanTemplates: () => ipcRenderer.invoke('get-plan-templates'),
  createPlanTemplate: (templateData) => ipcRenderer.invoke('create-plan-template', templateData),
  updatePlanTemplate: (templateId, updates) =>
    ipcRenderer.invoke('update-plan-template', templateId, updates),
  deletePlanTemplate: (templateId) => ipcRenderer.invoke('delete-plan-template', templateId),
  getPlanStatistics: (days) => ipcRenderer.invoke('get-plan-statistics', days),
  onPlanUpdated: (callback) => ipcRenderer.on('plan-updated', callback),
  onTabsUpdated: (callback) => ipcRenderer.on('tabs-updated', callback),
  onTabHistoryUpdated: (callback) => ipcRenderer.on('tab-history-updated', callback),
  onPomodoroUpdated: (callback) => ipcRenderer.on('pomodoro-updated', callback),

  // Habit API
  getAllHabits: (status) => ipcRenderer.invoke('get-all-habits', status),
  createHabit: (habitData) => ipcRenderer.invoke('create-habit', habitData),
  updateHabit: (id, updates) => ipcRenderer.invoke('update-habit', id, updates),
  deleteHabit: (id) => ipcRenderer.invoke('delete-habit', id),
  completeHabit: (id, date, count) => ipcRenderer.invoke('complete-habit', id, date, count),
  uncompleteHabit: (id, date) => ipcRenderer.invoke('uncomplete-habit', id, date),
  isHabitCompleted: (id, date) => ipcRenderer.invoke('is-habit-completed', id, date),
  getHabitProgress: (id, days) => ipcRenderer.invoke('get-habit-progress', id, days),
  getHabitsSummary: () => ipcRenderer.invoke('get-habits-summary'),

  // Timer API
  startFocusTimer: (durationMinutes) => ipcRenderer.invoke('start-focus-timer', durationMinutes),
  pauseFocusTimer: () => ipcRenderer.invoke('pause-focus-timer'),
  resumeFocusTimer: () => ipcRenderer.invoke('resume-focus-timer'),
  stopFocusTimer: () => ipcRenderer.invoke('stop-focus-timer'),
  getFocusTimerState: () => ipcRenderer.invoke('get-focus-timer-state'),
  onFocusTimerComplete: (callback) => ipcRenderer.on('focus-timer-complete', callback),

  // Notifications API
  getAllNotifications: () => ipcRenderer.invoke('get-all-notifications'),
  getNotification: (id) => ipcRenderer.invoke('get-notification', id),
  createNotification: (data) => ipcRenderer.invoke('create-notification', data),
  markNotificationRead: (id) => ipcRenderer.invoke('mark-notification-read', id),
  markAllNotificationsRead: () => ipcRenderer.invoke('mark-all-notifications-read'),
  dismissNotification: (id) => ipcRenderer.invoke('dismiss-notification', id),
  deleteNotification: (id) => ipcRenderer.invoke('delete-notification', id),
  clearAllNotifications: () => ipcRenderer.invoke('clear-all-notifications'),
  getNotificationSettings: () => ipcRenderer.invoke('get-notification-settings'),
  updateNotificationSettings: (updates) =>
    ipcRenderer.invoke('update-notification-settings', updates),
  getUnreadNotificationCount: () => ipcRenderer.invoke('get-unread-notification-count'),
  getNotificationStats: () => ipcRenderer.invoke('get-notification-stats'),

  // Auth API
  registerUser: (email, password, displayName) =>
    ipcRenderer.invoke('auth-register', email, password, displayName),
  loginUser: (email, password) => ipcRenderer.invoke('auth-login', email, password),
  logoutUser: () => ipcRenderer.invoke('auth-logout'),
  getCurrentUser: () => ipcRenderer.invoke('auth-get-user'),
  initiateOAuth: (provider) => ipcRenderer.invoke('auth-initiate-oauth', provider),
  onAuthStateChanged: (callback) =>
    ipcRenderer.on('auth-state-changed', (event, data) => callback(data)),
});
