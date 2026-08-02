const DEFAULT_INACTIVITY_MINUTES = 10;
const DEFAULT_NOTIFICATION_INTERVAL_MINUTES = 5;
const CHECK_INTERVAL_MS = 5000;
const SETTINGS_SYNC_INTERVAL_MS = 60000;
const BRIDGE_SYNC_INTERVAL_MS = 30000;
const HISTORY_FLUSH_INTERVAL_MS = 60000;
const APP_BASE_URL = 'http://localhost:3456';
const ERLANG_SYNC_SERVICE_URL = 'http://localhost:8080';

async function syncScheduleFromErlangService() {
  try {
    const res = await fetch(`${ERLANG_SYNC_SERVICE_URL}/api/sync/state`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.state && typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({
          canonicalSyncState: data.state,
          lastSyncTimestamp: Date.now(),
        });
        console.log(
          '[Background] Synced schedule & session state from Erlang OTP service:',
          data.state
        );
      }
    }
  } catch (err) {
    console.warn('[Background] Erlang sync service offline/standalone mode:', err.message);
  }
}

if (typeof setInterval === 'function') {
  setInterval(syncScheduleFromErlangService, BRIDGE_SYNC_INTERVAL_MS);
  syncScheduleFromErlangService();
}

// The Chrome service worker uses a browser-native command handler. The richer
// CommonJS planner is only loaded by Electron/Node; trying to import it here
// crashes an MV3 worker because Chrome does not expose `require`.
let CommandHandlerCtor = null;
if (typeof importScripts === 'function') {
  try {
    importScripts('./browser-command-handler.js');
    CommandHandlerCtor = self.BrowserCommandHandler || null;
  } catch (e) {
    console.warn('[background] Could not load shared command modules:', e.message);
  }
} else if (typeof require === 'function') {
  CommandHandlerCtor = require('./commands');
}

class EnhancedTabTracker {
  constructor() {
    this.tabSessions = {};
    this.tabHistory = [];
    this.domainTime = {};
    this.switchCount = 0;
    this.maxTabs = 20;
    this.notifyOnMaxTabs = true;
    this.lastMaxTabNotification = 0;
  }

  async init() {
    if (typeof chrome === 'undefined' || !chrome || !chrome.storage) {
      console.warn('Chrome storage not available, skipping EnhancedTabTracker init');
      return;
    }
    const result = await chrome.storage.local.get([
      'tabSessions',
      'tabHistory',
      'domainTime',
      'switchCount',
      'maxTabs',
      'notifyOnMaxTabs',
    ]);
    this.tabSessions = result.tabSessions || {};
    this.tabHistory = result.tabHistory || [];
    this.domainTime = result.domainTime || {};
    this.switchCount = result.switchCount || 0;
    this.maxTabs = result.maxTabs || 20;
    this.notifyOnMaxTabs = result.notifyOnMaxTabs !== false;
  }

  async save() {
    await chrome.storage.local.set({
      tabSessions: this.tabSessions,
      tabHistory: this.tabHistory.slice(-1000),
      domainTime: this.domainTime,
      switchCount: this.switchCount,
      maxTabs: this.maxTabs,
      notifyOnMaxTabs: this.notifyOnMaxTabs,
    });
  }

  startSession(tabId, url, title) {
    const now = Date.now();
    const domain = this.extractDomain(url);

    if (this.tabSessions[tabId]) {
      this.endSession(tabId);
    }

    this.tabSessions[tabId] = {
      tabId,
      url,
      title,
      domain,
      startTime: now,
      lastActive: now,
    };

    this.switchCount++;
  }

  updateActivity(tabId) {
    if (this.tabSessions[tabId]) {
      this.tabSessions[tabId].lastActive = Date.now();
    }
  }

  endSession(tabId) {
    const session = this.tabSessions[tabId];
    if (!session) return null;

    const now = Date.now();
    const duration = now - session.startTime;

    if (duration > 3000) {
      const historyEntry = {
        tabId: session.tabId,
        url: session.url,
        title: session.title,
        domain: session.domain,
        startTime: session.startTime,
        endTime: now,
        duration: duration,
      };

      this.tabHistory.push(historyEntry);

      if (!this.domainTime[session.domain]) {
        this.domainTime[session.domain] = 0;
      }
      this.domainTime[session.domain] += duration;
    }

    delete this.tabSessions[tabId];
    this.save();
    return duration;
  }

  extractDomain(url) {
    try {
      if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        return null;
      }
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  async checkTabCount() {
    if (!this.notifyOnMaxTabs) return;

    const [tabs] = await Promise.all([chrome.tabs.query({ currentWindow: true })]);

    if (tabs.length > this.maxTabs) {
      const now = Date.now();
      if (now - this.lastMaxTabNotification > 60000) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'Too many tabs!',
          message: `You have ${tabs.length} tabs open. Consider closing some to stay focused.`,
          priority: 2,
        });
        this.lastMaxTabNotification = now;
      }
    }
  }

  getTimeReport(days = 1) {
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const reportEntries = [];

    // A session can start before the selected period and still contain time in it.
    // Count only its overlap with the requested range rather than dropping it.
    this.tabHistory.forEach((entry) => {
      const startTime = Number(entry.startTime);
      const endTime = Number(entry.endTime) || startTime + Number(entry.duration || 0);
      const overlapStart = Math.max(startTime, cutoff);
      const overlapEnd = Math.min(endTime, now);

      if (entry.domain && Number.isFinite(startTime) && overlapEnd > overlapStart) {
        reportEntries.push({
          domain: entry.domain,
          duration: overlapEnd - overlapStart,
        });
      }
    });

    // Include the visible tab immediately. Waiting until it is closed made an
    // otherwise active week appear empty in the reports page.
    Object.values(this.tabSessions).forEach((session) => {
      const startTime = Number(session.startTime);
      const overlapStart = Math.max(startTime, cutoff);

      if (session.domain && Number.isFinite(startTime) && now > overlapStart) {
        reportEntries.push({
          domain: session.domain,
          duration: now - overlapStart,
        });
      }
    });

    const domainStats = {};
    reportEntries.forEach((entry) => {
      if (!domainStats[entry.domain]) {
        domainStats[entry.domain] = {
          domain: entry.domain,
          totalTime: 0,
          visits: 0,
        };
      }
      domainStats[entry.domain].totalTime += entry.duration;
      domainStats[entry.domain].visits++;
    });

    return {
      domainStats: Object.values(domainStats).sort((a, b) => b.totalTime - a.totalTime),
      totalTime: reportEntries.reduce((sum, entry) => sum + entry.duration, 0),
      // This is scoped to the selected period, unlike the old lifetime counter.
      switchCount: reportEntries.length,
      activeSessions: Object.values(this.tabSessions),
    };
  }
}

class PomodoroTimer {
  constructor() {
    this.isRunning = false;
    this.isBreak = false;
    this.focusDuration = 25 * 60 * 1000;
    this.breakDuration = 5 * 60 * 1000;
    this.longBreakDuration = 15 * 60 * 1000;
    this.cyclesBeforeLongBreak = 4;
    this.cycleCount = 0;
    this.remainingTime = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.blockNonWorkTabs = false;
  }

