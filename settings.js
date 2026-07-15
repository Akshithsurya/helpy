const crypto = require('crypto');
const { sanitizeDisplayName } = require('./personalization');
const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');
const {
  sanitizeBridgeToken,
  sanitizeDailySummaryTime,
  normalizeUserProfile,
  getDefaultUserProfile,
} = require('./shared/schemas');

/** @type {string} Path to settings file */
const SETTINGS_FILE = getDataFilePath('settings.json');

/**
 * Default settings object
 * @type {Object}
 */
const DEFAULT_SETTINGS = {
  displayName: '',
  theme: 'light',
  accentColor: 'burgundy',
  motionLevel: 'none',
  highContrast: false,
  uiScale: 100,
  contrastLevel: 100,
  focusModeEnabled: false,
  focusSessionDuration: 25,
  breakDuration: 5,
  longBreakDuration: 15,
  sessionsBeforeLongBreak: 4,
  ambientSound: null,
  ambientSoundVolume: 50,
  taskSortOrder: 'priority',
  autoArchiveCompleted: false,
  autoArchiveDays: 7,
  reminderIntensity: 'low',
  autoStart: false,
  dailySummaryEnabled: true,
  dailySummaryTime: '18:00',
  ttsEnabled: false,
  ttsVoice: '',
  ttsRate: 1,
  ttsVolume: 80,
  defaultTab: 'welcome',
  recommendationStyle: 'supportive',
  showRecommendations: true,
  bridgeToken: '',
  // 神经多样性相关设置
  showTutorials: true,
  soundEnabled: false,
  vibrationEnabled: false,
  colorTheme: 'default', // default, low-saturation, monochrome, high-contrast
  hiddenTabs: [],
  tabOrder: ['welcome', 'focus', 'tasks', 'tabs', 'settings'],
  reminderDelay: 5,
  reminderRepeat: 3,
  showProgressIndicator: true,
  simplifyUI: true,
  distractionBlockLevel: 'soft',
  blockedDomains: ['youtube.com', 'reddit.com', 'twitter.com', 'x.com', 'facebook.com'],
  allowedDomains: [],
  allowTemporaryBypass: true,
  bypassDurationMinutes: 10,
  requireBypassReason: false,
  showRecoveryPromptAfterBypass: true,
  maxNextTasks: 3,
  autoPromoteNextTask: true,
  focusHeartbeatMinutes: 5,
  // 用户个人资料
  userProfile: getDefaultUserProfile(),
  // 数据追踪设置
  dataTrackingEnabled: true,
};

/** @type {string[]} Valid accent colors */
const ACCENT_COLORS = ['burgundy', 'sepia', 'olive', 'gold', 'rust'];

/** @type {string[]} Valid themes */
const THEMES = ['light', 'dark'];

/** @type {string[]} Valid motion levels */
const MOTION_LEVELS = ['none', 'low', 'normal'];

/** @type {string[]} Valid ambient sounds */
const AMBIENT_SOUNDS = ['rain', 'white-noise', 'cafe', 'forest', 'ocean'];

/** @type {string[]} Valid reminder intensities */
const REMINDER_INTENSITIES = ['low', 'medium', 'high'];

/** @type {string[]} Valid task sort orders */
const TASK_SORT_ORDERS = ['priority', 'due-date', 'creation-date', 'custom'];

/** @type {string[]} Valid default startup tabs */
const DEFAULT_TABS = ['welcome', 'focus', 'tasks', 'tabs', 'settings'];

/** @type {string[]} Valid recommendation tone styles */
const RECOMMENDATION_STYLES = ['calm', 'direct', 'supportive'];

/** @type {string[]} Valid color themes */
const COLOR_THEMES = ['default', 'low-saturation', 'monochrome', 'high-contrast'];

/** @type {string[]} Valid distraction block levels */
const DISTRACTION_BLOCK_LEVELS = ['off', 'soft', 'hard'];

/**
 * Sanitizes a theme
 * @param {*} value - Value to sanitize
 * @returns {string} Valid theme
 */
