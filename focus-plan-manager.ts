import * as path from 'path';
import { getDataDirectory } from './shared/app-paths';
import { FileStore } from './shared/file-store';
import {
  parsePlanArguments,
  breakDownIntoTasks,
  createPlanConfig,
  DEFAULT_CHUNK_SIZE_MINUTES,
  normalizeChunkSizeMinutes,
} from './chrome-extension/shared/plan-command';
import {
  Task,
  FocusPlan,
  PlanHistoryEntry,
  PlanTemplate,
} from './src/types';
import { debounce } from './src/utils/performance';

const PLAN_EXECUTION_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PAUSED: 'paused',
};

const MAX_HISTORY_ENTRIES = 200;
const MAX_TASKS_PER_ENTRY = 500;
const MAX_TEMPLATES = 200;
const DEBOUNCE_DELAY_MS = 700;

interface FocusPlanManagerOptions {
  dataDir?: string;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}

class FocusPlanManager {
  private readonly historyStore: FileStore<PlanHistoryEntry[]>;
  private readonly templateStore: FileStore<PlanTemplate[]>;
  private readonly logger: Logger;
  public history: PlanHistoryEntry[];
  public templates: PlanTemplate[];
  private _debouncedSaveHistory: ReturnType<typeof debounce>;
  private _debouncedSaveTemplates: ReturnType<typeof debounce>;

  constructor(options: FocusPlanManagerOptions = {}) {
    const dataDir = options.dataDir || getDataDirectory();
    this.historyStore = new FileStore(
      path.join(dataDir, 'focus-plan-history.json'),
      [] as PlanHistoryEntry[]
    );
    this.templateStore = new FileStore(
      path.join(dataDir, 'focus-plan-templates.json'),
      [] as PlanTemplate[]
    );
    this.logger = {
      info: options.logger?.info || (() => {}),
      warn: options.logger?.warn || (() => {}),
      error: options.logger?.error || (() => {}),
      debug: options.logger?.debug || (() => {}),
    };

    try {
      this.history = this.historyStore.load();
    } catch (error) {
      this.logger.warn('Failed to load focus plan history, using empty array', error);
      this.history = [];
    }

    try {
      this.templates = this.templateStore.load();
    } catch (error) {
      this.logger.warn('Failed to load focus plan templates, using empty array', error);
      this.templates = [];
    }

    this._capInMemoryCollections();

    this._debouncedSaveHistory = debounce(
      this._saveHistorySync.bind(this),
      DEBOUNCE_DELAY_MS
    );
    this._debouncedSaveTemplates = debounce(
      this._saveTemplatesSync.bind(this),
      DEBOUNCE_DELAY_MS
    );

    this._registerExitHooks();
  }

  private _registerExitHooks(): void {
    try {
      if (typeof process !== 'undefined' && process && typeof (process as NodeJS.Process).on === 'function') {
        const doFlush = () => this.flushPending();
        (process as NodeJS.Process).on('beforeExit', doFlush);
        (process as NodeJS.Process).on('SIGTERM', doFlush);
        (process as NodeJS.Process).on('SIGINT', doFlush);
      }
    } catch (_) { /* ignore for browser env */ }
  }

  public flushPending(): void {
    try { (this._debouncedSaveHistory as { flush: () => void }).flush(); } catch (_) {}
    try { this._saveHistorySync(); } catch (_) {}
    try { (this._debouncedSaveTemplates as { flush: () => void }).flush(); } catch (_) {}
    try { this._saveTemplatesSync(); } catch (_) {}
  }