  async init() {
    if (typeof chrome === 'undefined' || !chrome || !chrome.storage) {
      console.warn('Chrome storage not available, skipping PomodoroTimer init');
      return;
    }
    const result = await chrome.storage.sync.get([
      'pomodoroRunning',
      'pomodoroIsBreak',
      'pomodoroRemaining',
      'pomodoroStart',
      'pomodoroEnd',
      'pomodoroCycleCount',
      'pomodoroFocusDuration',
      'pomodoroBreakDuration',
      'pomodoroLongBreakDuration',
      'pomodoroCyclesBeforeLongBreak',
      'pomodoroBlockNonWork',
    ]);

    this.focusDuration = result.pomodoroFocusDuration || this.focusDuration;
    this.breakDuration = result.pomodoroBreakDuration || this.breakDuration;
    this.longBreakDuration = result.pomodoroLongBreakDuration || this.longBreakDuration;
    this.cyclesBeforeLongBreak = result.pomodoroCyclesBeforeLongBreak || this.cyclesBeforeLongBreak;
    this.blockNonWorkTabs = result.pomodoroBlockNonWork || false;

    if (result.pomodoroRunning) {
      this.isRunning = true;
      this.isBreak = result.pomodoroIsBreak;
      this.cycleCount = result.pomodoroCycleCount || 0;
      this.remainingTime = result.pomodoroRemaining;
      this.startTime = result.pomodoroStart;
      this.endTime = result.pomodoroEnd;

      const elapsed = Date.now() - this.startTime;
      this.remainingTime = Math.max(0, this.endTime - Date.now());

      if (this.remainingTime <= 0) {
        this.completeSession();
      } else {
        this.scheduleCompletion();
      }
    }
  }

  async save() {
    await chrome.storage.sync.set({
      pomodoroRunning: this.isRunning,
      pomodoroIsBreak: this.isBreak,
      pomodoroRemaining: this.remainingTime,
      pomodoroStart: this.startTime,
      pomodoroEnd: this.endTime,
      pomodoroCycleCount: this.cycleCount,
      pomodoroFocusDuration: this.focusDuration,
      pomodoroBreakDuration: this.breakDuration,
      pomodoroLongBreakDuration: this.longBreakDuration,
      pomodoroCyclesBeforeLongBreak: this.cyclesBeforeLongBreak,
      pomodoroBlockNonWork: this.blockNonWorkTabs,
    });
  }

  startFocus() {
    this.isRunning = true;
    this.isBreak = false;
    this.startTime = Date.now();
    this.remainingTime = this.focusDuration;
    this.endTime = this.startTime + this.remainingTime;
    this.scheduleCompletion();
    this.save();
    this.broadcastState();

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Focus session started!',
      message: 'Stay focused for 25 minutes.',
      priority: 2,
    });
  }

  startBreak() {
    this.isRunning = true;
    this.isBreak = true;
    this.cycleCount++;
    this.startTime = Date.now();
    this.remainingTime =
      this.cycleCount % this.cyclesBeforeLongBreak === 0
        ? this.longBreakDuration
        : this.breakDuration;
    this.endTime = this.startTime + this.remainingTime;
    this.scheduleCompletion();
    this.save();
    this.broadcastState();

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Break time!',
      message:
        this.cycleCount % this.cyclesBeforeLongBreak === 0
          ? 'Take a long break - you earned it!'
          : 'Take a short break and stretch.',
      priority: 2,
    });
  }

  pause() {
    this.remainingTime = this.endTime - Date.now();
    this.isRunning = false;
    this.clearAlarm();
    this.save();
    this.broadcastState();
  }

  resume() {
    if (!this.isRunning && this.remainingTime > 0) {
      this.isRunning = true;
      this.startTime = Date.now();
      this.endTime = this.startTime + this.remainingTime;
      this.scheduleCompletion();
      this.save();
      this.broadcastState();
    }
  }

  stop() {
    this.isRunning = false;
    this.isBreak = false;
    this.remainingTime = 0;
    this.clearAlarm();
    this.save();
    this.broadcastState();
  }

  completeSession() {
    this.isRunning = false;

    if (!this.isBreak) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Focus session complete!',
        message: 'Great job! Time for a break.',
        priority: 2,
      });
      this.startBreak();
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Break complete!',
        message: 'Ready to focus again?',
        priority: 2,
      });
      this.cycleCount = 0;
      this.save();
      this.broadcastState();
    }
  }

  scheduleCompletion() {
    this.clearAlarm();
    chrome.alarms.create('pomodoro-complete', {
      when: this.endTime,
    });
  }

  clearAlarm() {
    chrome.alarms.clear('pomodoro-complete');
  }

  broadcastState() {
    chrome.runtime
      .sendMessage({
        type: 'POMODORO_STATE_UPDATE',
        state: this.getState(),
      })
      .catch(() => {});
  }

  getState() {
    const now = Date.now();
    let remaining = this.remainingTime;
    if (this.isRunning) {
      remaining = Math.max(0, this.endTime - now);
    }

    return {
      isRunning: this.isRunning,
      isBreak: this.isBreak,
      remainingTime: remaining,
      cycleCount: this.cycleCount,
      blockNonWorkTabs: this.blockNonWorkTabs,
    };
  }
}

async function handleBackgroundPomodoroCommand(args) {
  const action = args.toLowerCase().trim();

  if (action === 'start' || action === 'focus') {
    pomodoroTimer.startFocus();
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Focus session started!',
      options: { duration: 3000 },
    };
  } else if (action === 'break') {
    pomodoroTimer.startBreak();
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Break time!',
      options: { duration: 3000 },
    };
  } else if (action === 'stop' || action === 'pause') {
    if (pomodoroTimer.isRunning) {
      pomodoroTimer.pause();
    }
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Timer paused.',
      options: { duration: 3000 },
    };
  } else if (action === 'resume') {
    pomodoroTimer.resume();
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Timer resumed.',
      options: { duration: 3000 },
    };
  } else if (action === 'reset') {
    pomodoroTimer.stop();
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Timer reset.',
      options: { duration: 4000 },
    };
  }

  return {
    action: 'showNotification',
    title: 'Pomodoro',
    message: 'Available: start, break, pause, resume, reset',
    options: { duration: 4000 },
  };
}

async function sendCommandPlanToApp(planConfig) {
  try {
    const response = await postToApp('/api/focus-plan', planConfig);
    const result = await response.json().catch(() => null);
    if (!result || result.success === false) {
      return {
        success: false,
        error: result?.error || 'Invalid API response',
        reason: 'invalid-response',
      };
    }
    return { success: true, result };
  } catch (error) {
    const errorMessage = error?.message || 'Network error';
    const isUnauthorized =
      bridgeStatus === 'unauthorized' ||
      errorMessage.includes('status: 401') ||
      errorMessage.includes('status: 403');
    return {
      success: false,
      error: errorMessage,
      reason: isUnauthorized ? 'auth-error' : 'network-error',
    };
  }
}

function openReportsPage() {
  chrome.tabs.create({
    url: 'reports.html',
  });
}

function openSettingsPage() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
}

