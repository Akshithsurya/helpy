const path = require('path');
const { getDataDirectory } = require('./shared/app-paths');
const {
  normalizeFocusPlan,
  normalizeFocusPlanHistoryEntry,
  normalizeFocusPlanTemplate,
  normalizeFocusPlanHistoryArray,
  normalizeFocusPlanTemplateArray,
  PLAN_EXECUTION_STATUS,
} = require('./shared/schemas');
const { FileStore } = require('./shared/file-store');
const {
  parsePlanArguments,
  breakDownIntoTasks,
  createPlanConfig,
  normalizeAssistantPlanDraft,
  DEFAULT_CHUNK_SIZE_MINUTES,
  normalizeChunkSizeMinutes,
} = require('./chrome-extension/shared/plan-command');

const MAX_HISTORY_ENTRIES = 200;
const MAX_TASKS_PER_ENTRY = 500;
const MAX_TEMPLATES = 200;
const DEBOUNCE_DELAY_MS = 700;

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function inlineDebounce(fn, wait) {
  let timer = null;
  const debounced = function () {
    const args = arguments;
    const ctx = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(ctx, args);
    }, wait);
  };
  debounced.cancel = function () {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  debounced.flush = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn.apply(this, arguments);
    }
  };
  return debounced;
}

class FocusPlanManager {
  constructor(options = {}) {
    const dataDir = options.dataDir || getDataDirectory();
    this.historyStore = new FileStore(
      path.join(dataDir, 'focus-plan-history.json'),
      [],
      normalizeFocusPlanHistoryArray
    );
    this.templateStore = new FileStore(
      path.join(dataDir, 'focus-plan-templates.json'),
      [],
      normalizeFocusPlanTemplateArray
    );
    this.logger = options.logger || {
      info: function () {},
      warn: function () {},
      error: function () {},
      debug: function () {},
    };

    try {
      this.history = this.historyStore.load();
    } catch (err) {
      this.logger.warn('Failed to load focus plan history, using empty array', err);
      this.history = [];
    }

    try {
      this.templates = this.templateStore.load();
    } catch (err) {
      this.logger.warn('Failed to load focus plan templates, using empty array', err);
      this.templates = [];
    }

    this._capInMemoryCollections();

    this._saveHistorySync = this._saveHistorySyncReal.bind(this);
    this._saveTemplatesSync = this._saveTemplatesSyncReal.bind(this);
    this._debouncedSaveHistory = inlineDebounce(this._saveHistorySync, DEBOUNCE_DELAY_MS);
    this._debouncedSaveTemplates = inlineDebounce(this._saveTemplatesSync, DEBOUNCE_DELAY_MS);

    this._registerExitHooks();
  }

  _registerExitHooks() {
    try {
      if (typeof process !== 'undefined' && process && typeof process.on === 'function') {
        const doFlush = () => this.flushPending();
        process.on('beforeExit', doFlush);
        process.on('SIGTERM', doFlush);
        process.on('SIGINT', doFlush);
      }
    } catch (_) { /* ignore for browser env */ }
  }

  flushPending() {
    try { this._debouncedSaveHistory.flush(); } catch (_) {}
    try { this._saveHistorySync(); } catch (_) {}
    try { this._debouncedSaveTemplates.flush(); } catch (_) {}
    try { this._saveTemplatesSync(); } catch (_) {}
  }

