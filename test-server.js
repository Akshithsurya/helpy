const express = require('express');
const bodyParser = require('body-parser');
const { SettingsManager } = require('./settings');
const { AuthManager, GOOGLE_CLIENT_ID, isGoogleConfigured } = require('./auth');
const {
  normalizeTrackedTab,
  normalizeHistoryEntry,
  sanitizeBridgeToken,
} = require('./shared/schemas');
const { getDataFilePath } = require('./shared/app-paths');
const fs = require('fs');

const settingsManager = new SettingsManager();
let authManager = new AuthManager();
const expressApp = express();
const PORT = 3456;
const TAB_HISTORY_FILE = getDataFilePath('tab-history-store.json');
const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
let registeredExtensionId = null;
let activeFocusTask = null;
let focusPlanManager = null;
let mainWindow = null;
let tabHistory = [];
let pomodoroState = { isRunning: false, isBreak: false, remainingTime: 0, cycleCount: 0 };
let googleAuthCallback = null;
let githubAuthCallback = null;
let verifyOAuthState = null;

// Load tab history from file
function loadTabHistory() {
  try {
    if (fs.existsSync(TAB_HISTORY_FILE)) {
      const data = fs.readFileSync(TAB_HISTORY_FILE, 'utf8');
      tabHistory = JSON.parse(data);
    }
  } catch (error) {
    console.error('[ERROR] Loading tab history:', error);
    tabHistory = [];
  }
}

// Save tab history to file
function saveTabHistory() {
  try {
    fs.writeFileSync(TAB_HISTORY_FILE, JSON.stringify(tabHistory, null, 2));
  } catch (error) {
    console.error('[ERROR] Saving tab history:', error);
  }
}

loadTabHistory();

function initAppDependencies(dependencies = {}) {
  if (dependencies.authManager) {
    authManager = dependencies.authManager;
  }
  if (dependencies.focusPlanManager) {
    focusPlanManager = dependencies.focusPlanManager;
  }
  if (dependencies.mainWindow) {
    mainWindow = dependencies.mainWindow;
  }
  if (dependencies.googleAuthCallback) {
    googleAuthCallback = dependencies.googleAuthCallback;
  }
  if (dependencies.githubAuthCallback) {
    githubAuthCallback = dependencies.githubAuthCallback;
  }
  if (dependencies.verifyOAuthState) {
    verifyOAuthState = dependencies.verifyOAuthState;
  }
}

function setGoogleAuthCallback(callback) {
  googleAuthCallback = callback;
}

function setGitHubAuthCallback(callback) {
  githubAuthCallback = callback;
}

// Middleware
expressApp.use(bodyParser.json({ limit: '1mb' }));

expressApp.use((req, res, next) => {
  console.log('[INFO]', req.method, req.url);
  next();
});

const allowedOrigins = ['chrome-extension://*', 'http://localhost:*'];
expressApp.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    allowedOrigins.some((pattern) => {
      if (pattern === 'chrome-extension://*') {
        return origin?.startsWith('chrome-extension://');
      }
      if (pattern === 'http://localhost:*') {
        return origin?.startsWith('http://localhost:');
      }
      return false;
    }) ||
    !origin
  ) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Helpy-Bridge-Token');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function parseRequestOrigin(origin) {
  if (typeof origin !== 'string' || !origin.trim()) {
    return null;
  }

  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function getOriginExtensionId(origin) {
  const parsedOrigin = parseRequestOrigin(origin);
  if (!parsedOrigin || parsedOrigin.protocol !== 'chrome-extension:') {
    return null;
  }
  return parsedOrigin.hostname || null;
}

function isLoopbackOrigin(origin) {
  const parsedOrigin = parseRequestOrigin(origin);
  return Boolean(
    parsedOrigin &&
    (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
    ALLOWED_LOOPBACK_HOSTS.has(parsedOrigin.hostname)
  );
}

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  return Boolean(getOriginExtensionId(origin) || isLoopbackOrigin(origin));
}

function getBridgeToken() {
  return settingsManager.getSettings().bridgeToken;
}