function sanitizeTheme(value) {
  if (!THEMES.includes(value)) {
    return DEFAULT_SETTINGS.theme;
  }
  return value;
}

/**
 * Sanitizes an accent color
 * @param {*} value - Value to sanitize
 * @returns {string} Valid accent color
 */
function sanitizeAccentColor(value) {
  if (!ACCENT_COLORS.includes(value)) {
    return DEFAULT_SETTINGS.accentColor;
  }
  return value;
}

/**
 * Sanitizes a motion level
 * @param {*} value - Value to sanitize
 * @returns {string} Valid motion level
 */
function sanitizeMotionLevel(value) {
  if (!MOTION_LEVELS.includes(value)) {
    return DEFAULT_SETTINGS.motionLevel;
  }
  return value;
}

/**
 * Sanitizes a boolean value
 * @param {*} value - Value to sanitize
 * @param {boolean} defaultValue - Default value
 * @returns {boolean} Sanitized boolean
 */
function sanitizeBoolean(value, defaultValue) {
  if (typeof value !== 'boolean') {
    return defaultValue;
  }
  return value;
}

/**
 * Sanitizes a numeric value
 * @param {*} value - Value to sanitize
 * @param {number} defaultValue - Default value
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Sanitized number
 */
function sanitizeNumber(value, defaultValue, min, max) {
  const num = Number(value);
  if (isNaN(num)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitizes an ambient sound
 * @param {*} value - Value to sanitize
 * @returns {string|null} Valid ambient sound or null
 */
function sanitizeAmbientSound(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!AMBIENT_SOUNDS.includes(value)) {
    return null;
  }
  return value;
}

/**
 * Sanitizes a reminder intensity
 * @param {*} value - Value to sanitize
 * @returns {string} Valid reminder intensity
 */
function sanitizeReminderIntensity(value) {
  if (!REMINDER_INTENSITIES.includes(value)) {
    return DEFAULT_SETTINGS.reminderIntensity;
  }
  return value;
}

/**
 * Sanitizes a task sort order
 * @param {*} value - Value to sanitize
 * @returns {string} Valid task sort order
 */
function sanitizeTaskSortOrder(value) {
  if (!TASK_SORT_ORDERS.includes(value)) {
    return DEFAULT_SETTINGS.taskSortOrder;
  }
  return value;
}

/**
 * Sanitizes a default tab selection
 * @param {*} value - Value to sanitize
 * @returns {string} Valid tab id
 */
function sanitizeDefaultTab(value) {
  if (!DEFAULT_TABS.includes(value)) {
    return DEFAULT_SETTINGS.defaultTab;
  }
  return value;
}

/**
 * Sanitizes a recommendation tone/style
 * @param {*} value - Value to sanitize
 * @returns {string} Valid recommendation style
 */
function sanitizeRecommendationStyle(value) {
  if (!RECOMMENDATION_STYLES.includes(value)) {
    return DEFAULT_SETTINGS.recommendationStyle;
  }
  return value;
}

/**
 * Sanitizes a color theme
 * @param {*} value - Value to sanitize
 * @returns {string} Valid color theme
 */
function sanitizeColorTheme(value) {
  if (!COLOR_THEMES.includes(value)) {
    return DEFAULT_SETTINGS.colorTheme;
  }
  return value;
}

function sanitizeDistractionBlockLevel(value) {
  if (!DISTRACTION_BLOCK_LEVELS.includes(value)) {
    return DEFAULT_SETTINGS.distractionBlockLevel;
  }
  return value;
}

function sanitizeDomainList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
}

/**
 * Sanitizes hidden tabs array
 * @param {*} value - Value to sanitize
 * @returns {Array<string>} Valid hidden tabs
 */
function sanitizeHiddenTabs(value) {
  if (!Array.isArray(value)) {
    return DEFAULT_SETTINGS.hiddenTabs;
  }
  return value.filter((tab) => DEFAULT_TABS.includes(tab));
}