  _capInMemoryCollections() {
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history = this.history.slice(0, MAX_HISTORY_ENTRIES);
    }
    for (let i = 0; i < this.history.length; i++) {
      const entry = this.history[i];
      if (entry.tasks && entry.tasks.length > MAX_TASKS_PER_ENTRY) {
        entry.tasks = entry.tasks.slice(0, MAX_TASKS_PER_ENTRY);
      }
    }
    if (this.templates.length > MAX_TEMPLATES) {
      this.templates = this.templates.slice(0, MAX_TEMPLATES);
    }
  }

  _saveHistorySyncReal() {
    try {
      this.historyStore.save(this.history);
    } catch (err) {
      this.logger.error('Failed to save focus plan history', err);
      throw new Error('Failed to persist focus plan history');
    }
  }

  _saveTemplatesSyncReal() {
    try {
      this.templateStore.save(this.templates);
    } catch (err) {
      this.logger.error('Failed to save focus plan templates', err);
      throw new Error('Failed to persist focus plan templates');
    }
  }

  _saveHistory() {
    this._capInMemoryCollections();
    this._debouncedSaveHistory();
  }

  _saveTemplates() {
    this._capInMemoryCollections();
    this._debouncedSaveTemplates();
  }

  _withTemplateAliases(template) {
    if (!template) {
      return null;
    }

    return {
      ...template,
      title: template.defaultTitle,
      goal: template.defaultGoal,
      durationMinutes: template.defaultDurationMinutes,
    };
  }

  _normalizeTemplateInput(templateData = {}, fallback = {}) {
    const payload = templateData && typeof templateData === 'object' ? templateData : {};

    return {
      ...fallback,
      ...payload,
      id: payload.id || fallback.id,
      name: payload.name || fallback.name || 'Untitled Template',
      description:
        payload.description !== undefined ? payload.description : fallback.description || '',
      defaultTitle:
        payload.defaultTitle !== undefined
          ? payload.defaultTitle
          : payload.title !== undefined
            ? payload.title
            : fallback.defaultTitle !== undefined
              ? fallback.defaultTitle
              : fallback.title,
      defaultGoal:
        payload.defaultGoal !== undefined
          ? payload.defaultGoal
          : payload.goal !== undefined
            ? payload.goal
            : fallback.defaultGoal !== undefined
              ? fallback.defaultGoal
              : fallback.goal,
      defaultDurationMinutes:
        payload.defaultDurationMinutes !== undefined
          ? payload.defaultDurationMinutes
          : payload.durationMinutes !== undefined
            ? payload.durationMinutes
            : fallback.defaultDurationMinutes !== undefined
              ? fallback.defaultDurationMinutes
              : fallback.durationMinutes,
      tags: Array.isArray(payload.tags) ? payload.tags : fallback.tags || [],
      isBuiltIn: payload.isBuiltIn !== undefined ? payload.isBuiltIn : Boolean(fallback.isBuiltIn),
      createdAt: payload.createdAt || fallback.createdAt,
      updatedAt: payload.updatedAt || fallback.updatedAt,
      usageCount: payload.usageCount !== undefined ? payload.usageCount : fallback.usageCount || 0,
    };
  }

  breakDownIntoTasks(planConfig, chunkSizeMinutes = DEFAULT_CHUNK_SIZE_MINUTES) {
    return breakDownIntoTasks(
      planConfig,
      normalizeChunkSizeMinutes(chunkSizeMinutes, DEFAULT_CHUNK_SIZE_MINUTES)
    );
  }

  parsePlanArguments(args = '') {
    return parsePlanArguments(args);
  }

  createPlanFromCommand(args = '', options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const planConfig = createPlanConfig(args, {
      chunkSizeMinutes: normalizeChunkSizeMinutes(
        normalizedOptions.chunkSizeMinutes,
        DEFAULT_CHUNK_SIZE_MINUTES
      ),
      source: normalizedOptions.source || 'slash-command',
      createdAt: normalizedOptions.createdAt || new Date().toISOString(),
      nextQueue: normalizedOptions.nextQueue || [],
      title: normalizedOptions.title,
      goal: normalizedOptions.goal,
      durationMinutes: normalizedOptions.durationMinutes,
    });

    return this.createPlan(planConfig);
  }

  createPlan(planConfig) {
    const normalizedConfig = planConfig && typeof planConfig === 'object' ? planConfig : {};

    let tasks = normalizedConfig.tasks;
    if (!tasks || tasks.length === 0) {
      const chunkSize = normalizeChunkSizeMinutes(
        normalizedConfig.chunkSizeMinutes,
        DEFAULT_CHUNK_SIZE_MINUTES
      );
      tasks = this.breakDownIntoTasks(normalizedConfig, chunkSize);
    }

    const plan = normalizeFocusPlan({
      title: normalizedConfig.title || 'Planned session',
      goal: normalizedConfig.goal || '',
      durationMinutes: normalizedConfig.durationMinutes || 30,
      nextQueue: normalizedConfig.nextQueue || [],
      tasks,
      source: normalizedConfig.source,
      createdAt: normalizedConfig.createdAt || new Date().toISOString(),
    });

    if (!plan) {
      throw new Error('Invalid focus plan configuration');
    }

    return plan;
  }

  createPlanFromAssistantDraft(planDraft, options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const normalizedDraft = normalizeAssistantPlanDraft(planDraft || {}, {
      source: normalizedOptions.source || 'plan-assistant',
      createdAt: normalizedOptions.createdAt || new Date().toISOString(),
    });
    return this.createPlan(normalizedDraft);
  }

  addToHistory(plan, metadata = {}) {
    const normalizedPlan = this.createPlan(plan || {});
    const historyEntry = normalizeFocusPlanHistoryEntry({
      planId:
        typeof metadata.planId === 'string' && metadata.planId.trim()
          ? metadata.planId.trim()
          : Date.now().toString(36) + Math.random().toString(36).slice(2),
      title: normalizedPlan.title,
      goal: normalizedPlan.goal,
      durationMinutes: normalizedPlan.durationMinutes,
      tasks: normalizedPlan.tasks,
      actualDurationMinutes: metadata.actualDurationMinutes,
      status: Object.values(PLAN_EXECUTION_STATUS).includes(metadata.status)
        ? metadata.status
        : PLAN_EXECUTION_STATUS.IN_PROGRESS,
      source:
        typeof metadata.source === 'string' && metadata.source.trim()
          ? metadata.source.trim()
          : normalizedPlan.source,
      createdAt:
        typeof metadata.createdAt === 'string' ? metadata.createdAt : normalizedPlan.createdAt,
      completedAt: typeof metadata.completedAt === 'string' ? metadata.completedAt : null,
      taskId: metadata.taskId,
      taskTitle:
        typeof metadata.taskTitle === 'string' && metadata.taskTitle.trim()
          ? metadata.taskTitle.trim()
          : normalizedPlan.title,
    });

    if (!historyEntry) {
      throw new Error('Invalid focus plan history entry');
    }

    this.history.unshift(historyEntry);
    this.history = normalizeFocusPlanHistoryArray(this.history);
    this._saveHistory();

    return historyEntry;
  }

  getHistory(limit = 50) {
    const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 50);
    return normalizeFocusPlanHistoryArray(this.history).slice(0, normalizedLimit);
  }

  clearHistory() {
    this.history = [];
    this._saveHistory();
  }

  getTemplates() {
    return normalizeFocusPlanTemplateArray(this.templates).map((template) =>
      this._withTemplateAliases(template)
    );
  }

  createTemplate(templateData) {
    const now = new Date().toISOString();
    const template = normalizeFocusPlanTemplate(
      this._normalizeTemplateInput(templateData, {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        name: 'Untitled Template',
        defaultTitle: 'Planned session',
        defaultGoal: '',
        defaultDurationMinutes: 30,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
      })
    );

    if (!template) {
      throw new Error('Invalid focus plan template');
    }

    this.templates.unshift(template);
    this.templates = normalizeFocusPlanTemplateArray(this.templates);
    this._saveTemplates();

    return this._withTemplateAliases(template);
  }

  updateTemplate(templateId, updates) {
    const index = this.templates.findIndex(function (t) {
      return t.id === templateId;
    });
    if (index === -1) return null;

    const existingTemplate = this.templates[index];
    const updatedTemplate = normalizeFocusPlanTemplate(
      this._normalizeTemplateInput(updates, {
        ...existingTemplate,
        id: templateId,
        createdAt: existingTemplate.createdAt,
        updatedAt: new Date().toISOString(),
      })
    );

    if (!updatedTemplate) {
      throw new Error('Invalid focus plan template update');
    }

    this.templates[index] = updatedTemplate;
    this._saveTemplates();

    return this._withTemplateAliases(this.templates[index]);
  }

  deleteTemplate(templateId) {
    const initialLength = this.templates.length;
    this.templates = this.templates.filter(function (t) {
      return t.id !== templateId;
    });
    if (this.templates.length < initialLength) {
      this._saveTemplates();
      return true;
    }
    return false;
  }

  getStatistics(days = 30) {
    const normalizedDays = Math.max(1, Number.parseInt(days, 10) || 30);
    const cutoffTime = Date.now() - normalizedDays * 24 * 60 * 60 * 1000;
    const filteredHistory = normalizeFocusPlanHistoryArray(this.history).filter(function (entry) {
      const referenceTime = Date.parse(entry.completedAt || entry.createdAt || '');
      return Number.isFinite(referenceTime) && referenceTime >= cutoffTime;
    });

    let totalMinutes = 0;
    const dailyStats = {};

    filteredHistory.forEach(function (entry) {
      totalMinutes += entry.durationMinutes;
      const dateKey = localDateKey(entry.completedAt || entry.createdAt);
      if (!dateKey) return;
      if (!dailyStats[dateKey]) {
        dailyStats[dateKey] = { count: 0, minutes: 0 };
      }
      dailyStats[dateKey].count += 1;
      dailyStats[dateKey].minutes += entry.durationMinutes;
    });

    const averageDuration =
      filteredHistory.length > 0 ? Math.round(totalMinutes / filteredHistory.length) : 0;

    return {
      totalPlans: filteredHistory.length,
      totalMinutes: totalMinutes,
      averageDuration: averageDuration,
      dailyStats: dailyStats,
      timePeriod: normalizedDays + ' days',
    };
  }
}

module.exports = FocusPlanManager;