function handleActivatedPlan(planConfig) {
  activeFocusTask = planConfig?.title || null;
  broadcastStateUpdate();
}

class SimpleDataTrackingManager {
  constructor() {
    this.records = [];
    this.enabled = true;
  }

  record(trackingItemId, value, metadata = {}) {
    if (!this.enabled) return null;

    const record = {
      trackingItemId,
      timestamp: Date.now(),
      value,
      metadata,
    };
    this.records.push(record);

    if (this.records.length > 1000) {
      this.records = this.records.slice(-500);
    }

    return record;
  }

  getRecords(trackingItemId, options = {}) {
    let records = trackingItemId
      ? this.records.filter((r) => r.trackingItemId === trackingItemId)
      : [...this.records];

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
}

let dataTrackingManager = new SimpleDataTrackingManager();
let tabTracker = new EnhancedTabTracker();
let pomodoroTimer = new PomodoroTimer();

let tabActivity = {};
let tabLastNotified = {};
let inactivityDuration = DEFAULT_INACTIVITY_MINUTES * 60 * 1000;
let notificationIntervalDuration = DEFAULT_NOTIFICATION_INTERVAL_MINUTES * 60 * 1000;
let isPaused = false;
let displayName = '';
let bridgeToken = '';
let appConnected = false;
let bridgeStatus = 'disconnected';
let checkTimer = null;
let lastSettingsSync = 0;
let activeFocusTask = null;

// ─── Google Auth ───────────────────────────────────────────────────────────────
let googleUser = null; // { email, name, picture, sub, id }
let googleAccessToken = null; // short-lived Bearer token

/**
 * Fetch the Google OAuth client ID.
 * Priority: Helpy server → chrome.storage cache → null
 */
async function fetchGoogleClientId() {
  // 1. Try the live Helpy server first (always has the freshest value)
  try {
    const response = await fetch(`${APP_BASE_URL}/api/config`, {
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data = await response.json();
      if (
        data.success &&
        data.googleConfigured &&
        data.googleClientId &&
        !data.googleClientId.includes('your_') &&
        !data.googleClientId.includes('YOUR_') &&
        !data.googleClientId.includes('test-')
      ) {
        // Persist for offline use
        await chrome.storage.local.set({
          cachedGoogleClientId: data.googleClientId,
          cachedGoogleClientIdAt: Date.now(),
        });
        return data.googleClientId;
      }
    }
  } catch (e) {
    console.warn('[Google] Could not reach Helpy server for client ID:', e.message);
  }

  // 2. Fall back to the cached client ID (valid for 24 h)
  const stored = await chrome.storage.local.get(['cachedGoogleClientId', 'cachedGoogleClientIdAt']);
  const cacheAge = Date.now() - (stored.cachedGoogleClientIdAt || 0);
  const cacheValid = cacheAge < 24 * 60 * 60 * 1000;
  if (
    cacheValid &&
    stored.cachedGoogleClientId &&
    !stored.cachedGoogleClientId.includes('YOUR_') &&
    !stored.cachedGoogleClientId.includes('your_') &&
    !stored.cachedGoogleClientId.includes('test-')
  ) {
    return stored.cachedGoogleClientId;
  }

  return null;
}

/**
 * Sign the user into Google via chrome.identity.launchWebAuthFlow (implicit flow).
 * The redirect URI returned by chrome.identity.getRedirectURL() MUST be
 * registered in your Google Cloud Console → OAuth credentials → Authorised
 * redirect URIs.  The URL looks like:
 *   https://<extensionId>.chromiumapp.org/
 */
async function googleLogin() {
  try {
    const clientId = await fetchGoogleClientId();

    if (!clientId) {
      // Give the user an actionable message
      const isConnected = appConnected;
      const errorMsg = isConnected
        ? 'Google Sign-In is not configured. Open your Helpy .env file and set GOOGLE_CLIENT_ID, then restart the app.'
        : 'Helpy desktop app is not running. Start Helpy first, then try again.';
      console.error('[Google] Login failed — no client ID:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Build the OAuth URL. chrome.identity.getRedirectURL() returns a URL like
    // https://<id>.chromiumapp.org/ that Google must have whitelisted.
    const redirectUri = chrome.identity.getRedirectURL();
    console.log('[Google] Using redirect URI:', redirectUri);

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token'); // implicit flow — no server secret needed
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('prompt', 'select_account');
    // Random nonce prevents CSRF
    authUrl.searchParams.set('nonce', crypto.randomUUID());

    let authResultUrl;
    try {
      authResultUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
      });
    } catch (flowError) {
      // User closed the window or extension was blocked
      if (
        flowError.message?.includes('canceled') ||
        flowError.message?.includes('cancelled') ||
        flowError.message?.includes('user_cancelled') ||
        flowError.message?.includes('The user did not approve')
      ) {
        return { success: false, error: 'Login cancelled' };
      }
      // Re-throw so the outer catch handles it
      throw flowError;
    }

    if (!authResultUrl) {
      throw new Error(
        'Google did not return a redirect URL — check that your client ID is correct and the redirect URI is whitelisted.'
      );
    }

    // The access token is in the URL fragment (#access_token=...)
    const fragment = authResultUrl.includes('#') ? authResultUrl.split('#')[1] : '';
    const urlParams = new URLSearchParams(fragment);
    const newAccessToken = urlParams.get('access_token');
    const tokenType = urlParams.get('token_type');
    const expiresIn = parseInt(urlParams.get('expires_in') || '3600', 10);

    if (!newAccessToken) {
      const oauthError = urlParams.get('error') || 'unknown';
      const oauthDesc = urlParams.get('error_description') || '';
      throw new Error(`Google OAuth error: ${oauthError}${oauthDesc ? ' — ' + oauthDesc : ''}`);
    }

    googleAccessToken = newAccessToken;

    // Fetch user profile from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    });

    if (!userInfoResponse.ok) {
      const body = await userInfoResponse.text().catch(() => '');
      throw new Error(`Failed to fetch Google user info (${userInfoResponse.status}): ${body}`);
    }

    const rawUser = await userInfoResponse.json();
    googleUser = {
      id: rawUser.id,
      sub: rawUser.id, // keep both so callers work regardless of field name
      email: rawUser.email,
      name: rawUser.name,
      picture: rawUser.picture,
      verifiedEmail: rawUser.verified_email,
    };

    // Persist locally so the user stays signed in after service-worker restart
    await chrome.storage.local.set({
      googleUser,
      googleAccessToken,
      googleTokenExpiresAt: Date.now() + expiresIn * 1000,
    });

    // Notify the Helpy desktop app so it can create/update the local account
    if (appConnected) {
      try {
        await postToApp('/api/auth/google', {
          googleUser,
          accessToken: googleAccessToken,
        });
      } catch (syncErr) {
        console.warn('[Google] Could not sync user to Helpy app:', syncErr.message);
        // Non-fatal — the user is still signed in to the extension
      }
    }

    broadcastStateUpdate();
    console.log('[Google] Signed in as', googleUser.email);
    return { success: true, user: googleUser };
  } catch (error) {
    // Cancelled flows are not real errors — return a clean message
    if (
      error.message?.includes('canceled') ||
      error.message?.includes('cancelled') ||
      error.message?.includes('user_cancelled') ||
      error.message?.includes('The user did not approve')
    ) {
      return { success: false, error: 'Login cancelled' };
    }
    console.error('[Google] Login error:', error);
    return { success: false, error: error.message || 'Google Sign-In failed. Please try again.' };
  }
}

async function googleLogout() {
  try {
    googleUser = null;
    googleAccessToken = null;
    await chrome.storage.local.remove(['googleUser', 'googleAccessToken', 'googleTokenExpiresAt']);
    broadcastStateUpdate();
    console.log('[Google] Signed out');
    return { success: true };
  } catch (error) {
    console.error('[Google] Logout error:', error);
    return { success: false, error: error.message };
  }
}

let tabVisitHistory = [];
let currentVisit = null;

// Only run immediate initialization in real Chrome extension context, not in tests
if (typeof module === 'undefined' || !module.exports) {
  // Restore Google auth state from local storage
  // If the token is expired we clear it so the user is prompted to sign in again
  chrome.storage.local.get(
    ['googleUser', 'googleAccessToken', 'googleTokenExpiresAt'],
    (localResult) => {
      try {
        const tokenExpired =
          localResult.googleTokenExpiresAt && Date.now() > localResult.googleTokenExpiresAt;
        if (tokenExpired) {
          console.log('[Google] Stored access token expired — clearing');
          chrome.storage.local.remove(['googleAccessToken', 'googleTokenExpiresAt']);
          // Keep googleUser so we can show who was last signed in
        } else if (localResult.googleAccessToken) {
          googleAccessToken = localResult.googleAccessToken;
        }
        if (localResult.googleUser) {
          googleUser = localResult.googleUser;
        }
      } catch (e) {
        console.error('[Google] Error restoring auth state:', e);
      }
    }
  );

  chrome.storage.sync.get(
    ['inactivityMinutes', 'notificationIntervalMinutes', 'isPaused', 'displayName', 'bridgeToken'],
    (result) => {
      try {
        applyStoredSettings(result);
        startChecking();
        syncDisplayNameFromApp(true);
        tabTracker.init();
        pomodoroTimer.init();
        blockEnforcer.init();
      } catch (error) {
        console.error('Error initializing extension:', error);
      }
    }
  );
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'sync') {
    return;
  }

  try {
    if (changes.inactivityMinutes?.newValue) {
      const minutes = parseInt(changes.inactivityMinutes.newValue, 10);
      if (!isNaN(minutes) && minutes >= 1 && minutes <= 1440) {
        inactivityDuration = minutes * 60 * 1000;
      }
    }

    if (changes.notificationIntervalMinutes?.newValue) {
      const minutes = parseInt(changes.notificationIntervalMinutes.newValue, 10);
      if (!isNaN(minutes) && minutes >= 1 && minutes <= 1440) {
        notificationIntervalDuration = minutes * 60 * 1000;
      }
    }

    if (changes.isPaused) {
      isPaused = Boolean(changes.isPaused.newValue);
    }

    if (changes.displayName) {
      displayName = sanitizeDisplayName(changes.displayName.newValue);
    }

    if (changes.bridgeToken) {
      bridgeToken = sanitizeBridgeToken(changes.bridgeToken.newValue);
    }
  } catch (error) {
    console.error('Error handling storage change:', error);
  }
});

