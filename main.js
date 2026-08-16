// Ensure System32 (and cmd.exe) is always resolvable on Windows, even when
// the app is launched with a stripped environment — e.g. via auto-launch at
// logon, or certain packaged-app launch contexts where PATH doesn't include
// the default system directories. Without this, any child_process.exec() or
// spawn(..., { shell: true }) call fails with "spawn cmd.exe ENOENT".
if (process.platform === 'win32') {
  const path_ = require('path');
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const system32 = path_.join(systemRoot, 'System32');
  if (!process.env.PATH || !process.env.PATH.toLowerCase().includes(system32.toLowerCase())) {
    process.env.PATH = `${system32};${process.env.PATH || ''}`;
  }
  if (!process.env.ComSpec) {
    process.env.ComSpec = path_.join(system32, 'cmd.exe');
  }
}

require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
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
const i18n = require('./i18n');
const serviceOrchestrator = require('./service-orchestrator');
const enforcementModule = require('./native/enforcement');
const blockScheduler = require('./block-scheduler');
const { FocusSessionManager } = require('./focus-session-manager');
const { BotCompanion } = require('./bot-companion');

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
const focusSessionManager = new FocusSessionManager();
// Keep the companion in the main process. The renderer is intentionally
// sandboxed, so it cannot load Node modules such as bot-companion.js itself.
const botCompanion = new BotCompanion({
  memoryFile: path.join(app.getPath('userData'), 'bot-memory.json'),
  llm: {
    enabled: process.env.HELPY_LLM_ENABLED,
    baseUrl: process.env.HELPY_LLM_BASE_URL,
    apiKey: process.env.HELPY_LLM_API_KEY,
    model: process.env.HELPY_LLM_MODEL,
    timeoutMs: process.env.HELPY_LLM_TIMEOUT_MS,
  },
});

function buildAssistantContext(context = {}) {
  const normalizedContext = context && typeof context === 'object' ? context : {};

  let tasks = [];
  let habits = [];
  let notifications = [];
  let activityHistory = [];
  let appUsageStats = {};
  let planHistory = [];
  let planStatistics = {};
  let focusReport = {};
  let notificationStats = {};
  let habitsSummary = {};

  try {
    tasks = taskManager.getTasks();
  } catch (_) {}
  try {
    habits = habitManager.getAllHabits('active');
  } catch (_) {}
  try {
    habitsSummary = habitManager.getHabitsSummary();
  } catch (_) {}
  try {
    notifications = notificationsManager.getAllNotifications().slice(0, 10);
  } catch (_) {}
  try {
    notificationStats = notificationsManager.getNotificationStats();
  } catch (_) {}
  try {
    activityHistory = activityTracker.getActivityHistory(10);
  } catch (_) {}
  try {
    appUsageStats = activityTracker.getAppUsageStats(7);
  } catch (_) {}
  try {
    planHistory = focusPlanManager.getHistory(10);
  } catch (_) {}
  try {
    planStatistics = focusPlanManager.getStatistics(30);
  } catch (_) {}
  try {
    focusReport = focusSessionManager.getReport();
  } catch (_) {}

  return {
    ...normalizedContext,
    tasks,
    habits,
    habitsSummary,
    notifications,
    notificationStats,
    activityHistory,
    appUsageStats,
    planHistory,
    planStatistics,
    focusReport,
  };
}

function broadcastFocusSession(state = focusSessionManager.getState()) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('focus-session-updated', state);
}

focusSessionManager.onChange(broadcastFocusSession);

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
      focusSessionManager,
    });

    console.log('[INFO] Extension server started successfully');
  } catch (error) {
    console.error('[ERROR] Failed to start extension server:', error);
  }
}