function getBridgeTokenFromRequest(req) {
  return sanitizeBridgeToken(req.get('x-helpy-bridge-token') || req.body?.bridgeToken);
}

function isRegisteredExtensionOrigin(req) {
  const originExtensionId = getOriginExtensionId(req.headers.origin);
  return Boolean(
    originExtensionId && registeredExtensionId && originExtensionId === registeredExtensionId
  );
}

function isTrustedBridgeRequest(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  if (isLoopbackOrigin(origin)) {
    return true;
  }

  return isRegisteredExtensionOrigin(req);
}

function isAuthorizedBridgeRequest(req) {
  const expectedToken = getBridgeToken();
  const providedToken = getBridgeTokenFromRequest(req);
  return Boolean(
    expectedToken && providedToken && expectedToken === providedToken && isTrustedBridgeRequest(req)
  );
}

function respondUnauthorized(res) {
  res.status(401).json({ success: false, error: 'Unauthorized bridge request' });
}

function respondForbidden(res, error = 'Forbidden bridge origin') {
  res.status(403).json({ success: false, error });
}

function getBridgeMetadata() {
  return {
    registeredExtensionId,
    appConnected: true,
    bridgeStatus: registeredExtensionId ? 'connected' : 'awaiting-registration',
  };
}

function getActiveFocusState() {
  return { status: 'idle' };
}

function buildExtensionSettingsPayload() {
  const settings = settingsManager.getSettings();
  const focusState = getActiveFocusState();
  return {
    displayName: settings.displayName,
    bridgeToken: settings.bridgeToken,
    registeredExtensionId,
    activeFocusTask,
    focusState,
  };
}

function createFallbackPlan(planConfig = {}) {
  return {
    title: planConfig.title || 'Planned session',
    goal: planConfig.goal || '',
    durationMinutes: planConfig.durationMinutes || 30,
    nextQueue: Array.isArray(planConfig.nextQueue) ? planConfig.nextQueue : [],
    source: planConfig.source || 'extension',
    createdAt: planConfig.createdAt || new Date().toISOString(),
  };
}

