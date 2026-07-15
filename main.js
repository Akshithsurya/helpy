require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const crypto = require('crypto');

// Local modules
const TaskManager = require('./tasks');
const SystemMonitor = require('./system-monitor');
const { NotificationManager, NOTIFICATION_TYPE } = require('./notifications');
const FocusPlanManager = require('./focus-plan-manager');
const { HabitManager } = require('./habits');
const { TimerManager } = require('./timer');
const ActivityTracker = require('./activity-tracker');
const InactivityMonitor = require('./inactivity-monitor');

// --- Initialization ---
const store = new Store();
const {
  AuthManager,
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI,
  GITHUB_CLIENT_ID,
  GITHUB_REDIRECT_URI,
} = require('./auth');
const authManager = new AuthManager();

// Load active auth session on startup
let currentAuthToken = store.get('authToken', null);
let currentAuthUser = null;
if (currentAuthToken) {
  try {
    currentAuthUser = authManager.verifyToken(currentAuthToken);
  } catch (err) {
    console.error('[Auth] Startup session validation failed:', err);
  }
  if (!currentAuthUser) {
    currentAuthToken = null;
    store.delete('authToken');
  }
}

let mainWindow;
let extensionServer;
let activeFocusTimer = null;

const taskManager = new TaskManager(store);
const systemMonitor = new SystemMonitor();
const notificationsManager = new NotificationManager(undefined, taskManager);
const focusPlanManager = new FocusPlanManager();
const habitManager = new HabitManager();
const timerManager = new TimerManager();
const activityTracker = new ActivityTracker();
const inactivityMonitor = new InactivityMonitor();

// --- Window & App Lifecycle ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function startExtensionServer() {
  try {
    const extensionServerModule = require('./test-server');
    extensionServer = extensionServerModule.server;

    extensionServerModule.initAppDependencies({
      authManager,
      focusPlanManager,
      mainWindow,
      googleAuthCallback: async (user, token) => {
        currentAuthUser = user;
        currentAuthToken = token;
        store.set('authToken', token);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth-state-changed', { user, token });
        }
      },
      githubAuthCallback: async (user, token) => {
        currentAuthUser = user;
        currentAuthToken = token;
        store.set('authToken', token);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth-state-changed', { user, token });
        }
      },
      verifyOAuthState: (state) => {
        const isValid = oauthStateTokens.has(state);
        if (isValid) {
          oauthStateTokens.delete(state);
        }
        return { isValid };
      },
    });

    console.log('[INFO] Extension server started successfully');
  } catch (error) {
    console.error('[ERROR] Failed to start extension server:', error);
  }
}

app.whenReady().then(() => {
  createWindow();
  startExtensionServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  systemMonitor.startMonitoring();
  notificationsManager.startDeadlineChecker();

  // Start activity tracking
  activityTracker.startTracking();

  // Set up inactivity reminder
  inactivityMonitor.setReminderCallback((inactiveTime) => {
    notificationsManager.createNotification({
      type: NOTIFICATION_TYPE.REMINDER,
      title: 'Are you still there?',
      body: `You've been inactive for ${Math.round(inactiveTime / 1000 / 60)} minutes.`,
    });
  });
  inactivityMonitor.startActivityMonitoring();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- Cleanup on Quit (Prevents memory/port leaks) ---
app.on('before-quit', () => {
  console.log('[INFO] App is quitting, cleaning up resources...');

  if (extensionServer && typeof extensionServer.close === 'function') {
    extensionServer.close();
  }

  if (activeFocusTimer) {
    try {
      activeFocusTimer.stop();
    } catch (e) {
      console.error('[ERROR] Failed to stop active timer on quit:', e);
    }
    activeFocusTimer = null;
  }

  if (typeof systemMonitor.stopMonitoring === 'function') {
    systemMonitor.stopMonitoring();
  }
  if (typeof notificationsManager.stopDeadlineChecker === 'function') {
    notificationsManager.stopDeadlineChecker();
  }

  // Stop activity tracking and inactivity monitoring
  activityTracker.stopTracking();
  inactivityMonitor.stopActivityMonitoring();
});

// --- IPC Handlers ---

// Helper to wrap handlers with async/await, error logging, and side-effects
const wrapIpcHandler = (channel, handler) => {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await handler(...args);

      // Trigger plan-updated event for plan-related operations
      const planRelatedChannels = [
        'add-plan-to-history',
        'clear-plan-history',
        'create-plan',
        'update-plan-template',
        'delete-plan-template',
      ];

      if (planRelatedChannels.includes(channel)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('plan-updated');
        }
      }

      return result;
    } catch (error) {
      console.error(`[IPC ERROR] Channel: ${channel}`, error);
      throw error; // Re-throw so the renderer process can catch it
    }
  });
};