app.whenReady().then(() => {
  createWindow();
  startExtensionServer();

  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
    autoUpdater
      .checkForUpdates()
      .catch((error) => console.warn('[Updater] Update check failed:', error.message));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  systemMonitor.startMonitoring();
  notificationsManager.startDeadlineChecker();

  // Start background services (Erlang daemon & Ruby stats service)
  serviceOrchestrator.startAll();

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

  serviceOrchestrator.stopAll();

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
    const startTime = Date.now();
    try {
      console.log(`[IPC] Handling: ${channel}`, { argsCount: args.length });
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
          mainWindow.webContents.send('plan-updated', {
            channel,
            result,
          });
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[IPC] Completed: ${channel} in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[IPC ERROR] Channel: ${channel} (after ${duration}ms)`, {
        message: error?.message,
        stack: error?.stack,
        args,
      });
      throw new Error(error?.message || `Failed to execute ${channel}`);
    }
  });
};

// Store CSRF state tokens
const oauthStateTokens = new Set();

// 1. Simple CRUD & Manager Handlers
const simpleHandlers = {
  // C++ Native Enforcement & Hard Mode
  'set-blocked-processes': (procs) => enforcementModule.setBlockedProcesses(procs),
  'start-hard-mode': (delaySeconds, password) =>
    enforcementModule.startHardMode(delaySeconds, password),
  'request-unlock-hard-mode': (passwordInput) =>
    enforcementModule.requestUnlockHardMode(passwordInput),
  'get-hard-mode-status': () => enforcementModule.getHardModeStatus(),
  'stop-enforcement': () => enforcementModule.stopEnforcement(),

  // Block Scheduler (scheduled site blocklist)
  'get-block-rules': () => blockScheduler.getRules(),
  'create-block-rule': (data) => {
    if (focusSessionManager.isEditsLocked())
      throw new Error('Blocklist edits are locked for the active strict focus session.');
    return blockScheduler.createRule(data);
  },
  'update-block-rule': (id, updates) => {
    if (focusSessionManager.isEditsLocked())
      throw new Error('Blocklist edits are locked for the active strict focus session.');
    return blockScheduler.updateRule(id, updates);
  },
  'delete-block-rule': (id) => {
    if (focusSessionManager.isEditsLocked())
      throw new Error('Blocklist edits are locked for the active strict focus session.');
    return blockScheduler.deleteRule(id);
  },
  'get-block-state': () => blockScheduler.getBlockState(),
  'start-focus-session': (options) => focusSessionManager.start(options),
  'pause-focus-session': () => focusSessionManager.pause(),
  'resume-focus-session': () => focusSessionManager.resume(),
  'stop-focus-session': () => focusSessionManager.stop(),
  'get-focus-session-state': () => focusSessionManager.getState(),
  'get-focus-report': () => focusSessionManager.getReport(),
  'add-focus-session-note': (note) => focusSessionManager.addInterruptionNote(note),

  // Tasks
  'get-tasks': () => taskManager.getTasks(),
  'add-task': (task) => taskManager.addTask(task),
  'update-task': (id, updates) => taskManager.updateTask(id, updates),
  'delete-task': (id) => taskManager.deleteTask(id),
  'get-system-monitor-data': () => systemMonitor.getLatestData(),

  // Helpy companion bot
  'bot-process-query': (prompt, context = {}) =>
    botCompanion.processQueryDetailed(prompt, buildAssistantContext(context)),
  'plan-assistant-query': (prompt, context = {}) =>
    botCompanion.processQueryDetailed(
      prompt,
      buildAssistantContext({ ...context, assistant_mode: 'plan' })
    ),
  'bot-get-memory-summary': () => botCompanion.getMemorySummary(),
  'bot-get-random-fact': () => botCompanion.getRandomFact(),
  'bot-get-motivation': () => botCompanion.getMotivation(),
  'bot-log-action': (type, detail, meta) => botCompanion.logAction(type, detail, meta),

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
  'create-plan-from-command': (args, options) =>
    focusPlanManager.createPlanFromCommand(args, options),
  'create-plan-from-assistant-draft': (draft, options) =>
    focusPlanManager.createPlanFromAssistantDraft(draft, options),
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
  'auth-update-profile-picture': async (dataUrl) => {
    if (!currentAuthUser) return { success: false, error: 'Please sign in before uploading a photo.' };
    const result = authManager.updateProfilePicture(currentAuthUser.email, dataUrl);
    if (result.success) {
      currentAuthUser = result.user;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-state-changed', { user: result.user, token: currentAuthToken });
      }
    }
    return result;
  },
  'auth-initiate-oauth': async (provider) => {
    try {
      const state = crypto.randomUUID();
      oauthStateTokens.add(state);

      const isConfigured =
        provider === 'google' ? authManager.isGoogleConfigured() : authManager.isGitHubConfigured();

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

  // i18n handlers
  'i18n-t': (key, params) => i18n.t(key, params),
  'i18n-set-language': (lang) => {
    const success = i18n.setLanguage(lang);
    if (success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('language-changed', lang);
    }
    return success;
  },
  'i18n-get-language': () => i18n.getLanguage(),
  'i18n-get-supported-languages': () => i18n.getSupportedLanguages(),
  'i18n-format-date': (date, locale) => i18n.formatDate(date, locale),
  'i18n-get-preset-translation': (presetName, key) => i18n.getPresetTranslation(presetName, key),
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
