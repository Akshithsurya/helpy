'use strict';

// ==========================================
// 1. Constants & Enums
// ==========================================

const DATA_TRACKING_TYPES = {
  USER_BEHAVIOR: 'user_behavior',
  PROCESS_NODE: 'process_node',
  PERFORMANCE: 'performance',
  CUSTOM: 'custom',
};

const PLAN_EXECUTION_STATUS = {
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  INTERRUPTED: 'interrupted',
  IN_PROGRESS: 'in_progress',
};

const HABIT_FREQUENCY = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  CUSTOM: 'custom',
};

const HABIT_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
};

const NOTIFICATION_TYPE = {
  REMINDER: 'reminder',
  TASK: 'task',
  HABIT: 'habit',
  FOCUS: 'focus',
  SYSTEM: 'system',
  ACHIEVEMENT: 'achievement',
};

const NOTIFICATION_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
};

const NOTIFICATION_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  DISMISSED: 'dismissed',
  READ: 'read',
};

// ==========================================
// 2. Core Utility Helpers
// ==========================================

const isPlainObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

const ensureString = (val, maxLen = Infinity, fallback = '') =>
  typeof val === 'string' ? val.slice(0, maxLen) : fallback;

const ensureTrimmedString = (val, maxLen = Infinity, fallback = '') =>
  typeof val === 'string' ? val.trim().slice(0, maxLen) : fallback;

const ensureBoolean = (val, fallback = false) => (typeof val === 'boolean' ? val : fallback);

const ensureNumber = (val, fallback = 0) => (Number.isFinite(Number(val)) ? Number(val) : fallback);

const ensureBoundedNumber = (val, min, max, fallback = undefined) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

const ensureEnum = (val, enumObj, fallback) =>
  Object.values(enumObj).includes(val) ? val : fallback;

const ensureArray = (val, mapFn, maxItems = Infinity) =>
  Array.isArray(val) ? val.map(mapFn).filter(Boolean).slice(0, maxItems) : [];

const ensureISODate = (val, fallback = new Date().toISOString()) =>
  typeof val === 'string' ? val : fallback;

const normalizeStringArray = (value, maxItems = 50, maxLength = 255) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
};

// ==========================================
// 3. Sanitizers & Validators
// ==========================================

function sanitizeBridgeToken(value) {
  return ensureTrimmedString(value, 256, '');
}

function sanitizeDisplayName(value) {
  return ensureTrimmedString(value, 40, '').replace(/\s+/g, ' ');
}

function sanitizeEmail(email) {
  return ensureString(email, 255, '').toLowerCase().trim();
}

function sanitizePassword(password) {
  return ensureString(password, Infinity, '').trim();
}