// Store CSRF state tokens
const oauthStateTokens = new Set();

// 1. Simple CRUD & Manager Handlers
const simpleHandlers = {
  // Tasks
  'get-tasks': () => taskManager.getTasks(),
  'add-task': (task) => taskManager.addTask(task),
  'update-task': (id, updates) => taskManager.updateTask(id, updates),
  'delete-task': (id) => taskManager.deleteTask(id),
  'get-system-monitor-data': () => systemMonitor.getLatestData(),

  // Activity Tracking
  'get-activity-history': (limit) => activityTracker.getActivityHistory(limit),
  'get-app-usage-stats': (days) => activityTracker.getAppUsageStats(days),
  'start-activity-tracking': () => activityTracker.startTracking(),
  'stop-activity-tracking': () => activityTracker.stopTracking(),

  // Inactivity Monitoring
  'get-inactive-time': () => inactivityMonitor.getInactiveTime(),
  'set-inactivity-threshold': (thresholdMs) =>
    inactivityMonitor.setInactivityThreshold(thresholdMs),
  'record-activity': () => inactivityMonitor.recordActivity(),

  // Notifications
  'get-all-notifications': () => notificationsManager.getAllNotifications(),
  'get-notification': (id) => notificationsManager.getNotification(id),
  'create-notification': (data) => notificationsManager.createNotification(data),
  'mark-notification-read': (id) => notificationsManager.markAsRead(id),
  'mark-all-notifications-read': () => notificationsManager.markAllAsRead(),
  'dismiss-notification': (id) => notificationsManager.dismissNotification(id),
  'delete-notification': (id) => notificationsManager.deleteNotification(id),
  'clear-all-notifications': () => notificationsManager.clearAllNotifications(),
  'get-notification-settings': () => notificationsManager.getSettings(),
  'update-notification-settings': (updates) => notificationsManager.updateSettings(updates),
  'get-unread-notification-count': () => notificationsManager.getUnreadCount(),
  'get-notification-stats': () => notificationsManager.getNotificationStats(),

  // Focus Plans
  'parse-plan-arguments': (args) => focusPlanManager.parsePlanArguments(args),
  'create-plan-from-command': (args, options) => focusPlanManager.createPlanFromCommand(args, options),
  'create-plan': (planConfig) => focusPlanManager.createPlan(planConfig),
  'add-plan-to-history': (plan, metadata) => focusPlanManager.addToHistory(plan, metadata),
  'get-plan-history': (limit) => focusPlanManager.getHistory(limit),
  'clear-plan-history': () => focusPlanManager.clearHistory(),
  'get-plan-templates': () => focusPlanManager.getTemplates(),
  'create-plan-template': (templateData) => focusPlanManager.createTemplate(templateData),
  'update-plan-template': (templateId, updates) =>
    focusPlanManager.updateTemplate(templateId, updates),
  'delete-plan-template': (templateId) => focusPlanManager.deleteTemplate(templateId),
  'get-plan-statistics': (days) => focusPlanManager.getStatistics(days),

  // Habits
  'get-all-habits': (status) => habitManager.getAllHabits(status),
  'create-habit': (habitData) => habitManager.createHabit(habitData),
  'update-habit': (id, updates) => habitManager.updateHabit(id, updates),
  'delete-habit': (id) => habitManager.deleteHabit(id),
  'complete-habit': (id, date, count) => habitManager.completeHabit(id, date, count),
  'uncomplete-habit': (id, date) => habitManager.uncompleteHabit(id, date),
  'is-habit-completed': (id, date) => habitManager.isHabitCompleted(id, date),
  'get-habit-progress': (id, days) => habitManager.getHabitProgress(id, days),
  'get-habits-summary': () => habitManager.getHabitsSummary(),

  // Auth Handlers
  'auth-register': async (email, password, displayName) => {
    const result = await authManager.register(email, password, displayName);
    if (result.success) {
      currentAuthUser = result.user;
      currentAuthToken = result.token;
      store.set('authToken', result.token);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-state-changed', {
          user: result.user,
          token: result.token,
        });
      }
    }
    return result;
  },
  'auth-login': async (email, password) => {
    const result = await authManager.login(email, password);
    if (result.success) {
      currentAuthUser = result.user;
      currentAuthToken = result.token;
      store.set('authToken', result.token);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-state-changed', {
          user: result.user,
          token: result.token,
        });
      }
    }
    return result;
  },
  'auth-logout': () => {
    currentAuthUser = null;
    currentAuthToken = null;
    store.delete('authToken');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth-state-changed', { user: null, token: null });
    }
    return { success: true };
  },
  'auth-get-user': () => {
    return { user: currentAuthUser, token: currentAuthToken };
  },
  'auth-initiate-oauth': async (provider) => {
    try {
      const state = crypto.randomUUID();
      oauthStateTokens.add(state);

      const isConfigured = provider === 'google' ? authManager.isGoogleConfigured() : authManager.isGitHubConfigured();

      let authUrl;
      if (!isConfigured) {
        authUrl = new URL('http://localhost:3456/auth/mock');
        authUrl.searchParams.set('provider', provider);
        authUrl.searchParams.set('state', state);
      } else if (provider === 'google') {
        authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'email profile');
        authUrl.searchParams.set('state', state);
      } else if (provider === 'github') {
        authUrl = new URL('https://github.com/login/oauth/authorize');
        authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', GITHUB_REDIRECT_URI);
        authUrl.searchParams.set('scope', 'user:email');
        authUrl.searchParams.set('state', state);
      } else {
        throw new Error('Unsupported OAuth provider');
      }

      await shell.openExternal(authUrl.toString());
      return { success: true };
    } catch (error) {
      console.error('[ERROR] initiating OAuth:', error);
      return { success: false, error: error.message };
    }
  },
  'auth-verify-oauth-state': (state) => {
    const isValid = oauthStateTokens.has(state);
    if (isValid) {
      oauthStateTokens.delete(state);
    }
    return { isValid };
  },
};