function processFocusPlanSubmission(planConfig = {}) {
  const normalizedPlan = focusPlanManager
    ? focusPlanManager.createPlan(planConfig)
    : createFallbackPlan(planConfig);

  // 确保 durationMinutes 是有效数字
  if (!normalizedPlan.durationMinutes || typeof normalizedPlan.durationMinutes !== 'number') {
    normalizedPlan.durationMinutes = 30;
  }
  normalizedPlan.durationMinutes = Math.max(5, Math.min(240, normalizedPlan.durationMinutes));

  const historyMetadata = {
    source: normalizedPlan.source || planConfig.source || 'extension',
    status: 'in_progress',
  };

  activeFocusTask = normalizedPlan.title || null;

  let historyEntry = null;
  if (focusPlanManager) {
    try {
      historyEntry = focusPlanManager.addToHistory(normalizedPlan, historyMetadata);
    } catch (error) {
      console.error('[ERROR] Failed to add plan to history:', error);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('plan-updated', {
      plan: normalizedPlan,
      historyEntry,
      activeFocusTask,
    });
  }

  return {
    plan: normalizedPlan,
    historyEntry,
    activeFocusTask,
  };
}

expressApp.post('/api/extension/register', (req, res) => {
  try {
    const { extensionId } = req.body || {};
    const originExtensionId = getOriginExtensionId(req.headers.origin);

    if (!extensionId || typeof extensionId !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing extensionId' });
    }

    // Allow registration if origin is chrome-extension and matches, or if origin isn't available (for testing/dev)
    if (req.headers.origin && originExtensionId && originExtensionId !== extensionId) {
      return respondForbidden(res, 'Extension origin does not match registration request');
    }

    registeredExtensionId = extensionId;
    console.log('[INFO] Extension registered with ID:', extensionId);

    let currentSettings = settingsManager.getSettings();
    if (!currentSettings.bridgeToken) {
      currentSettings = settingsManager.updateSettings({});
    }

    const bridgeToken = currentSettings.bridgeToken;
    res.json({
      success: true,
      bridgeToken,
      bridge: getBridgeMetadata(),
      extensionSettings: buildExtensionSettingsPayload(),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/extension/register POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.get('/api/settings', (req, res) => {
  try {
    const origin = req.headers.origin;
    const isExtensionOrigin = Boolean(getOriginExtensionId(origin));

    if (origin && !isOriginAllowed(origin)) {
      return respondForbidden(res);
    }

    if (isExtensionOrigin && registeredExtensionId && !isRegisteredExtensionOrigin(req)) {
      return respondForbidden(res, 'Extension origin does not match active bridge session');
    }

    res.json({
      success: true,
      settings: settingsManager.getSettings(),
      extensionSettings: buildExtensionSettingsPayload(),
      bridge: getBridgeMetadata(),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/settings GET:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.post('/api/settings', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    const settings = settingsManager.updateSettings(req.body || {});
    res.json({ success: true, settings, bridge: getBridgeMetadata() });
  } catch (error) {
    console.error('[ERROR] handling /api/settings POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Authentication endpoints
expressApp.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    const result = await authManager.register(email, password, displayName);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] handling /api/auth/register POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authManager.login(email, password);
    res.json(result);
  } catch (error) {
    console.error('[ERROR] handling /api/auth/login POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.get('/api/auth/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = req.headers['x-helpy-bridge-token'] || req.query.token;
    }
    if (!token) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }
    const user = authManager.verifyToken(token);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    res.json({ success: true, user });
  } catch (error) {
    console.error('[ERROR] handling /api/auth/me GET:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.get('/api/focus-task', (req, res) => {
  try {
    res.json({
      focusTask: activeFocusTask,
      focusState: buildExtensionSettingsPayload().focusState,
    });
  } catch {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Tab endpoints
expressApp.post('/api/tabs', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    if (!Array.isArray(req.body?.tabs)) {
      return res.status(400).json({ success: false, error: 'tabs must be an array' });
    }

    const tabs = req.body.tabs.map((tab) => normalizeTrackedTab(tab)).filter(Boolean);

    // Notify main window of tab updates
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tabs-updated', tabs);
    }
    res.json({ success: true, received: tabs.length, bridge: getBridgeMetadata() });
  } catch (error) {
    console.error('[ERROR] handling /api/tabs POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Tab history endpoints
expressApp.post('/api/tabs/history', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    if (!Array.isArray(req.body?.history)) {
      return res.status(400).json({ success: false, error: 'history must be an array' });
    }

    const newHistory = req.body.history
      .map((entry) => normalizeHistoryEntry(entry))
      .filter(Boolean);
    tabHistory = [...tabHistory, ...newHistory].slice(-5000); // Keep last 5000 entries
    saveTabHistory();
    // Notify main window of history update
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-history-updated', tabHistory);
    }
    res.json({
      success: true,
      received: newHistory.length,
      total: tabHistory.length,
      bridge: getBridgeMetadata(),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/tabs/history POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.get('/api/tabs/history', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    const limit = parseInt(req.query.limit, 10) || 100;
    const days = parseInt(req.query.days, 10);
    let filteredHistory = tabHistory;

    if (days) {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      filteredHistory = tabHistory.filter((entry) => entry.startTime > cutoff);
    }

    res.json({
      success: true,
      history: filteredHistory.slice(-limit),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/tabs/history GET:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.post('/api/focus-plan', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }

    // 验证请求体
    const body = req.body || {};
    if (!body.title) {
      return res.status(400).json({ success: false, error: 'Plan title is required' });
    }

    const result = processFocusPlanSubmission(body);
    res.json({
      success: true,
      plan: result.plan,
      historyEntry: result.historyEntry,
      activeFocusTask: result.activeFocusTask,
      bridge: getBridgeMetadata(),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/focus-plan POST:', error);
    res.status(400).json({ success: false, error: error.message || 'Invalid focus plan' });
  }
});

// Pomodoro endpoints
expressApp.post('/api/pomodoro', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    pomodoroState = { ...pomodoroState, ...req.body };
    // Notify main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pomodoro-updated', pomodoroState);
    }
    res.json({ success: true, state: pomodoroState, bridge: getBridgeMetadata() });
  } catch (error) {
    console.error('[ERROR] handling /api/pomodoro POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

expressApp.get('/api/pomodoro', (req, res) => {
  try {
    res.json({ success: true, state: pomodoroState, bridge: getBridgeMetadata() });
  } catch (error) {
    console.error('[ERROR] handling /api/pomodoro GET:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Google Auth endpoint
expressApp.post('/api/auth/google', async (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    const { googleUser } = req.body;
    if (!googleUser) {
      return res.status(400).json({ success: false, error: 'Google user details missing' });
    }
    const result = await authManager.loginWithGoogle(googleUser);
    if (result.success && googleAuthCallback) {
      await googleAuthCallback(result.user, result.token);
    }
    res.json(result);
  } catch (error) {
    console.error('[ERROR] handling /api/auth/google POST:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Public config endpoint — exposes client-side-safe config like the Google OAuth client ID
// No auth required since the Google client ID is public information (it's sent to browsers)
expressApp.get('/api/config', (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && !isOriginAllowed(origin)) {
      return respondForbidden(res);
    }
    res.json({
      success: true,
      googleClientId: GOOGLE_CLIENT_ID,
      googleConfigured: isGoogleConfigured(),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/config GET:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Reports endpoint
expressApp.get('/api/reports', (req, res) => {
  try {
    if (!isAuthorizedBridgeRequest(req)) {
      return respondUnauthorized(res);
    }
    const days = parseInt(req.query.days, 10) || 1;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const filteredHistory = tabHistory.filter((entry) => entry.startTime > cutoff);

    // Calculate domain time distribution
    const domainTime = {};
    filteredHistory.forEach((entry) => {
      if (entry.domain) {
        domainTime[entry.domain] = (domainTime[entry.domain] || 0) + (entry.duration || 0);
      }
    });

    // Convert to array and sort
    const timeDistribution = Object.entries(domainTime)
      .map(([domain, totalTime]) => ({ domain, totalTime }))
      .sort((a, b) => b.totalTime - a.totalTime);

    const totalTime = filteredHistory.reduce((sum, entry) => sum + (entry.duration || 0), 0);

    res.json({
      success: true,
      reports: {
        timeDistribution,
        totalTime,
        tabSwitchCount: filteredHistory.length,
        dateRange: { from: cutoff, to: Date.now() },
      },
      bridge: getBridgeMetadata(),
    });
  } catch (error) {
    console.error('[ERROR] handling /api/reports GET:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Local mock OAuth consent screen
expressApp.get('/auth/mock', (req, res) => {
  const { provider, state } = req.query;
  const capitalizedProvider = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'OAuth';
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mock ${capitalizedProvider} Consent</title>
      <style>
        :root {
          --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
          --card-bg: rgba(30, 41, 59, 0.7);
          --card-border: rgba(255, 255, 255, 0.1);
          --primary-color: ${provider === 'google' ? '#4285f4' : '#24292f'};
          --primary-hover: ${provider === 'google' ? '#357ae8' : '#1f2327'};
          --text-primary: #f8fafc;
          --text-secondary: #94a3b8;
          --input-bg: rgba(15, 23, 42, 0.6);
          --input-border: rgba(255, 255, 255, 0.2);
          --input-focus: #6366f1;
        }
        
        body {
          margin: 0;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: var(--bg-gradient);
          color: var(--text-primary);
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          overflow-x: hidden;
        }

        .card {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          backdrop-filter: blur(16px);
          border-radius: 16px;
          padding: 2.5rem;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
          box-sizing: border-box;
          animation: fadeIn 0.4s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .logo-container {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
        }

        .logo-container svg {
          width: 32px;
          height: 32px;
          fill: var(--text-primary);
        }

        h1 {
          font-size: 1.5rem;
          margin: 0 0 0.5rem 0;
          font-weight: 700;
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 0.875rem;
          margin: 0;
          line-height: 1.5;
        }

        .form-group {
          margin-bottom: 1.25rem;
        }

        label {
          display: block;
          font-size: 0.875rem;
          font-weight: 500;
          margin-bottom: 0.5rem;
          color: var(--text-secondary);
        }

        input {
          width: 100%;
          padding: 0.75rem 1rem;
          box-sizing: border-box;
          background: var(--input-bg);
          border: 1px solid var(--input-border);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 0.95rem;
          transition: all 0.2s ease;
        }

        input:focus {
          outline: none;
          border-color: var(--input-focus);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }

        .btn-group {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-top: 2rem;
        }

        .btn {
          width: 100%;
          padding: 0.75rem;
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          border: none;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .btn-primary {
          background: var(--primary-color);
          color: white;
        }

        .btn-primary:hover {
          background: var(--primary-hover);
          transform: translateY(-1px);
        }

        .btn-primary:active {
          transform: translateY(0);
        }

        .btn-secondary {
          background: transparent;
          border: 1px solid var(--input-border);
          color: var(--text-secondary);
        }

        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .info-box {
          background: rgba(99, 102, 241, 0.1);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 8px;
          padding: 0.75rem 1rem;
          font-size: 0.75rem;
          line-height: 1.4;
          color: #a5b4fc;
          margin-top: 1.5rem;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <div class="logo-container">
            ${provider === 'google' 
              ? `<svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`
              : `<svg viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>`
            }
          </div>
          <h1>Connect to ${capitalizedProvider}</h1>
          <p class="subtitle">Helpy is requesting access to verify your identity.</p>
        </div>

        <form id="consentForm">
          <div class="form-group">
            <label for="nameInput">Display Name</label>
            <input type="text" id="nameInput" required value="Test ${capitalizedProvider} User">
          </div>
          <div class="form-group">
            <label for="emailInput">Email Address</label>
            <input type="email" id="emailInput" required value="test-${provider}-user@example.com">
          </div>

          <div class="btn-group">
            <button type="submit" class="btn btn-primary">Authorize & Continue</button>
            <button type="button" class="btn btn-secondary" onclick="window.close();">Cancel</button>
          </div>
        </form>

        <div class="info-box">
          <strong>Local Development Mock:</strong> No password or real verification is required. Click Authorize to test.
        </div>
      </div>

      <script>
        document.getElementById('consentForm').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = document.getElementById('nameInput').value;
          const email = document.getElementById('emailInput').value;
          
          // Encode state & parameters into mock code
          const payload = JSON.stringify({ name, email });
          const base64Payload = btoa(unescape(encodeURIComponent(payload)));
          const mockCode = 'mock_${provider}_' + base64Payload;
          
          // Redirect to the actual callback URL on this server
          window.location.href = '/auth/${provider}/callback?code=' + mockCode + '&state=${state}';
        });
      </script>
    </body>
    </html>
  `);
});

// Google OAuth callback endpoint
expressApp.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle errors from Google (e.g., user denied access)
    if (error) {
      const errorMsg = error_description || error;
      console.error('[ERROR] Google OAuth error:', errorMsg);
      return res.status(400).send(`Login failed: ${errorMsg}`);
    }

    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    // Verify state (CSRF protection)
    if (verifyOAuthState) {
      const { isValid } = verifyOAuthState(state);
      if (!isValid) {
        return res.status(400).send('Invalid or expired state');
      }
    }

    const exchangeResult = await authManager.exchangeGoogleCode(code);
    if (!exchangeResult.success) {
      return res.status(400).send(`Failed to exchange Google code: ${exchangeResult.error}`);
    }

    const loginResult = await authManager.loginWithGoogle(exchangeResult.googleUser);
    if (!loginResult.success) {
      return res.status(400).send(`Failed to login: ${loginResult.error}`);
    }

    // Call the googleAuthCallback if it exists
    if (googleAuthCallback) {
      await googleAuthCallback(loginResult.user, loginResult.token);
    }

    // Send a success response to the browser
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login Successful</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
          }
          .container {
            padding: 40px;
            border-radius: 10px;
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
          }
          h1 { margin: 0 0 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Login Successful!</h1>
          <p>You can close this window now.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('[ERROR] handling Google callback:', error);
    res.status(500).send('Internal server error');
  }
});

// GitHub OAuth callback endpoint
expressApp.get('/auth/github/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle errors from GitHub (e.g., user denied access)
    if (error) {
      const errorMsg = error_description || error;
      console.error('[ERROR] GitHub OAuth error:', errorMsg);
      return res.status(400).send(`Login failed: ${errorMsg}`);
    }

    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    // Verify state (CSRF protection)
    if (verifyOAuthState) {
      const { isValid } = verifyOAuthState(state);
      if (!isValid) {
        return res.status(400).send('Invalid or expired state');
      }
    }

    const exchangeResult = await authManager.exchangeGitHubCode(code);
    if (!exchangeResult.success) {
      return res.status(400).send(`Failed to exchange GitHub code: ${exchangeResult.error}`);
    }

    const loginResult = await authManager.loginWithGitHub(exchangeResult.githubUser);
    if (!loginResult.success) {
      return res.status(400).send(`Failed to login: ${loginResult.error}`);
    }

    // Call the githubAuthCallback if it exists
    if (githubAuthCallback) {
      await githubAuthCallback(loginResult.user, loginResult.token);
    }

    // Send a success response to the browser
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login Successful</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
          }
          .container {
            padding: 40px;
            border-radius: 10px;
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
          }
          h1 { margin: 0 0 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Login Successful!</h1>
          <p>You can close this window now.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('[ERROR] handling GitHub callback:', error);
    res.status(500).send('Internal server error');
  }
});

const server = expressApp.listen(PORT, '127.0.0.1', () => {
  console.log(`[INFO] Express server running on http://localhost:${PORT}`);
  console.log('[INFO] Ready to test Chrome extension endpoints');
});

server.on('error', (error) => {
  console.error('[ERROR] Express server error:', error);
});

// Helper functions for main app
function getTabHistory(options = {}) {
  const { limit = 100, days } = options;
  let history = [...tabHistory];

  if (days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    history = history.filter((entry) => entry.startTime > cutoff);
  }

  return history.slice(-limit);
}

function getReports(days = 1) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filteredHistory = tabHistory.filter((entry) => entry.startTime > cutoff);

  const domainTime = {};
  filteredHistory.forEach((entry) => {
    if (entry.domain) {
      domainTime[entry.domain] = (domainTime[entry.domain] || 0) + (entry.duration || 0);
    }
  });

  const timeDistribution = Object.entries(domainTime)
    .map(([domain, totalTime]) => ({ domain, totalTime }))
    .sort((a, b) => b.totalTime - a.totalTime);

  const totalTime = filteredHistory.reduce((sum, entry) => sum + (entry.duration || 0), 0);

  return {
    timeDistribution,
    totalTime,
    tabSwitchCount: filteredHistory.length,
    dateRange: { from: cutoff, to: Date.now() },
  };
}

function setPomodoroState(state) {
  pomodoroState = { ...pomodoroState, ...state };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pomodoro-updated', pomodoroState);
  }
  return pomodoroState;
}

function getPomodoroState() {
  return pomodoroState;
}

module.exports = {
  server,
  expressApp,
  initAppDependencies,
  setGoogleAuthCallback,
  setGitHubAuthCallback,
  getTabHistory,
  getReports,
  setPomodoroState,
  getPomodoroState,
  __testing: {
    processFocusPlanSubmission,
    getBridgeMetadata,
    isAuthorizedBridgeRequest,
    isRegisteredExtensionOrigin,
    getOriginExtensionId,
    resetState() {
      activeFocusTask = null;
      registeredExtensionId = null;
      tabHistory = [];
      pomodoroState = { isRunning: false, isBreak: false, remainingTime: 0, cycleCount: 0 };
      focusPlanManager = null;
      mainWindow = null;
      googleAuthCallback = null;
      githubAuthCallback = null;
    },
  },
};
