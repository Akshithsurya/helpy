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
  parsePlanArguments: parsePlanArgumentsShared,
  breakDownIntoTasks: breakDownIntoTasksShared,
  createPlanConfig: createPlanConfigShared,
} = require('./chrome-extension/shared/plan-command');

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
      error: function () {},
      warn: function () {},
      debug: function () {},
    };

    try {
      this.history = this.historyStore.load();
    } catch {
      this.logger.warn('Failed to load focus plan history, using empty array');
      this.history = [];
    }

    try {
      this.templates = this.templateStore.load();
    } catch {
      this.logger.warn('Failed to load focus plan templates, using empty array');
      this.templates = [];
    }
  }

  // New: Task breakdown method
  breakDownIntoTasks(planConfig, chunkSizeMinutes = 15) {
    return breakDownIntoTasksShared(planConfig, chunkSizeMinutes);
  }

  _saveHistory() {
    try {
      this.historyStore.save(this.history);
    } catch (error) {
      this.logger.error('Failed to save focus plan history', error);
    }
  }

  _saveTemplates() {
    try {
      this.templateStore.save(this.templates);
    } catch (error) {
      this.logger.error('Failed to save focus plan templates', error);
    }
  }

  parsePlanArguments(args = '') {
    return parsePlanArgumentsShared(args);
  }

  createPlanFromCommand(args = '', options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const planConfig = createPlanConfigShared(args, {
      chunkSizeMinutes: normalizedOptions.chunkSizeMinutes || 15,
      source: normalizedOptions.source || 'slash-command',
      createdAt: normalizedOptions.createdAt || new Date().toISOString(),
      nextQueue: normalizedOptions.nextQueue || [],
    });

    return this.createPlan(planConfig);
  }

  createPlan(planConfig) {
    // Break into tasks if not provided
    let tasks = planConfig.tasks;
    if (!tasks || tasks.length === 0) {
      const chunkSize = planConfig.chunkSizeMinutes || 15;
      tasks = this.breakDownIntoTasks(planConfig, chunkSize);
    }

    const plan = normalizeFocusPlan({
      title: planConfig.title || 'Planned session',
      goal: planConfig.goal || '',
      durationMinutes: planConfig.durationMinutes || 30,
      nextQueue: planConfig.nextQueue || [],
      tasks, // Include the broken-down tasks
      source: planConfig.source,
      createdAt: planConfig.createdAt || new Date().toISOString(),
    });

    return plan;
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
      tasks: normalizedPlan.tasks, // Include tasks in history
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
      const dateKey = new Date(entry.completedAt || entry.createdAt).toISOString().split('T')[0];
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
}

module.exports = FocusPlanManager;