function applyStoredSettings(result = {}) {
  try {
    if (result.inactivityMinutes) {
      const minutes = parseInt(result.inactivityMinutes, 10);
      if (!isNaN(minutes) && minutes >= 1 && minutes <= 1440) {
        inactivityDuration = minutes * 60 * 1000;
      }
    }

    if (result.notificationIntervalMinutes) {
      const minutes = parseInt(result.notificationIntervalMinutes, 10);
      if (!isNaN(minutes) && minutes >= 1 && minutes <= 1440) {
        notificationIntervalDuration = minutes * 60 * 1000;
      }
    }

    if (result.isPaused !== undefined) {
      isPaused = Boolean(result.isPaused);
    }

    displayName = sanitizeDisplayName(result.displayName);
    bridgeToken = sanitizeBridgeToken(result.bridgeToken);
  } catch (error) {
    console.error('Error applying stored settings:', error);
  }
}

function sanitizeBridgeToken(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 256);
}

function getBridgeHeaders(extraHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    ...(bridgeToken ? { 'X-Helpy-Bridge-Token': bridgeToken } : {}),
    ...extraHeaders,
  };
}

function setBridgeStatus(nextStatus) {
  const normalizedStatus =
    nextStatus === 'connected' || nextStatus === 'unauthorized' ? nextStatus : 'disconnected';
  const nextConnected = normalizedStatus === 'connected';
  const statusChanged = bridgeStatus !== normalizedStatus || appConnected !== nextConnected;

  bridgeStatus = normalizedStatus;
  appConnected = nextConnected;

  if (statusChanged) {
    broadcastStateUpdate();
  }
}

function saveBridgeToken(nextToken) {
  const sanitized = sanitizeBridgeToken(nextToken);
  if (!sanitized || sanitized === bridgeToken) {
    return;
  }

  bridgeToken = sanitized;
  chrome.storage.sync.set({ bridgeToken }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving bridge token:', chrome.runtime.lastError);
    }
  });
}

function isCurrentExtensionSession(data = {}) {
  try {
    // Check if chrome and chrome.runtime.id are available
    const hasChromeRuntimeId =
      typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.id;
    if (!hasChromeRuntimeId) {
      console.warn('Chrome runtime not available, cannot verify extension session');
      return false;
    }

    // Check multiple possible places for registeredExtensionId
    const possibleIds = [
      data?.registeredExtensionId,
      data?.bridge?.registeredExtensionId,
      data?.extensionSettings?.registeredExtensionId,
    ].filter(Boolean);

    // If there are no registered extension IDs yet, any extension can connect
    if (possibleIds.length === 0) {
      return true;
    }

    // Otherwise, check if any ID matches current extension ID
    return possibleIds.some((id) => id && id === chrome.runtime.id);
  } catch (e) {
    console.warn('Error checking extension session:', e);
    return false;
  }
}