// Register simple handlers
Object.entries(simpleHandlers).forEach(([channel, handler]) => {
  wrapIpcHandler(channel, handler);
});

// 2. Timer Handlers
const getTimerState = () => (activeFocusTimer ? activeFocusTimer.getState() : null);

const timerHandlers = {
  'start-focus-timer': (durationMinutes) => {
    if (activeFocusTimer) {
      try {
        activeFocusTimer.stop();
      } catch {
        /* Ignore */
      }
    }
    const timer = timerManager.createTimer({
      name: 'Focus Timer',
      timeoutDuration: durationMinutes * 60 * 1000,
      onTimeout: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('focus-timer-complete', state);
        }
        if (typeof notificationsManager.sendNotification === 'function') {
          notificationsManager.sendNotification(
            'Focus Session Complete!',
            'Great job staying focused!'
          );
        } else {
          notificationsManager.createNotification({
            title: 'Focus Session Complete!',
            message: 'Great job staying focused!',
          });
        }
      },
    });
    activeFocusTimer = timer;
    timer.start();
    return timer.getState();
  },
  'pause-focus-timer': () => {
    if (activeFocusTimer && activeFocusTimer.isRunning && !activeFocusTimer.isPaused) {
      activeFocusTimer.pause();
      return activeFocusTimer.getState();
    }
    return null;
  },
  'resume-focus-timer': () => {
    if (activeFocusTimer && activeFocusTimer.isPaused) {
      activeFocusTimer.resume();
      return activeFocusTimer.getState();
    }
    return null;
  },
  'stop-focus-timer': () => {
    if (activeFocusTimer) {
      const state = activeFocusTimer.getState();
      try {
        activeFocusTimer.stop();
      } catch (e) {
        console.error('[ERROR] Failed to stop timer:', e);
      }
      activeFocusTimer = null;
      return state;
    }
    return null;
  },
  'get-focus-timer-state': getTimerState,
  getFocusTimerState: getTimerState, // Kept for backward compatibility
};

// Register timer handlers
Object.entries(timerHandlers).forEach(([channel, handler]) => {
  wrapIpcHandler(channel, handler);
});