  private _capInMemoryCollections(): void {
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history = this.history.slice(0, MAX_HISTORY_ENTRIES);
    }
    for (const entry of this.history) {
      if (entry.tasks && entry.tasks.length > MAX_TASKS_PER_ENTRY) {
        entry.tasks = entry.tasks.slice(0, MAX_TASKS_PER_ENTRY);
      }
    }
    if (this.templates.length > MAX_TEMPLATES) {
      this.templates = this.templates.slice(0, MAX_TEMPLATES);
    }
  }

  private _saveHistorySync(): void {
    try {
      this.historyStore.save(this.history);
    } catch (error) {
      this.logger.error('Failed to save focus plan history', error);
      throw new Error('Failed to persist focus plan history');
    }
  }

  private _saveTemplatesSync(): void {
    try {
      this.templateStore.save(this.templates);
    } catch (error) {
      this.logger.error('Failed to save focus plan templates', error);
      throw new Error('Failed to persist focus plan templates');
    }
  }

  private _saveHistory(): void {
    this._capInMemoryCollections();
    this._debouncedSaveHistory();
  }

  private _saveTemplates(): void {
    this._capInMemoryCollections();
    this._debouncedSaveTemplates();
  }

  private _withTemplateAliases(template: PlanTemplate | null): (PlanTemplate & { title: string; goal: string; durationMinutes: number }) | null {
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

  private _normalizeTemplateInput(
    templateData: Partial<PlanTemplate> = {},
    fallback: Partial<PlanTemplate> = {}
  ): PlanTemplate {
    const payload = templateData && typeof templateData === 'object' ? templateData : {};
    const now = new Date().toISOString();
    return {
      ...fallback,
      ...payload,
      id: payload.id || fallback.id || Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: payload.name || fallback.name || 'Untitled Template',
      description: payload.description !== undefined ? payload.description : fallback.description || '',
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
      createdAt: payload.createdAt || fallback.createdAt || now,
      updatedAt: now,
      usageCount: payload.usageCount !== undefined ? payload.usageCount : fallback.usageCount || 0,
    } as PlanTemplate;
  }

  public breakDownIntoTasks(
    planConfig: Partial<FocusPlan> = {},
    chunkSizeMinutes: number = DEFAULT_CHUNK_SIZE_MINUTES
  ): Task[] {
    return breakDownIntoTasks(
      planConfig,
      normalizeChunkSizeMinutes(chunkSizeMinutes, DEFAULT_CHUNK_SIZE_MINUTES),
      0,
      false
    ).filter(task => !task.isBreak);
  }

  public parsePlanArguments(args: string = ''): ReturnType<typeof parsePlanArguments> {
    return parsePlanArguments(args);
  }

  public createPlanFromCommand(
    args: string = '',
    options: Parameters<typeof createPlanConfig>[1] = {}
  ): FocusPlan {
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

  public createPlan(planConfig: Partial<FocusPlan> = {}): FocusPlan {
    const normalizedConfig = planConfig && typeof planConfig === 'object' ? planConfig : {};

    let tasks = normalizedConfig.tasks;
    if (!tasks || tasks.length === 0) {
      const chunkSize = normalizeChunkSizeMinutes(
        normalizedConfig.chunkSizeMinutes,
        DEFAULT_CHUNK_SIZE_MINUTES
      );
      tasks = this.breakDownIntoTasks(normalizedConfig, chunkSize);
    }

    const plan: FocusPlan = {
      title: normalizedConfig.title || 'Planned session',
      goal: normalizedConfig.goal || '',
      durationMinutes: normalizedConfig.durationMinutes || 30,
      nextQueue: normalizedConfig.nextQueue || [],
      tasks,
      source: normalizedConfig.source,
      createdAt: normalizedConfig.createdAt || new Date().toISOString(),
    };

    return plan;
  }

  public addToHistory(
    plan: Partial<FocusPlan> = {},
    metadata: Partial<PlanHistoryEntry> = {}
  ): PlanHistoryEntry {
    const normalizedPlan = this.createPlan(plan || {});
    const historyEntry: PlanHistoryEntry = {
      planId:
        typeof metadata.planId === 'string' && metadata.planId.trim()
          ? metadata.planId.trim()
          : Date.now().toString(36) + Math.random().toString(36).slice(2),
      title: normalizedPlan.title,
      goal: normalizedPlan.goal,
      durationMinutes: normalizedPlan.durationMinutes,
      tasks: normalizedPlan.tasks,
      actualDurationMinutes: metadata.actualDurationMinutes,
      status: Object.values(PLAN_EXECUTION_STATUS).includes(metadata.status as string)
        ? metadata.status as string
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
    };

    this.history.unshift(historyEntry);
    this._saveHistory();
    return historyEntry;
  }

  public getHistory(limit: number = 50): PlanHistoryEntry[] {
    const normalizedLimit = Math.max(1, Number.parseInt(limit as unknown as string, 10) || 50);
    return this.history.slice(0, normalizedLimit);
  }

  public clearHistory(): void {
    this.history = [];
    this._saveHistory();
  }

  public getTemplates(): (PlanTemplate & { title: string; goal: string; durationMinutes: number })[] {
    return this.templates.map(template => this._withTemplateAliases(template)!);
  }

  public createTemplate(templateData: Partial<PlanTemplate> = {}): (PlanTemplate & { title: string; goal: string; durationMinutes: number }) {
    const template = this._normalizeTemplateInput(templateData);
    this.templates.unshift(template);
    this._saveTemplates();
    return this._withTemplateAliases(template)!;
  }

  public updateTemplate(
    templateId: string,
    updates: Partial<PlanTemplate> = {}
  ): (PlanTemplate & { title: string; goal: string; durationMinutes: number }) | null {
    const index = this.templates.findIndex(t => t.id === templateId);
    if (index === -1) return null;

    const existingTemplate = this.templates[index];
    const updatedTemplate = this._normalizeTemplateInput(updates, {
      ...existingTemplate,
      id: templateId,
      createdAt: existingTemplate.createdAt,
    });

    this.templates[index] = updatedTemplate;
    this._saveTemplates();
    return this._withTemplateAliases(this.templates[index])!;
  }

  public deleteTemplate(templateId: string): boolean {
    const initialLength = this.templates.length;
    this.templates = this.templates.filter(t => t.id !== templateId);
    if (this.templates.length < initialLength) {
      this._saveTemplates();
      return true;
    }
    return false;
  }

  public getStatistics(days: number = 30): {
    totalPlans: number;
    totalMinutes: number;
    averageDuration: number;
    dailyStats: Record<string, { count: number; minutes: number }>;
    timePeriod: string;
  } {
    const normalizedDays = Math.max(1, Number.parseInt(days as unknown as string, 10) || 30);
    const cutoffTime = Date.now() - normalizedDays * 24 * 60 * 60 * 1000;
    const filteredHistory = this.history.filter(entry => {
      const referenceTime = Date.parse(entry.completedAt || entry.createdAt || '');
      return Number.isFinite(referenceTime) && referenceTime >= cutoffTime;
    });

    let totalMinutes = 0;
    const dailyStats: Record<string, { count: number; minutes: number }> = {};

    filteredHistory.forEach(entry => {
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
      totalMinutes,
      averageDuration,
      dailyStats,
      timePeriod: `${normalizedDays} days`,
    };
  }
}

export = FocusPlanManager;