async function postToApp(path, payload, allowRetry = true) {
  if (!bridgeToken || !appConnected) {
    const connected = await ensureBridgeConnection(true);
    if (!connected) {
      throw new Error('Bridge unavailable');
    }
  }

  let response;
  try {
    response = await fetch(`${APP_BASE_URL}${path}`, {
      method: 'POST',
      headers: getBridgeHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (error) {
    setBridgeStatus('disconnected');
    throw error;
  }

  if ((response.status === 401 || response.status === 403) && allowRetry) {
    setBridgeStatus(response.status === 401 ? 'unauthorized' : 'disconnected');
    await ensureBridgeConnection(true);
    return postToApp(path, payload, false);
  }

  if (!response.ok) {
    setBridgeStatus(response.status === 401 ? 'unauthorized' : 'disconnected');
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  setBridgeStatus('connected');
  return response;
}

async function syncBridgeSession(force = false) {
  const now = Date.now();
  if (!force && now - lastSettingsSync < SETTINGS_SYNC_INTERVAL_MS && appConnected) {
    return appConnected;
  }

  lastSettingsSync = now;

  try {
    const response = await fetch(`${APP_BASE_URL}/api/settings`, {
      headers: bridgeToken ? getBridgeHeaders() : undefined,
    });

    if (response.status === 401 || response.status === 403) {
      setBridgeStatus(response.status === 401 ? 'unauthorized' : 'disconnected');
      return false;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // 检查响应中是否有 success 标志
    if (data.success === false) {
      console.error('Settings sync failed:', data.error);
      setBridgeStatus('disconnected');
      return false;
    }

    // 从多个可能的位置提取数据
    const extensionSettings = data?.extensionSettings || data?.settings || {};
    const bridgeInfo = data?.bridge || {};

    const nextDisplayName = sanitizeDisplayName(
      extensionSettings?.displayName || data?.settings?.displayName
    );

    // 尝试从多个位置获取 bridge token
    const newBridgeToken =
      extensionSettings?.bridgeToken || data?.bridgeToken || data?.settings?.bridgeToken;

    if (newBridgeToken) {
      saveBridgeToken(newBridgeToken);
    }

    if (nextDisplayName !== displayName) {
      displayName = nextDisplayName;
      chrome.storage.sync.set({ displayName }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving display name:', chrome.runtime.lastError);
        }
      });
    }

    // 检查当前扩展是否是已注册的扩展
    if (!isCurrentExtensionSession({ ...data, ...bridgeInfo, extensionSettings })) {
      setBridgeStatus('disconnected');
      return false;
    }

    setBridgeStatus('connected');
    return true;
  } catch (error) {
    setBridgeStatus(error.message?.includes('401') ? 'unauthorized' : 'disconnected');
    if (!error.message?.includes('Failed to fetch') && !error.message?.includes('NetworkError')) {
      console.log('Could not sync bridge session from app:', error);
    }
    return false;
  }
}

async function ensureBridgeConnection(force = false) {
  const registered = await registerWithApp();
  if (!registered) {
    return false;
  }

  const synced = await syncBridgeSession(force);
  if (!synced) {
    return false;
  }

  return true;
}

function sanitizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}

function getAddressName() {
  return displayName || 'there';
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function extractDomain(url) {
  try {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return null;
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function startTabVisit(tab) {
  if (!tab || !tab.url || tab.url.startsWith('chrome://')) return;
  const domain = extractDomain(tab.url);
  if (!domain) return;

  if (currentVisit) endTabVisit();

  currentVisit = {
    tabId: tab.id,
    url: tab.url,
    title: tab.title || 'Untitled',
    domain,
    startTime: Date.now(),
  };

  tabTracker.startSession(tab.id, tab.url, tab.title);
}

function endTabVisit() {
  if (!currentVisit) return;
  const duration = Date.now() - currentVisit.startTime;
  if (duration > 3000) {
    tabVisitHistory.push({
      ...currentVisit,
      endTime: Date.now(),
      duration,
    });
    if (tabVisitHistory.length > 500) {
      tabVisitHistory = tabVisitHistory.slice(-500);
    }
  }

  tabTracker.endSession(currentVisit.tabId);
  currentVisit = null;
}

async function flushHistoryToApp() {
  if (tabVisitHistory.length === 0) return;
  const toFlush = [...tabVisitHistory];
  tabVisitHistory = [];
  try {
    await postToApp('/api/tabs/history', { history: toFlush });
  } catch {
    setBridgeStatus('disconnected');
    tabVisitHistory = [...toFlush, ...tabVisitHistory].slice(-500);
  }
}

async function syncPomodoroStateToApp() {
  if (!appConnected) return;
  try {
    await postToApp('/api/pomodoro', pomodoroTimer.getState());
  } catch (error) {
    console.error('Error syncing pomodoro to app:', error);
  }
}

// Override pomodoro methods to sync with app
const originalStartFocus = pomodoroTimer.startFocus.bind(pomodoroTimer);
pomodoroTimer.startFocus = function () {
  originalStartFocus();
  syncPomodoroStateToApp();
};

const originalStartBreak = pomodoroTimer.startBreak.bind(pomodoroTimer);
pomodoroTimer.startBreak = function () {
  originalStartBreak();
  syncPomodoroStateToApp();
};

const originalPause = pomodoroTimer.pause.bind(pomodoroTimer);
pomodoroTimer.pause = function () {
  originalPause();
  syncPomodoroStateToApp();
};

const originalResume = pomodoroTimer.resume.bind(pomodoroTimer);
pomodoroTimer.resume = function () {
  originalResume();
  syncPomodoroStateToApp();
};

const originalStop = pomodoroTimer.stop.bind(pomodoroTimer);
pomodoroTimer.stop = function () {
  originalStop();
  syncPomodoroStateToApp();
};

const originalCompleteSession = pomodoroTimer.completeSession.bind(pomodoroTimer);
pomodoroTimer.completeSession = function () {
  originalCompleteSession();
  syncPomodoroStateToApp();
};

async function syncFocusTask() {
  try {
    const response = await fetch(`${APP_BASE_URL}/api/focus-task`);
    if (response.ok) {
      const data = await response.json();
      activeFocusTask = data.focusTask || null;
      if (bridgeStatus !== 'unauthorized') {
        setBridgeStatus('connected');
      }
    }
  } catch {
    setBridgeStatus('disconnected');
  }
}

// ── BlockEnforcer ─────────────────────────────────────────────────────────────
// Polls /api/block-state and enforces the active blocked-domain list via
// chrome.declarativeNetRequest dynamic rules. Runs independently of the bridge
// auth so it works even when the extension is newly registered.

const BLOCK_ENFORCER_RULE_ID_START = 10000; // offset so we don't collide with static rules
const BLOCK_POLL_INTERVAL_MS = 10 * 1000;

const blockEnforcer = {
  _activeBlockedDomains: [],
  _allowedDomains: [],
  _lastPollAt: 0,

  /**
   * Fetch the current block state from the Helpy app.
   * No bridge auth needed — /api/block-state is a public endpoint.
   * @returns {Promise<{active:boolean, blockedDomains:string[]}>}
   */
  async fetchBlockState() {
    try {
      const res = await fetch(`${APP_BASE_URL}/api/block-state`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { active: false, blockedDomains: [] };
      const data = await res.json();
      return {
        active: Boolean(data.active),
        blockedDomains: Array.isArray(data.blockedDomains) ? data.blockedDomains : [],
        allowedDomains: Array.isArray(data.allowedDomains) ? data.allowedDomains : [],
        activeRules: data.activeRules || [],
      };
    } catch {
      return { active: false, blockedDomains: [] };
    }
  },

  shouldNudge(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
      return this._activeBlockedDomains.some(matches) && !this._allowedDomains.some(matches);
    } catch {
      return false;
    }
  },

  /**
   * Sync the declarativeNetRequest ruleset with the current block state.
   */
  async sync() {
    if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;

    const state = await this.fetchBlockState();
    const newDomains = state.active ? state.blockedDomains : [];
    this._lastPollAt = Date.now();

    this._activeBlockedDomains = newDomains;
    this._allowedDomains = state.allowedDomains || [];
    // Existing loopback HTTP is used for sync to avoid a separate native host.
    // Remove legacy redirect rules so the content-script nudge is always shown first.
    try {
      const legacyRuleIds = Array.from({ length: 500 }, (_, i) => BLOCK_ENFORCER_RULE_ID_START + i);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: legacyRuleIds,
        addRules: [],
      });
    } catch {}
  },

  /** Call on extension startup to restore rules from app state. */
  async init() {
    await this.sync();
  },

  /**
   * Returns the current cached blocked-domain list (no network call).
   * @returns {string[]}
   */
  getActiveDomains() {
    return [...this._activeBlockedDomains];
  },
};

// ── periodicSync ────────────────────────────────────────────────────────────
// Periodically sync settings and reconnect
async function periodicSync() {
  const connected = await ensureBridgeConnection(true);
  if (!connected) {
    return;
  }

  await syncFocusTask();

  // Also try to sync pomodoro from app if available
  try {
    const response = await fetch(`${APP_BASE_URL}/api/pomodoro`);
    if (response.ok) {
      const data = await response.json();
      if (data.state && !pomodoroTimer.isRunning) {
        // Optional: Sync app pomodoro to extension if needed
      }
    }
  } catch {
    // Ignore errors
  }
}

function broadcastStateUpdate() {
  try {
    chrome.runtime
      .sendMessage({ type: 'STATE_UPDATE' })
      .catch(() => {
        // No listener currently registered (popup/options closed) — expected.
      });
  } catch {
    // Synchronous error (e.g. extension context invalidated) — ignore.
  }
}

function savePauseState() {
  try {
    chrome.storage.sync.set({ isPaused }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving pause state:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('Error saving pause state:', error);
  }
}

function updateTabActivity(tabId) {
  if (!tabId) {
    return;
  }
  tabActivity[tabId] = Date.now();
  delete tabLastNotified[tabId];

  tabTracker.updateActivity(tabId);
}

function resetTabTimers() {
  const now = Date.now();
  try {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Error querying tabs for reset:', chrome.runtime.lastError);
        return;
      }
      tabs.forEach((tab) => {
        if (tab.id) {
          tabActivity[tab.id] = now;
          delete tabLastNotified[tab.id];
        }
      });
    });
  } catch (error) {
    console.error('Error resetting tab timers:', error);
  }
}

function startChecking() {
  if (checkTimer) {
    clearInterval(checkTimer);
  }
  checkTimer = setInterval(checkInactiveTabs, CHECK_INTERVAL_MS);

  setInterval(flushHistoryToApp, HISTORY_FLUSH_INTERVAL_MS);
  setInterval(periodicSync, BRIDGE_SYNC_INTERVAL_MS);
  setInterval(() => blockEnforcer.sync(), BLOCK_POLL_INTERVAL_MS);
  setInterval(() => tabTracker.checkTabCount(), 60000);
}

function checkInactiveTabs() {
  if (isPaused) {
    return;
  }

  const now = Date.now();
  try {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Error querying tabs for inactivity check:', chrome.runtime.lastError);
        return;
      }
      tabs.forEach((tab) => {
        if (!tab?.id) {
          return;
        }

        if (!tabActivity[tab.id]) {
          tabActivity[tab.id] = now;
        }

        const inactiveTime = now - tabActivity[tab.id];
        if (inactiveTime < inactivityDuration) {
          return;
        }

        const lastNotified = tabLastNotified[tab.id] || 0;
        if (now - lastNotified >= notificationIntervalDuration) {
          tabLastNotified[tab.id] = now;
          showNotification(tab);
        }
      });
    });
  } catch (error) {
    console.error('Error checking inactive tabs:', error);
  }
}