/**
 * Sanitizes tab order array
 * @param {*} value - Value to sanitize
 * @returns {Array<string>} Valid tab order
 */
function sanitizeTabOrder(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SETTINGS.tabOrder];
  }
  // Ensure all tabs are valid and unique
  const seen = new Set();
  const order = value.filter((tab) => {
    if (DEFAULT_TABS.includes(tab) && !seen.has(tab)) {
      seen.add(tab);
      return true;
    }
    return false;
  });
  // Add any missing default tabs
  DEFAULT_TABS.forEach((tab) => {
    if (!seen.has(tab)) {
      order.push(tab);
    }
  });
  return order;
}

/**
 * Sanitizes a text-to-speech voice identifier
 * @param {*} value - Value to sanitize
 * @returns {string} Sanitized voice identifier
 */
function sanitizeTtsVoice(value) {
  if (typeof value !== 'string') {
    return DEFAULT_SETTINGS.ttsVoice;
  }

  return value.trim().slice(0, 120);
}

/**
 * Sanitizes a text-to-speech rate
 * @param {*} value - Value to sanitize
 * @returns {number} Valid rate
 */
function sanitizeTtsRate(value) {
  const rate = Number(value);
  if (Number.isNaN(rate)) {
    return DEFAULT_SETTINGS.ttsRate;
  }

  return Math.max(0.5, Math.min(2, Number(rate.toFixed(2))));
}

/**
 * Sanitizes a text-to-speech volume percentage
 * @param {*} value - Value to sanitize
 * @returns {number} Valid volume
 */
function sanitizeTtsVolume(value) {
  return sanitizeNumber(value, DEFAULT_SETTINGS.ttsVolume, 0, 100);
}

function createBridgeToken() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

function ensureBridgeToken(settings) {
  const bridgeToken = sanitizeBridgeToken(settings?.bridgeToken);
  return {
    ...settings,
    bridgeToken: bridgeToken || createBridgeToken(),
  };
}