function sanitizeDailySummaryTime(value, fallback = '18:00') {
  const trimmed = ensureTrimmedString(value);
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return fallback;

  const [hours, minutes] = trimmed.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function validateEmail(email) {
  if (typeof email !== 'string') return { valid: false, error: 'Email must be a string' };
  const cleanEmail = sanitizeEmail(email);
  if (!cleanEmail) return { valid: false, error: 'Email is required' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
    return { valid: false, error: 'Please enter a valid email address' };
  return { valid: true };
}

function validatePassword(password) {
  if (typeof password !== 'string') return { valid: false, error: 'Password must be a string' };
  const cleanPassword = sanitizePassword(password);
  if (!cleanPassword) return { valid: false, error: 'Password is required' };
  if (cleanPassword.length < 6)
    return { valid: false, error: 'Password must be at least 6 characters long' };
  return { valid: true };
}

// ==========================================
// 4. Schema Normalizers
// ==========================================

function normalizeTrackedTab(tab = {}) {
  if (!isPlainObject(tab)) return null;
  const url = ensureString(tab.url, 2000);
  if (!url) return null;

  return {
    id: Number.isInteger(tab.id) ? tab.id : null,
    title: ensureString(tab.title, 300, 'Untitled'),
    url,
    active: ensureBoolean(tab.active),
    isInactive: ensureBoolean(tab.isInactive),
    inactiveTime: ensureNumber(tab.inactiveTime, 0),
  };
}

function normalizeHistoryEntry(entry = {}) {
  if (!isPlainObject(entry)) return null;
  const url = ensureString(entry.url, 2000);
  const startTime = Number(entry.startTime);

  if (!url || !Number.isFinite(startTime) || startTime <= 0) return null;

  return {
    tabId: Number.isInteger(entry.tabId) ? entry.tabId : null,
    url,
    title: ensureString(entry.title, 300, 'Untitled'),
    domain: entry.domain ? ensureString(entry.domain, 255, null) : null,
    startTime,
    endTime: entry.endTime === undefined ? null : Number(entry.endTime),
    duration: entry.duration === undefined ? null : Number(entry.duration),
  };
}

function normalizeAppHistoryEntry(entry = {}) {
  if (!isPlainObject(entry)) return null;
  const appName = ensureTrimmedString(entry.appName, 255);
  const startTime = Number(entry.startTime);

  if (!appName || !Number.isFinite(startTime) || startTime <= 0) return null;

  return {
    appName,
    windowTitle: ensureTrimmedString(entry.windowTitle, 300, 'Untitled'),
    startTime,
    endTime: entry.endTime === undefined ? null : Number(entry.endTime),
    duration: entry.duration === undefined ? null : Number(entry.duration),
  };
}

function normalizeFocusHistoryEntry(entry = {}) {
  if (!isPlainObject(entry)) return null;
  const startTime = Number(entry.startTime);
  if (!Number.isFinite(startTime) || startTime <= 0) return null;

  return {
    startTime,
    endTime: entry.endTime === undefined ? null : Number(entry.endTime),
    duration: entry.duration === undefined ? null : Number(entry.duration),
    isBreak: ensureBoolean(entry.isBreak),
    goal: ensureString(entry.goal, 500),
    taskId: Number.isFinite(Number(entry.taskId)) ? Number(entry.taskId) : null,
    taskTitle: ensureString(entry.taskTitle, 100),
  };
}

function normalizeSettingsImport(value = {}) {
  if (!isPlainObject(value)) return {};

  return {
    inactivityMinutes: ensureBoundedNumber(value.inactivityMinutes, 1, 1440),
    notificationIntervalMinutes: ensureBoundedNumber(value.notificationIntervalMinutes, 1, 1440),
    isPaused: ensureBoolean(value.isPaused, undefined),
    displayName: ensureTrimmedString(value.displayName, 40, ''),
    ttsEnabled: ensureBoolean(value.ttsEnabled, undefined),
    ttsVoice: ensureTrimmedString(value.ttsVoice, 120, ''),
    ttsRate: ensureBoundedNumber(value.ttsRate, 0.5, 2),
    ttsVolume: ensureBoundedNumber(value.ttsVolume, 0, 100),
    bridgeToken: sanitizeBridgeToken(value.bridgeToken),
    distractionBlockLevel: ensureTrimmedString(value.distractionBlockLevel, 20, undefined),
    blockedDomains: normalizeStringArray(value.blockedDomains, 100, 255),
    allowedDomains: normalizeStringArray(value.allowedDomains, 100, 255),
    allowTemporaryBypass: ensureBoolean(value.allowTemporaryBypass, undefined),
    bypassDurationMinutes: ensureBoundedNumber(value.bypassDurationMinutes, 1, 120),
    requireBypassReason: ensureBoolean(value.requireBypassReason, undefined),
    showRecoveryPromptAfterBypass: ensureBoolean(value.showRecoveryPromptAfterBypass, undefined),
  };
}

function normalizeExtensionSettingsPayload(value = {}) {
  const imported = normalizeSettingsImport(value);
  return {
    displayName: imported.displayName || '',
    inactivityMinutes: imported.inactivityMinutes,
    notificationIntervalMinutes: imported.notificationIntervalMinutes,
    isPaused: imported.isPaused,
    ttsEnabled: imported.ttsEnabled,
    ttsVoice: imported.ttsVoice || '',
    ttsRate: imported.ttsRate,
    ttsVolume: imported.ttsVolume,
    bridgeToken: imported.bridgeToken || '',
  };
}

function normalizeTask(task = {}, index = 0) {
  if (!isPlainObject(task)) return null;
  const idValue = Number(task.id);
  const title = ensureTrimmedString(task.title, 100, '');

  if (!Number.isFinite(idValue) || !title) return null;

  return {
    id: idValue,
    title,
    description: ensureString(task.description, 500),
    dueDate: ensureString(task.dueDate, Infinity, undefined),
    completed: ensureBoolean(task.completed),
    completedAt: ensureString(task.completedAt, Infinity, undefined),
    archived: ensureBoolean(task.archived),
    createdAt: ensureISODate(task.createdAt),
    timerDuration: task.timerDuration == null ? null : Math.max(0, Number(task.timerDuration) || 0),
    priority: ensureEnum(task.priority, { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' }, 'medium'),
    tags: Array.isArray(task.tags)
      ? task.tags.filter((tag) => typeof tag === 'string').slice(0, 20)
      : [],
    order: ensureNumber(task.order, index),
    timerState: isPlainObject(task.timerState) ? task.timerState : null,
    isDaily: ensureBoolean(task.isDaily),
    streak: Math.max(0, ensureNumber(task.streak, 0)),
    lastCompletedDate: ensureString(task.lastCompletedDate, Infinity, null),
    lane: ensureEnum(task.lane, { CURRENT: 'current', NEXT: 'next', LATER: 'later' }, 'later'),
    focusGoal: ensureString(task.focusGoal, 500),
    estimatedMinutes: Math.max(0, ensureNumber(task.estimatedMinutes, 0)),
    estimatedSessions: Math.max(0, ensureNumber(task.estimatedSessions, 0)),
    lastFocusedAt: ensureString(task.lastFocusedAt, Infinity, null),
    actualFocusMs: Math.max(0, ensureNumber(task.actualFocusMs, 0)),
    interruptionCount: Math.max(0, ensureNumber(task.interruptionCount, 0)),
    resumeNote: ensureString(task.resumeNote, 500),
    completedFocusSessions: Math.max(0, ensureNumber(task.completedFocusSessions, 0)),
  };
}

function normalizeFocusPlanTask(task, index) {
  if (!isPlainObject(task)) return null;
  return {
    id: ensureString(task.id, 64, `task-${Date.now()}-${index}`),
    title: ensureTrimmedString(task.title, 100, `Task ${index + 1}`),
    durationMinutes: ensureBoundedNumber(task.durationMinutes, 5, 60, 15),
    completed: ensureBoolean(task.completed, false),
    completedAt: ensureString(task.completedAt, Infinity, null),
  };
}

function normalizeFocusPlan(plan = {}) {
  if (!isPlainObject(plan)) return null;
  const title = ensureTrimmedString(plan.title, 100, '');
  if (!title) return null;

  return {
    title,
    goal: ensureString(plan.goal, 500),
    durationMinutes: ensureBoundedNumber(plan.durationMinutes, 5, 240, 25),
    nextQueue: normalizeStringArray(plan.nextQueue, 5, 100),
    tasks: ensureArray(plan.tasks, normalizeFocusPlanTask),
    blockerPreset: ensureTrimmedString(plan.blockerPreset, 20, 'soft'),
    reminderIntensity: ensureTrimmedString(plan.reminderIntensity, 20, 'medium'),
    source: ensureTrimmedString(plan.source, 30, 'unknown'),
    createdAt: ensureISODate(plan.createdAt),
  };
}

function normalizeActiveFocusSession(value = {}) {
  if (!isPlainObject(value)) return null;
  const durationMs = Number(value.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  const blockerState = isPlainObject(value.blockerState)
    ? {
        level: ensureString(value.blockerState.level, 20, 'off'),
        active: ensureBoolean(value.blockerState.active),
        bypassUntil:
          value.blockerState.bypassUntil == null
            ? null
            : Number(value.blockerState.bypassUntil) || null,
      }
    : { level: 'off', active: false, bypassUntil: null };

  return {
    mode: value.mode === 'break' ? 'break' : 'focus',
    status: ensureEnum(
      value.status,
      { IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', COMPLETED: 'completed' },
      'idle'
    ),
    durationMs,
    startedAt: value.startedAt === null ? null : Number(value.startedAt),
    endAt: value.endAt === null ? null : Number(value.endAt),
    pausedAt: value.pausedAt === null ? null : Number(value.pausedAt),
    remainingMs: Number.isFinite(Number(value.remainingMs))
      ? Math.max(0, Number(value.remainingMs))
      : durationMs,
    totalPausedMs: Math.max(0, ensureNumber(value.totalPausedMs, 0)),
    sessionCount: Math.max(0, ensureNumber(value.sessionCount, 0)),
    taskId: value.taskId == null ? null : Number(value.taskId),
    taskTitle: ensureString(value.taskTitle, 100),
    goal: ensureString(value.goal, 500),
    blockerState,
    interruptionNotes: normalizeStringArray(value.interruptionNotes, 20, 500),
    updatedAt: ensureISODate(value.updatedAt),
  };
}

function normalizeTag(tag = {}, index = 0) {
  if (!isPlainObject(tag)) return null;
  const name = ensureTrimmedString(tag.name, 40, '');
  if (!name) return null;

  return {
    id: ensureTrimmedString(tag.id, 64, `tag-${index + 1}`),
    name,
    color: ensureString(tag.color, 20, '#6366f1'),
  };
}

function normalizeTrackingItem(item = {}) {
  if (!isPlainObject(item)) return null;
  return {
    id: ensureString(item.id, Infinity, Date.now().toString()),
    name: ensureString(item.name, 100, 'Untitled'),
    type: ensureEnum(item.type, DATA_TRACKING_TYPES, DATA_TRACKING_TYPES.CUSTOM),
    enabled: ensureBoolean(item.enabled, true),
    config: isPlainObject(item.config) ? item.config : {},
  };
}

function normalizeTrackingRecord(record = {}) {
  if (!isPlainObject(record)) return null;
  return {
    trackingItemId: ensureString(record.trackingItemId, Infinity, ''),
    timestamp: ensureNumber(record.timestamp, Date.now()),
    value: record.value !== undefined ? record.value : null,
    metadata: isPlainObject(record.metadata) ? record.metadata : {},
  };
}

function getDefaultPrivacySettings() {
  return { shareUsageData: false, collectAnalytics: true, allowPersonalization: true };
}

function normalizePrivacySettings(settings = {}) {
  if (!isPlainObject(settings)) return getDefaultPrivacySettings();
  return {
    shareUsageData: ensureBoolean(settings.shareUsageData, false),
    collectAnalytics: ensureBoolean(settings.collectAnalytics, true),
    allowPersonalization: ensureBoolean(settings.allowPersonalization, true),
  };
}

function getDefaultUserProfile() {
  return {
    displayName: '',
    email: '',
    avatar: '',
    bio: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: 'en',
    privacySettings: getDefaultPrivacySettings(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeUserProfile(profile = {}) {
  if (!isPlainObject(profile)) return getDefaultUserProfile();
  return {
    displayName: sanitizeDisplayName(profile.displayName),
    email: ensureString(profile.email, 255, '').trim(),
    avatar: ensureString(profile.avatar, 2000),
    bio: ensureString(profile.bio, 500),
    timezone: ensureString(profile.timezone, 50, Intl.DateTimeFormat().resolvedOptions().timeZone),
    language: ensureString(profile.language, 10, 'en'),
    privacySettings: normalizePrivacySettings(profile.privacySettings),
    createdAt: ensureISODate(profile.createdAt),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeUser(user = {}) {
  if (!isPlainObject(user)) return null;
  return {
    id: ensureString(user.id, Infinity, String(user.id || Date.now())),
    email: sanitizeEmail(user.email),
    passwordHash: ensureString(user.passwordHash),
    displayName: sanitizeDisplayName(user.displayName || ''),
    createdAt: ensureISODate(user.createdAt),
    updatedAt: new Date().toISOString(),
    isEmailVerified: ensureBoolean(user.isEmailVerified, false),
    provider: ensureString(user.provider, Infinity, 'local'),
  };
}

function normalizeAuthToken(token = {}) {
  if (!isPlainObject(token)) return null;
  return {
    token: ensureString(token.token),
    expiresAt: ensureNumber(token.expiresAt, 0),
    type: ensureString(token.type, Infinity, 'jwt'),
  };
}

function normalizeFocusPlanHistoryEntry(entry = {}) {
  if (!isPlainObject(entry)) return null;
  const title = ensureTrimmedString(entry.title, 100, '');
  if (!title) return null;

  return {
    planId: ensureString(entry.planId, Infinity, String(Date.now())),
    title,
    goal: ensureString(entry.goal, 500),
    durationMinutes: ensureBoundedNumber(entry.durationMinutes, 5, 240, 25),
    actualDurationMinutes:
      entry.actualDurationMinutes == null
        ? null
        : Math.max(0, ensureNumber(entry.actualDurationMinutes, null)),
    status: ensureEnum(entry.status, PLAN_EXECUTION_STATUS, PLAN_EXECUTION_STATUS.COMPLETED),
    source: ensureTrimmedString(entry.source, 30, 'unknown'),
    createdAt: ensureISODate(entry.createdAt),
    completedAt: ensureString(entry.completedAt, Infinity, null),
    taskId:
      entry.taskId == null
        ? null
        : Number.isFinite(Number(entry.taskId))
          ? Number(entry.taskId)
          : null,
    taskTitle: ensureString(entry.taskTitle, 100),
    tasks: ensureArray(entry.tasks, normalizeFocusPlanTask),
  };
}

function normalizeFocusPlanTemplate(template = {}, index = 0) {
  if (!isPlainObject(template)) return null;
  const name = ensureTrimmedString(template.name, 50, '');
  if (!name) return null;

  return {
    id: ensureTrimmedString(template.id, 64, `template-${index + 1}`),
    name,
    description: ensureString(template.description, 200),
    defaultTitle: ensureTrimmedString(template.defaultTitle, 100, name),
    defaultGoal: ensureString(template.defaultGoal, 500),
    defaultDurationMinutes: ensureBoundedNumber(template.defaultDurationMinutes, 5, 240, 25),
    tags: normalizeStringArray(template.tags, 20, 50),
    isBuiltIn: ensureBoolean(template.isBuiltIn),
    createdAt: ensureISODate(template.createdAt),
    updatedAt: ensureISODate(template.updatedAt),
    usageCount: Math.max(0, ensureNumber(template.usageCount, 0)),
  };
}

function normalizeHabit(habit = {}, index = 0) {
  if (!isPlainObject(habit)) return null;
  const name = ensureTrimmedString(habit.name, 100, 'New Habit');
  if (!name) return null;

  return {
    id: ensureString(habit.id, Infinity, `habit-${Date.now()}-${index}`),
    name,
    description: ensureString(habit.description, 500),
    frequency: ensureEnum(habit.frequency, HABIT_FREQUENCY, HABIT_FREQUENCY.DAILY),
    targetDays: Array.isArray(habit.targetDays) ? habit.targetDays : [0, 1, 2, 3, 4, 5, 6],
    targetCount: ensureBoundedNumber(habit.targetCount, 1, 100, 1),
    color: ensureString(habit.color, 20, '#6366f1'),
    icon: ensureString(habit.icon, 50, 'star'),
    reminderTime: ensureString(habit.reminderTime, Infinity, null),
    reminderEnabled: ensureBoolean(habit.reminderEnabled),
    streak: Math.max(0, ensureNumber(habit.streak, 0)),
    bestStreak: Math.max(0, ensureNumber(habit.bestStreak, 0)),
    totalCompletions: Math.max(0, ensureNumber(habit.totalCompletions, 0)),
    createdAt: ensureISODate(habit.createdAt),
    updatedAt: ensureISODate(habit.updatedAt),
    status: ensureEnum(habit.status, HABIT_STATUS, HABIT_STATUS.ACTIVE),
    tags: normalizeStringArray(habit.tags, 20, 50),
    notes: ensureString(habit.notes, 500),
  };
}

function getDefaultNotificationSettings() {
  return {
    enabled: true,
    soundEnabled: true,
    doNotDisturb: false,
    doNotDisturbStart: '22:00',
    doNotDisturbEnd: '08:00',
    maxNotificationsPerDay: 50,
    notificationDuration: 5000,
    reminderAdvanceMinutes: 5,
  };
}

function normalizeNotificationSettings(settings = {}) {
  if (!isPlainObject(settings)) return getDefaultNotificationSettings();
  return {
    enabled: ensureBoolean(settings.enabled, true),
    soundEnabled: ensureBoolean(settings.soundEnabled, true),
    doNotDisturb: ensureBoolean(settings.doNotDisturb, false),
    doNotDisturbStart: ensureString(settings.doNotDisturbStart, Infinity, '22:00'),
    doNotDisturbEnd: ensureString(settings.doNotDisturbEnd, Infinity, '08:00'),
    maxNotificationsPerDay: ensureBoundedNumber(settings.maxNotificationsPerDay, 1, 200, 50),
    notificationDuration: ensureBoundedNumber(settings.notificationDuration, 1000, 30000, 5000),
    reminderAdvanceMinutes: ensureBoundedNumber(settings.reminderAdvanceMinutes, 0, 1440, 5),
  };
}

function normalizeNotification(notification = {}, index = 0) {
  if (!isPlainObject(notification)) return null;
  return {
    id: ensureString(notification.id, Infinity, `notif-${Date.now()}-${index}`),
    type: ensureEnum(notification.type, NOTIFICATION_TYPE, NOTIFICATION_TYPE.REMINDER),
    title: ensureString(notification.title, 200, 'Notification'),
    body: ensureString(notification.body, 1000),
    priority: ensureEnum(
      notification.priority,
      NOTIFICATION_PRIORITY,
      NOTIFICATION_PRIORITY.MEDIUM
    ),
    status: ensureEnum(notification.status, NOTIFICATION_STATUS, NOTIFICATION_STATUS.PENDING),
    scheduledAt: ensureISODate(notification.scheduledAt),
    sentAt: ensureString(notification.sentAt, Infinity, null),
    readAt: ensureString(notification.readAt, Infinity, null),
    dismissedAt: ensureString(notification.dismissedAt, Infinity, null),
    data: isPlainObject(notification.data) ? notification.data : {},
    actionUrl: ensureString(notification.actionUrl, 2000, null),
    repeat: ensureString(notification.repeat, 50, null),
    repeatInterval: notification.repeatInterval ? Number(notification.repeatInterval) : null,
    createdAt: ensureISODate(notification.createdAt),
  };
}

// ==========================================
// 5. Module Exports
// ==========================================

module.exports = {
  // Core Utilities
  normalizeStringArray,
  sanitizeBridgeToken,
  sanitizeDisplayName,
  sanitizeDailySummaryTime,
  sanitizeEmail,
  sanitizePassword,
  validateEmail,
  validatePassword,

  // Settings & Extensions
  normalizeSettingsImport,
  normalizeExtensionSettingsPayload,

  // Tracking & History
  normalizeTrackedTab,
  normalizeHistoryEntry,
  normalizeHistoryArray: (val) => ensureArray(val, normalizeHistoryEntry),
  normalizeAppHistoryEntry,
  normalizeAppHistoryArray: (val) => ensureArray(val, normalizeAppHistoryEntry),
  normalizeFocusHistoryEntry,
  normalizeFocusHistoryArray: (val) => ensureArray(val, normalizeFocusHistoryEntry),

  // Tasks & Tags
  normalizeTask,
  normalizeTaskArray: (val) => ensureArray(val, normalizeTask),
  normalizeTag,
  normalizeTagArray: (val) => ensureArray(val, normalizeTag),

  // Focus Plans & Sessions
  normalizeFocusPlan,
  normalizeActiveFocusSession,
  PLAN_EXECUTION_STATUS,
  normalizeFocusPlanHistoryEntry,
  normalizeFocusPlanHistoryArray: (val) => ensureArray(val, normalizeFocusPlanHistoryEntry),
  normalizeFocusPlanTemplate,
  normalizeFocusPlanTemplateArray: (val) => ensureArray(val, normalizeFocusPlanTemplate),

  // Data Tracking
  DATA_TRACKING_TYPES,
  normalizeTrackingItem,
  normalizeTrackingItemArray: (val) => ensureArray(val, normalizeTrackingItem),
  normalizeTrackingRecord,
  normalizeTrackingRecordArray: (val) => ensureArray(val, normalizeTrackingRecord),

  // User & Auth
  normalizeUserProfile,
  getDefaultUserProfile,
  normalizePrivacySettings,
  getDefaultPrivacySettings,
  normalizeUser,
  normalizeAuthToken,

  // Habits
  HABIT_FREQUENCY,
  HABIT_STATUS,
  normalizeHabit,
  normalizeHabitArray: (val) => ensureArray(val, normalizeHabit),

  // Notifications
  NOTIFICATION_TYPE,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_STATUS,
  normalizeNotification,
  normalizeNotificationArray: (val) => ensureArray(val, normalizeNotification),
  normalizeNotificationSettings,
  getDefaultNotificationSettings,
};