function createInactiveNotificationMessage(tab) {
  const addressName = getAddressName();
  return {
    action: 'showNotification',
    title: displayName ? `Time to refocus, ${addressName}` : 'Time to refocus',
    body: `"${tab.title || 'Untitled'}" has been inactive for at least ${Math.round(
      inactivityDuration / 60000
    )} minutes.`,
    options: { duration: 5000 },
  };
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function showNotification(tab) {
  const message = createInactiveNotificationMessage(tab);

  if (tab?.id) {
    try {
      await sendMessageToTab(tab.id, message);
      return;
    } catch (error) {}
  }

  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      if (chrome.runtime.lastError) {
        console.error('Error querying active tab:', chrome.runtime.lastError);
        return;
      }
      if (!activeTabs[0]?.id) {
        return;
      }
      chrome.tabs
        .sendMessage(activeTabs[0].id, message, () => {
          // Browser-owned pages have no content script to receive this message.
          void chrome.runtime.lastError;
        })
        .catch(() => {}); // Catch the promise rejection for pages without a listener
    });
  } catch (error) {
    console.error('Error showing notification:', error);
  }
}

async function syncDisplayNameFromApp(force = false) {
  return syncBridgeSession(force);
}

async function sendTabData() {
  try {
    const [tabsResult, activeTabResult] = await Promise.all([
      new Promise((resolve, reject) => {
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(tabs);
        });
      }),
      new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          resolve(tabs);
        });
      }),
    ]);

    const activeTab = activeTabResult[0];
    const tabData = tabsResult.map((tab) => ({
      id: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      active: activeTab?.id === tab.id,
    }));

    await postToApp('/api/tabs', { tabs: tabData });
    await syncDisplayNameFromApp();
  } catch (error) {
    setBridgeStatus(error.message?.includes('401') ? 'unauthorized' : 'disconnected');
    if (!error.message?.includes('Failed to fetch') && !error.message?.includes('NetworkError')) {
      console.log('Could not send tab data:', error);
    }
  }
}

const debouncedSendTabData = debounce(sendTabData, 500);