function normalizeSettings(parsed = {}) {
  return ensureBridgeToken({
    ...DEFAULT_SETTINGS,
    ...parsed,
    displayName: sanitizeDisplayName(parsed?.displayName),
    theme: sanitizeTheme(parsed?.theme),
    accentColor: sanitizeAccentColor(parsed?.accentColor),
    motionLevel: sanitizeMotionLevel(parsed?.motionLevel),
    highContrast: sanitizeBoolean(parsed?.highContrast, DEFAULT_SETTINGS.highContrast),
    uiScale: sanitizeNumber(parsed?.uiScale, DEFAULT_SETTINGS.uiScale, 50, 200),
    contrastLevel: sanitizeNumber(parsed?.contrastLevel, DEFAULT_SETTINGS.contrastLevel, 50, 150),
    focusModeEnabled: sanitizeBoolean(parsed?.focusModeEnabled, DEFAULT_SETTINGS.focusModeEnabled),
    focusSessionDuration: sanitizeNumber(
      parsed?.focusSessionDuration,
      DEFAULT_SETTINGS.focusSessionDuration,
      5,
      120
    ),
    breakDuration: sanitizeNumber(parsed?.breakDuration, DEFAULT_SETTINGS.breakDuration, 1, 60),
    longBreakDuration: sanitizeNumber(
      parsed?.longBreakDuration,
      DEFAULT_SETTINGS.longBreakDuration,
      5,
      60
    ),
    sessionsBeforeLongBreak: sanitizeNumber(
      parsed?.sessionsBeforeLongBreak,
      DEFAULT_SETTINGS.sessionsBeforeLongBreak,
      1,
      10
    ),
    ambientSound: sanitizeAmbientSound(parsed?.ambientSound),
    ambientSoundVolume: sanitizeNumber(
      parsed?.ambientSoundVolume,
      DEFAULT_SETTINGS.ambientSoundVolume,
      0,
      100
    ),
    taskSortOrder: sanitizeTaskSortOrder(parsed?.taskSortOrder),
    autoArchiveCompleted: sanitizeBoolean(
      parsed?.autoArchiveCompleted,
      DEFAULT_SETTINGS.autoArchiveCompleted
    ),
    autoArchiveDays: sanitizeNumber(
      parsed?.autoArchiveDays,
      DEFAULT_SETTINGS.autoArchiveDays,
      1,
      365
    ),
    reminderIntensity: sanitizeReminderIntensity(parsed?.reminderIntensity),
    autoStart: sanitizeBoolean(parsed?.autoStart, DEFAULT_SETTINGS.autoStart),
    dailySummaryEnabled: sanitizeBoolean(
      parsed?.dailySummaryEnabled,
      DEFAULT_SETTINGS.dailySummaryEnabled
    ),
    dailySummaryTime: sanitizeDailySummaryTime(
      parsed?.dailySummaryTime,
      DEFAULT_SETTINGS.dailySummaryTime
    ),
    ttsEnabled: sanitizeBoolean(parsed?.ttsEnabled, DEFAULT_SETTINGS.ttsEnabled),
    ttsVoice: sanitizeTtsVoice(parsed?.ttsVoice),
    ttsRate: sanitizeTtsRate(parsed?.ttsRate),
    ttsVolume: sanitizeTtsVolume(parsed?.ttsVolume),
    defaultTab: sanitizeDefaultTab(parsed?.defaultTab),
    recommendationStyle: sanitizeRecommendationStyle(parsed?.recommendationStyle),
    showRecommendations: sanitizeBoolean(
      parsed?.showRecommendations,
      DEFAULT_SETTINGS.showRecommendations
    ),
    bridgeToken: sanitizeBridgeToken(parsed?.bridgeToken),
    // 神经多样性设置
    showTutorials: sanitizeBoolean(parsed?.showTutorials, DEFAULT_SETTINGS.showTutorials),
    soundEnabled: sanitizeBoolean(parsed?.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    vibrationEnabled: sanitizeBoolean(parsed?.vibrationEnabled, DEFAULT_SETTINGS.vibrationEnabled),
    colorTheme: sanitizeColorTheme(parsed?.colorTheme),
    hiddenTabs: sanitizeHiddenTabs(parsed?.hiddenTabs),
    tabOrder: sanitizeTabOrder(parsed?.tabOrder),
    reminderDelay: sanitizeNumber(parsed?.reminderDelay, DEFAULT_SETTINGS.reminderDelay, 1, 60),
    reminderRepeat: sanitizeNumber(parsed?.reminderRepeat, DEFAULT_SETTINGS.reminderRepeat, 0, 10),
    showProgressIndicator: sanitizeBoolean(
      parsed?.showProgressIndicator,
      DEFAULT_SETTINGS.showProgressIndicator
    ),
    simplifyUI: sanitizeBoolean(parsed?.simplifyUI, DEFAULT_SETTINGS.simplifyUI),
    distractionBlockLevel: sanitizeDistractionBlockLevel(parsed?.distractionBlockLevel),
    blockedDomains: sanitizeDomainList(parsed?.blockedDomains),
    allowedDomains: sanitizeDomainList(parsed?.allowedDomains),
    allowTemporaryBypass: sanitizeBoolean(
      parsed?.allowTemporaryBypass,
      DEFAULT_SETTINGS.allowTemporaryBypass
    ),
    bypassDurationMinutes: sanitizeNumber(
      parsed?.bypassDurationMinutes,
      DEFAULT_SETTINGS.bypassDurationMinutes,
      1,
      120
    ),
    requireBypassReason: sanitizeBoolean(
      parsed?.requireBypassReason,
      DEFAULT_SETTINGS.requireBypassReason
    ),
    showRecoveryPromptAfterBypass: sanitizeBoolean(
      parsed?.showRecoveryPromptAfterBypass,
      DEFAULT_SETTINGS.showRecoveryPromptAfterBypass
    ),
    maxNextTasks: sanitizeNumber(parsed?.maxNextTasks, DEFAULT_SETTINGS.maxNextTasks, 1, 10),
    autoPromoteNextTask: sanitizeBoolean(
      parsed?.autoPromoteNextTask,
      DEFAULT_SETTINGS.autoPromoteNextTask
    ),
    focusHeartbeatMinutes: sanitizeNumber(
      parsed?.focusHeartbeatMinutes,
      DEFAULT_SETTINGS.focusHeartbeatMinutes,
      1,
      60
    ),
    // 用户个人资料和数据追踪设置
    userProfile: normalizeUserProfile(parsed?.userProfile),
    dataTrackingEnabled: sanitizeBoolean(
      parsed?.dataTrackingEnabled,
      DEFAULT_SETTINGS.dataTrackingEnabled
    ),
  });
}

/**
 * Manages application settings
 * @class SettingsManager
 */
class SettingsManager {
  /**
   * Creates a new SettingsManager instance
   */
  constructor() {
    /** @type {Object} Current settings */
    this.settings = this.loadSettings();
  }

  getAuthToken() {
    return this.settings.authToken || null;
  }

  setAuthToken(token) {
    this.settings.authToken = token;
    this.saveSettings();
  }

  clearAuthToken() {
    delete this.settings.authToken;
    this.saveSettings();
  }

  /**
   * Loads settings from file
   * @returns {Object} Settings object
   */
  loadSettings() {
    try {
      return safeReadJson(SETTINGS_FILE, { ...DEFAULT_SETTINGS }, normalizeSettings);
    } catch (error) {
      console.error('Error loading settings:', error);
      return ensureBridgeToken({ ...DEFAULT_SETTINGS });
    }
  }

  /**
   * Saves current settings to file
   */
  saveSettings() {
    try {
      writeJsonAtomic(SETTINGS_FILE, this.settings);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  /**
   * Gets current settings
   * @returns {Object} Copy of current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Updates settings
   * @param {Object} [partialSettings={}] - Partial settings to update
   * @returns {Object} Updated settings
   */
  updateSettings(partialSettings = {}) {
    this.settings = normalizeSettings({
      ...this.settings,
      ...partialSettings,
    });

    this.saveSettings();
    return this.getSettings();
  }

  /**
   * Gets user profile
   * @returns {Object} User profile
   */
  getUserProfile() {
    return { ...this.settings.userProfile };
  }

  /**
   * Updates user profile
   * @param {Object} profileUpdates - Profile updates
   * @returns {Object} Updated profile
   */
  updateUserProfile(profileUpdates = {}) {
    const updatedProfile = normalizeUserProfile({
      ...this.settings.userProfile,
      ...profileUpdates,
    });
    this.settings.userProfile = updatedProfile;
    this.saveSettings();
    return this.getUserProfile();
  }

  /**
   * Masks sensitive data for privacy
   * @param {Object} data - Data to mask
   * @returns {Object} Masked data
   */
  maskSensitiveData(data) {
    if (!data) return data;

    const masked = { ...data };
    if (masked.email) {
      const [local, domain] = masked.email.split('@');
      if (local && domain) {
        masked.email = `${local[0]}***@${domain}`;
      }
    }
    return masked;
  }
}

module.exports = {
  SettingsManager,
  DEFAULT_SETTINGS,
  ACCENT_COLORS,
  THEMES,
  MOTION_LEVELS,
  AMBIENT_SOUNDS,
  REMINDER_INTENSITIES,
  TASK_SORT_ORDERS,
  DEFAULT_TABS,
  RECOMMENDATION_STYLES,
  sanitizeDisplayName,
  sanitizeTheme,
  sanitizeAccentColor,
  sanitizeMotionLevel,
  sanitizeBoolean,
  sanitizeNumber,
  sanitizeAmbientSound,
  sanitizeReminderIntensity,
  sanitizeTaskSortOrder,
  sanitizeDefaultTab,
  sanitizeRecommendationStyle,
  sanitizeDistractionBlockLevel,
  sanitizeTtsVoice,
  sanitizeTtsRate,
  sanitizeTtsVolume,
  sanitizeBridgeToken,
  sanitizeDailySummaryTime,
};