function getPopupState(sendResponse) {
  const now = Date.now();
  try {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Error querying tabs for popup state:', chrome.runtime.lastError);
        sendResponse({
          isPaused,
          inactivityMinutes: inactivityDuration / (60 * 1000),
          tabs: [],
          displayName,
          appConnected,
          bridgeStatus,
          pomodoroState: pomodoroTimer.getState(),
          tabReport: tabTracker.getTimeReport(1),
          googleUser,
        });
        return;
      }

      const tabsInfo = tabs.map((tab) => {
        const lastActive = tabActivity[tab.id] || now;
        const inactiveTime = now - lastActive;

        return {
          id: tab.id,
          title: tab.title || 'Untitled',
          url: tab.url || '',
          active: Boolean(tab.active),
          inactiveTime,
          isInactive: inactiveTime >= inactivityDuration,
        };
      });

      sendResponse({
        isPaused,
        inactivityMinutes: inactivityDuration / (60 * 1000),
        tabs: tabsInfo,
        displayName,
        appConnected,
        bridgeStatus,
        activeFocusTask,
        pomodoroState: pomodoroTimer.getState(),
        tabReport: tabTracker.getTimeReport(1),
        googleUser,
        blockState: {
          active: blockEnforcer._activeBlockedDomains.length > 0,
          blockedDomains: blockEnforcer.getActiveDomains(),
        },
      });
    });
  } catch (error) {
    console.error('Error getting popup state:', error);
    sendResponse({
      isPaused,
      inactivityMinutes: inactivityDuration / (60 * 1000),
      tabs: [],
      displayName,
      appConnected,
      bridgeStatus,
      activeFocusTask,
      pomodoroState: pomodoroTimer.getState(),
      tabReport: tabTracker.getTimeReport(1),
      googleUser,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'blockNudgeDecision' && sender.tab?.id) {
      if (message.decision !== 'leave') {
        const url = sender.tab.url || message.url;
        const domain = (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return '';
          }
        })();
        fetch(`${APP_BASE_URL}/api/blocked-attempt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        }).catch(() => {});
        chrome.tabs.update(sender.tab.id, {
          url: chrome.runtime.getURL(
            `blocked.html?url=${encodeURIComponent(url || '')}&rule=Helpy+Blocklist`
          ),
        });
      }
      sendResponse({ success: true });
      return;
    }
    if (
      sender.tab?.id &&
      (message.action === 'tabActivity' || message.action === 'contentScriptReady')
    ) {
      updateTabActivity(sender.tab.id);
      sendResponse({ success: true });
      return;
    }

    if (message.action === 'getState') {
      // The popup refreshes while it is open. Re-registering the extension and
      // fetching settings for every refresh created unnecessary local traffic.
      // A disconnected bridge is still retried immediately.
      if (bridgeStatus === 'connected') {
        getPopupState(sendResponse);
      } else {
        ensureBridgeConnection(true)
          .catch(() => {})
          .finally(() => {
            getPopupState(sendResponse);
          });
      }
      return true;
    }

    if (message.action === 'pauseTracking') {
      isPaused = true;
      savePauseState();
      endTabVisit();
      broadcastStateUpdate();
      sendResponse({ success: true, isPaused: true });
      return;
    }

    if (message.action === 'resumeTracking') {
      isPaused = false;
      resetTabTimers();
      savePauseState();
      broadcastStateUpdate();
      sendResponse({ success: true, isPaused: false });
      return;
    }

    if (message.action === 'refreshSettings') {
      ensureBridgeConnection(true).then(() => {
        sendResponse({ success: true, displayName, appConnected, bridgeStatus, bridgeToken });
      });
      return true;
    }

    if (message.action === 'syncSettingsToApp') {
      ensureBridgeConnection(true)
        .then(async (connected) => {
          if (!connected) {
            sendResponse({
              success: false,
              error: 'Helpy app is unavailable',
              bridgeStatus,
            });
            return;
          }

          const response = await postToApp('/api/settings', message.payload || {});
          const result = await response.json();
          sendResponse({
            success: true,
            settings: result.settings,
            bridgeStatus,
          });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message, bridgeStatus });
        });
      return true;
    }

    if (message.action === 'pomodoroStart') {
      pomodoroTimer.startFocus();
      sendResponse({ success: true, state: pomodoroTimer.getState() });
      return;
    }

    if (message.action === 'pomodoroPause') {
      pomodoroTimer.pause();
      sendResponse({ success: true, state: pomodoroTimer.getState() });
      return;
    }

    if (message.action === 'pomodoroResume') {
      pomodoroTimer.resume();
      sendResponse({ success: true, state: pomodoroTimer.getState() });
      return;
    }

    if (message.action === 'pomodoroStop') {
      pomodoroTimer.stop();
      sendResponse({ success: true, state: pomodoroTimer.getState() });
      return;
    }

    if (message.action === 'pomodoroBreak') {
      pomodoroTimer.startBreak();
      sendResponse({ success: true, state: pomodoroTimer.getState() });
      return;
    }

    if (message.action === 'getPomodoroState') {
      sendResponse({ success: true, state: pomodoroTimer.getState() });
      return;
    }

    if (message.action === 'openReports') {
      chrome.tabs.create({
        url: 'reports.html',
      });
      sendResponse({ success: true });
      return;
    }

    if (message.action === 'getReport') {
      const days = message.days || 1;

      // First try to get report from app
      ensureBridgeConnection(false)
        .then(async (connected) => {
          if (connected) {
            try {
              const response = await fetch(`http://localhost:3456/api/reports?days=${days}`, {
                headers: getBridgeHeaders(),
              });
              if (response.ok) {
                const data = await response.json();
                if (data.success && data.reports) {
                  // Convert app report format to extension format
                  const domainStats = data.reports.timeDistribution.map((item) => ({
                    domain: item.domain,
                    totalTime: item.totalTime,
                    visits: item.visits || 0,
                  }));

                  // The desktop app receives completed visits. Add the current
                  // session from the extension so the report is useful before a
                  // tab is closed or the periodic sync runs.
                  const localActiveReport = tabTracker.getTimeReport(days);
                  const activeStats = localActiveReport.activeSessions.reduce((stats, session) => {
                    if (!session.domain) return stats;
                    const now = Date.now();
                    const start = Math.max(Number(session.startTime), now - days * 86400000);
                    const duration = now - start;
                    if (duration <= 0) return stats;
                    const existing = stats.get(session.domain) || { totalTime: 0, visits: 0 };
                    existing.totalTime += duration;
                    existing.visits += 1;
                    stats.set(session.domain, existing);
                    return stats;
                  }, new Map());

                  activeStats.forEach((active, domain) => {
                    const stat = domainStats.find((item) => item.domain === domain);
                    if (stat) {
                      stat.totalTime += active.totalTime;
                      stat.visits += active.visits;
                    } else {
                      domainStats.push({ domain, ...active });
                    }
                  });
                  domainStats.sort((a, b) => b.totalTime - a.totalTime);
                  const activeTime = [...activeStats.values()].reduce(
                    (sum, active) => sum + active.totalTime,
                    0
                  );

                  sendResponse({
                    domainStats,
                    totalTime: data.reports.totalTime + activeTime,
                    switchCount: data.reports.tabSwitchCount + activeStats.size,
                    fromApp: true,
                  });
                  return;
                }
              }
            } catch (error) {
              console.error('Error fetching report from app:', error);
            }
          }

          // Fall back to extension's own data
          const report = tabTracker.getTimeReport(days);
          sendResponse(report);
        })
        .catch(() => {
          // Fall back to extension's own data on any error
          const report = tabTracker.getTimeReport(days);
          sendResponse(report);
        });

      return true; // Indicate async response
    }

    // Google Auth actions
    if (message.action === 'googleLogin') {
      googleLogin().then(sendResponse);
      return true; // Indicate async response
    }

    if (message.action === 'googleLogout') {
      googleLogout().then(sendResponse);
      return true;
    }

    if (message.action === 'getGoogleUser') {
      sendResponse({ success: true, user: googleUser });
      return;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  try {
    updateTabActivity(activeInfo.tabId);
    chrome.tabs.get(activeInfo.tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      endTabVisit();
      startTabVisit(tab);
      broadcastStateUpdate();
    });
    debouncedSendTabData();
  } catch (error) {
    console.error('Error handling tab activation:', error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  try {
    updateTabActivity(tabId);
    if (changeInfo.status === 'complete' && tab.active) {
      endTabVisit();
      startTabVisit(tab);
      broadcastStateUpdate();
    }
    if (changeInfo.status === 'complete' && tab.url && blockEnforcer.shouldNudge(tab.url)) {
      chrome.tabs.sendMessage(tabId, { action: 'showBlockNudge', url: tab.url }).catch(() => {});
    }
    debouncedSendTabData();
  } catch (error) {
    console.error('Error handling tab update:', error);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  try {
    if (tab.id) {
      updateTabActivity(tab.id);
    }
    debouncedSendTabData();
    tabTracker.checkTabCount();
  } catch (error) {
    console.error('Error handling tab creation:', error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    if (currentVisit && currentVisit.tabId === tabId) {
      endTabVisit();
    }
    delete tabActivity[tabId];
    delete tabLastNotified[tabId];
    broadcastStateUpdate();
    debouncedSendTabData();
  } catch (error) {
    console.error('Error handling tab removal:', error);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  try {
    chrome.tabs.query({ active: true, windowId }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.error('Error querying active tab on window focus:', chrome.runtime.lastError);
        return;
      }
      if (tabs[0]?.id) {
        updateTabActivity(tabs[0].id);
        debouncedSendTabData();
      }
    });
  } catch (error) {
    console.error('Error handling window focus change:', error);
  }
});

async function registerWithApp() {
  try {
    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime || !chrome.runtime.id) {
      console.warn('Chrome runtime not available, cannot register with app');
      return false;
    }
    const extensionId = chrome.runtime.id;
    if (!extensionId) {
      return false;
    }

    const response = await fetch(`${APP_BASE_URL}/api/extension/register`, {
      method: 'POST',
      headers: getBridgeHeaders(),
      body: JSON.stringify({ extensionId }),
    });

    if (response.ok) {
      const data = await response.json();

      // 检查响应是否表示成功
      if (data.success === false) {
        console.error('Extension registration failed:', data.error);
        setBridgeStatus('disconnected');
        return false;
      }

      // 从多个可能的位置提取 bridge token
      const newBridgeToken =
        data.bridgeToken || data.extensionSettings?.bridgeToken || data.settings?.bridgeToken;

      if (newBridgeToken && newBridgeToken !== bridgeToken) {
        saveBridgeToken(newBridgeToken);
      }

      // 检查当前扩展是否是已注册的扩展
      if (!isCurrentExtensionSession(data)) {
        setBridgeStatus('disconnected');
        return false;
      }

      // 如果注册成功，立即同步会话
      await syncBridgeSession(true);
      return true;
    }
    setBridgeStatus(response.status === 401 ? 'unauthorized' : 'disconnected');
    return false;
  } catch (error) {
    setBridgeStatus('disconnected');
    console.log('Could not register extension with app:', error);
    return false;
  }
}

// Only run immediate initialization in real Chrome extension context, not in tests
if (typeof module === 'undefined' || !module.exports) {
  ensureBridgeConnection(true)
    .then((connected) => {
      if (connected) {
        return sendTabData();
      }
      return false;
    })
    .catch(() => {});
}

chrome.runtime.onStartup.addListener(() => {
  ensureBridgeConnection(true)
    .then((connected) => {
      if (connected) {
        return sendTabData();
      }
      return false;
    })
    .catch(() => {});
});

if (!CommandHandlerCtor) {
  throw new Error('CommandHandler module failed to load in background.js');
}

let commandHandler = new CommandHandlerCtor({
  dataTrackingManager,
  sendPlanToApp: sendCommandPlanToApp,
  onPlanActivated: handleActivatedPlan,
  handlePomodoroCommand: handleBackgroundPomodoroCommand,
  openReports: openReportsPage,
  openSettings: openSettingsPage,
});

if (chrome.omnibox) {
  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const suggestions = commandHandler.getSuggestions(text);
    suggest(
      suggestions.map((s) => ({
        content: s.content,
        description: s.description,
      }))
    );
  });

  chrome.omnibox.onInputEntered.addListener(async (text) => {
    const result = await commandHandler.handleCommand(text);

    if (result.action === 'showNotification' && result.title) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: result.title,
        message: result.message,
        priority: 2,
      });
    }
  });
}

if (chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-tracking') {
      isPaused = !isPaused;
      if (isPaused) {
        endTabVisit();
      } else {
        resetTabTimers();
      }
      savePauseState();
      broadcastStateUpdate();
    } else if (command === 'toggle-pomodoro') {
      if (pomodoroTimer.isRunning) {
        pomodoroTimer.pause();
      } else {
        pomodoroTimer.startFocus();
      }
    } else if (command === 'open-reports') {
      chrome.tabs.create({
        url: 'reports.html',
      });
    }
  });
}

let isFocusShieldActive = false;

async function updateFocusShieldRules(active) {
  isFocusShieldActive = active;
  if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) return;
  const ruleIdOffset = 9000;
  const domains = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'reddit.com', 'tiktok.com'];

  const rules = domains.map((domain, idx) => ({
    id: ruleIdOffset + idx,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: '/blocked.html' },
    },
    condition: {
      urlFilter: `*://${domain}/*`,
      resourceTypes: ['main_frame'],
    },
  }));

  const ruleIds = rules.map((r) => r.id);
  try {
    if (active) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
        addRules: rules,
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
      });
    }
  } catch (err) {
    console.warn('[Background] Focus Shield rules update failed:', err);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'setShieldState') {
      updateFocusShieldRules(Boolean(message.active));
      if (typeof sendResponse === 'function') sendResponse({ success: true, active: message.active });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pomodoro-complete') {
    pomodoroTimer.completeSession();
  }
});

// For testing purposes (only if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CommandHandler,
    createInactiveNotificationMessage,
    dataTrackingManager,
    ensureBridgeConnection,
    registerWithApp,
    sanitizeDisplayName,
    syncBridgeSession,
    syncDisplayNameFromApp,
    updateTabActivity,
    applyStoredSettings,
    startChecking,
    tabTracker,
    pomodoroTimer,
    __testing: {
      getState() {
        return {
          activeFocusTask,
          appConnected,
          bridgeStatus,
          bridgeToken,
          displayName,
          isPaused,
          tabActivity: { ...tabActivity },
          tabVisitHistory: [...tabVisitHistory],
        };
      },
      setBridgeStatus,
      setBridgeToken(value) {
        bridgeToken = sanitizeBridgeToken(value);
      },
      setDisplayName(value) {
        displayName = sanitizeDisplayName(value);
      },
      async init() {
        // Simulate the top-level initialization
        // 1. Load Google auth (noop in test)
        // 2. Load sync settings and initialize
        const syncResult = await chrome.storage.sync.get([
          'inactivityMinutes',
          'notificationIntervalMinutes',
          'isPaused',
          'displayName',
          'bridgeToken',
        ]);
        applyStoredSettings(syncResult);
        startChecking();
        await syncDisplayNameFromApp(true);
        // tabTracker.init() and pomodoroTimer.init() are async, so wait for them
        await tabTracker.init();
        await pomodoroTimer.init();
      },
    },
  };
}