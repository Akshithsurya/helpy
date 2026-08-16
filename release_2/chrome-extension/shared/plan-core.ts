import { Task, FocusPlan, PlanPreset } from '../../src/types';
import { loadPlanPresets, getPlanPresetByName } from '../../src/utils/yaml-loader';

export const MIN_PLAN_DURATION_MINUTES = 5;
export const MAX_PLAN_DURATION_MINUTES = 240;
export const DEFAULT_PLAN_DURATION_MINUTES = 30;
export const DEFAULT_CHUNK_SIZE_MINUTES = 15;
export const DEFAULT_BREAK_MINUTES = 5;

export const DEFAULT_PRESETS: Record<string, { title: string; duration: number; goal: string }> = {
  work: { title: 'Work Session', duration: 60, goal: 'Focus on work tasks' },
  study: { title: 'Study Session', duration: 45, goal: 'Focus on studying' },
  focus: { title: 'Deep Focus', duration: 25, goal: 'Deep focus session' },
  'focus session': { title: 'Deep Focus', duration: 25, goal: 'Deep focus session' },
  code: { title: 'Coding Session', duration: 90, goal: 'Write code and solve problems' },
  design: { title: 'Design Session', duration: 60, goal: 'Create and refine designs' },
  write: { title: 'Writing Session', duration: 45, goal: 'Write articles, docs, or content' },
  read: { title: 'Reading Session', duration: 30, goal: 'Read and learn new things' },
  exercise: { title: 'Exercise Session', duration: 45, goal: 'Physical activity or workout' },
  meditate: { title: 'Meditation Session', duration: 15, goal: 'Practice mindfulness and meditation' },
  clean: { title: 'Cleaning Session', duration: 30, goal: 'Clean and organize space' },
  review: { title: 'Review Session', duration: 45, goal: 'Review work or materials' },
  plan: { title: 'Planning Session', duration: 30, goal: 'Plan and organize tasks' },
  sprint: { title: 'Quick Focus Sprint', duration: 25, goal: 'Short, focused burst of work' },
  blitz: { title: 'Task Blitz', duration: 15, goal: 'Knock out small tasks quickly' },
  micro: { title: 'Micro Focus', duration: 10, goal: 'Ultra-short focus session' },
  deep: { title: 'Deep Dive', duration: 45, goal: 'Extended focused work' },
  'quick task': { title: 'Quick Task Blitz', duration: 10, goal: 'Tackle one small task' },
};

export enum PLAN_ERROR_CODES {
  INVALID_ARGS = 'INVALID_ARGS',
  DURATION_OUT_OF_RANGE = 'DURATION_OUT_OF_RANGE',
  CYCLE_DEPENDENCY = 'CYCLE_DEPENDENCY',
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  SHARE_EXPIRED = 'SHARE_EXPIRED',
  CACHE_ERROR = 'CACHE_ERROR',
}

export class PlanError extends Error {
  code: PLAN_ERROR_CODES;
  details?: Record<string, unknown>;
  constructor(code: PLAN_ERROR_CODES, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PlanError';
    this.code = code;
    this.details = details;
  }
}

export interface ParsedPlanArgs {
  title: string;
  goal: string;
  durationMinutes: number;
  usedPreset: string | null;
  chunkSizeMinutes?: number;
  breakMinutes?: number;
  tags?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ParseDiagnostics {
  result: ParsedPlanArgs;
  errors: PlanError[];
  warnings: string[];
  diagnostics: Array<{ field: string; message: string; level: 'info' | 'warn' | 'error' }>;
}

let cachedPresets: PlanPreset[] | null = null;

let performanceMetrics: Array<{
  commandName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
}> = [];

export function getDefaultPresets(): Record<string, { title: string; duration: number; goal: string }> {
  return { ...DEFAULT_PRESETS };
}

export function normalizeBoundedMinutes(
  value: unknown,
  fallback: number,
  min: number = MIN_PLAN_DURATION_MINUTES,
  max: number = MAX_PLAN_DURATION_MINUTES
): number {
  const parsedValue = Number.parseInt(value as string, 10);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(min, Math.min(max, parsedValue));
}

export function normalizeChunkSizeMinutes(value: unknown, fallback: number = DEFAULT_CHUNK_SIZE_MINUTES): number {
  return normalizeBoundedMinutes(value, fallback, MIN_PLAN_DURATION_MINUTES, 60);
}

export function normalizeBoundedInt(
  value: unknown,
  fallback: number,
  min: number = MIN_PLAN_DURATION_MINUTES,
  max: number = MAX_PLAN_DURATION_MINUTES
): number {
  return normalizeBoundedMinutes(value, fallback, min, max);
}

export function removeEmojis(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  const emojiRegex = /[\u{1F000}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu;
  return text.replace(emojiRegex, '').replace(/\s+/g, ' ').trim();
}

export function validateInput(input: string, maxLength: number = 100): string {
  if (typeof input !== 'string') return '';
  let sanitized = removeEmojis(input.trim());
  sanitized = sanitized.replace(/[<>]/g, '');
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

export function validatePlanInput(title: string, goal: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!title || title.trim().length === 0) warnings.push('Plan title is empty');
  if (title.length > 100) errors.push('Plan title is too long (max 100 characters)');
  if (goal.length > 500) errors.push('Plan goal is too long (max 500 characters)');
  return { valid: errors.length === 0, errors, warnings };
}

export function generateId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function cyrb53(str: string, seed: number = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(36);
}

export function didYouMean(input: string, candidates: string[]): string | null {
  if (!input || candidates.length === 0) return null;
  const lower = input.toLowerCase();
  let best: { word: string; dist: number } | null = null;
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d === 0) return c;
    if (!best || d < best.dist) best = { word: c, dist: d };
  }
  if (best && best.dist <= Math.max(2, Math.floor(input.length / 3))) return best.word;
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function _perfMark(name: string, phase: 'start' | 'end') {
  try {
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`plan:${name}:${phase}`);
    }
  } catch { /* ignore */ }
}

// A2: 锚定正则
const HOURS_MINUTES = /^(?<hours>\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(?<mins>\d*)\s*(?:m(?:in(?:utes?)?)?)?\b\s*/i;
const BARE_MINUTES = /^(?<mins>\d+(?:\.\d+)?)\s*(?:m(?:in(?:utes?)?)?)?\b\s*/i;

function _matchDuration(str: string): [number, number] | null {
  let m = str.match(HOURS_MINUTES);
  if (m && m.groups) {
    const hours = parseFloat(m.groups.hours || '0');
    const mins = parseInt(m.groups.mins || '0', 10);
    return [hours * 60 + mins, m[0].length];
  }
  m = str.match(BARE_MINUTES);
  if (m && m.groups) {
    return [parseFloat(m.groups.mins || '0'), m[0].length];
  }
  return null;
}

export function parsePlanArguments(args: string = ''): ParsedPlanArgs {
  _perfMark('parsePlanArguments', 'start');
  try {
    const normalizedArgs = typeof args === 'string' ? args : '';
    let remainingArgs = normalizedArgs.trim();
    let title = 'Planned session';
    let durationMinutes = DEFAULT_PLAN_DURATION_MINUTES;
    let goal = '';
    let usedPreset: string | null = null;
    let chunkSizeMinutes: number | undefined = undefined;
    let breakMinutes: number | undefined = undefined;
    let tags: string[] = [];

    const flagPatterns = [
      { regex: /--goal\s+("([^"]+)"|'([^']+)'|(\S+))/i, name: 'goal' },
      { regex: /--chunk(?:\s+|=)(\d+)/i, name: 'chunk' },
      { regex: /--break(?:\s+|=)(\d+)/i, name: 'break' },
      { regex: /--tags\s+("([^"]+)"|'([^']+)'|(\S+))/i, name: 'tags' }
    ];

    flagPatterns.forEach(flag => {
      const match = remainingArgs.match(flag.regex);
      if (match) {
        if (flag.name === 'goal') goal = (match[2] || match[3] || match[4] || '').trim();
        else if (flag.name === 'chunk') chunkSizeMinutes = Number.parseInt(match[1], 10);
        else if (flag.name === 'break') breakMinutes = Number.parseInt(match[1], 10);
        else if (flag.name === 'tags') {
          const tagsStr = (match[2] || match[3] || match[4] || '').trim();
          tags = tagsStr.split(',').map(t => t.trim()).filter(t => t);
        }
        remainingArgs = remainingArgs.replace(match[0], '').trim();
      }
    });

    const presets = loadPresets();
    const presetMap = new Map<string, PlanPreset>();
    presets.forEach(preset => presetMap.set(preset.name.toLowerCase(), preset));

    let parts = remainingArgs ? remainingArgs.split(/\s+/) : [];
    if (remainingArgs) {
      const lowerTrimmedArgs = remainingArgs.toLowerCase();
      const defaultPresets = getDefaultPresets();
      const allPresets = new Map<string, { title: string; durationMinutes: number; goal: string; chunkSizeMinutes?: number }>();
      Object.keys(defaultPresets).forEach(name => {
        const p = defaultPresets[name];
        allPresets.set(name.toLowerCase(), { title: p.title, durationMinutes: p.duration, goal: p.goal });
      });
      presets.forEach(preset => allPresets.set(preset.name.toLowerCase(), preset));
      const presetNames = Array.from(allPresets.keys()).sort((a, b) => b.length - a.length);
      const matchedPresetName = presetNames.find(name =>
        lowerTrimmedArgs === name || lowerTrimmedArgs.startsWith(`${name} `)
      );
      if (matchedPresetName) {
        const preset = allPresets.get(matchedPresetName)!;
        title = preset.title;
        durationMinutes = preset.durationMinutes;
        if (!goal) goal = preset.goal;
        usedPreset = matchedPresetName;
        if (preset.chunkSizeMinutes && !chunkSizeMinutes) chunkSizeMinutes = preset.chunkSizeMinutes;
        const afterPresetArgs = remainingArgs.slice(matchedPresetName.length).trim();
        parts = afterPresetArgs ? afterPresetArgs.split(/\s+/) : [];
      }
    }

    if (parts.length > 0) {
      const partsStr = parts.join(' ');
      const dm = _matchDuration(partsStr);
      if (dm !== null && dm[0] > 0) {
        const customTitle = partsStr.slice(dm[1]).trim();
        durationMinutes = dm[0];
        if (customTitle) title = customTitle;
      } else {
        title = partsStr;
      }
    }

    durationMinutes = normalizeBoundedMinutes(
      durationMinutes,
      DEFAULT_PLAN_DURATION_MINUTES,
      MIN_PLAN_DURATION_MINUTES,
      MAX_PLAN_DURATION_MINUTES
    );

    return { title, goal, durationMinutes, usedPreset, chunkSizeMinutes, breakMinutes, tags };
  } catch (error) {
    console.error('Error in parsePlanArguments:', error);
    return {
      title: 'Planned session', goal: '',
      durationMinutes: DEFAULT_PLAN_DURATION_MINUTES, usedPreset: null,
      chunkSizeMinutes: undefined, breakMinutes: undefined, tags: []
    };
  } finally {
    _perfMark('parsePlanArguments', 'end');
  }
}

export function parseWithDiagnostics(args: string = ''): ParseDiagnostics {
  const errors: PlanError[] = [];
  const warnings: string[] = [];
  const diagnostics: ParseDiagnostics['diagnostics'] = [];
  const result = parsePlanArguments(args);

  if (result.durationMinutes < MIN_PLAN_DURATION_MINUTES || result.durationMinutes > MAX_PLAN_DURATION_MINUTES) {
    errors.push(new PlanError(PLAN_ERROR_CODES.DURATION_OUT_OF_RANGE,
      `Duration out of range: ${result.durationMinutes}`));
    diagnostics.push({ field: 'durationMinutes', message: 'Duration clamped', level: 'warn' });
  }
  if (!result.title) {
    warnings.push('Empty title, using default');
    diagnostics.push({ field: 'title', message: 'Using default title', level: 'info' });
  }
  const vi = validatePlanInput(result.title, result.goal);
  vi.errors.forEach(e => {
    errors.push(new PlanError(PLAN_ERROR_CODES.INVALID_ARGS, e));
    diagnostics.push({ field: 'input', message: e, level: 'error' });
  });
  vi.warnings.forEach(w => {
    warnings.push(w);
    diagnostics.push({ field: 'input', message: w, level: 'warn' });
  });

  return { result, errors, warnings, diagnostics };
}

export function loadPresets(): PlanPreset[] {
  if (cachedPresets === null) {
    cachedPresets = loadPlanPresets() || [];
  }
  return cachedPresets;
}

export function listPresets(): PlanPreset[] {
  return [...loadPresets()];
}

export function findPresetByName(name: string): PlanPreset | undefined {
  const presets = loadPresets();
  const lowerName = name.toLowerCase();
  return presets.find(p => p.name.toLowerCase() === lowerName) || getPlanPresetByName(name);
}

// A3: 休息任务不扣 remainingDuration，仅在末尾显示
export function breakDownIntoTasks(
  planConfig: Partial<FocusPlan> = {},
  chunkSizeMinutes: number = DEFAULT_CHUNK_SIZE_MINUTES,
  breakMinutes: number = DEFAULT_BREAK_MINUTES,
  includeBreaks: boolean = false
): Task[] {
  _perfMark('breakDownIntoTasks', 'start');
  try {
    const totalDuration = normalizeBoundedMinutes(
      planConfig.durationMinutes,
      DEFAULT_PLAN_DURATION_MINUTES,
      MIN_PLAN_DURATION_MINUTES,
      MAX_PLAN_DURATION_MINUTES
    );
    const normalizedChunkSizeMinutes = normalizeChunkSizeMinutes(chunkSizeMinutes);
    const goal = planConfig.goal || planConfig.title || '';
    const workTasks: Task[] = [];
    const breakTasks: Task[] = [];
    let remainingDuration = totalDuration;
    let chunkIndex = 0;
    const taskIdSeed = Date.now();

    const taskDescriptors: string[] = [
      'Start strong', 'Keep going', 'Making progress', 'Almost there', 'Final push',
    ];

    while (remainingDuration > 0) {
      const chunkDuration = Math.min(normalizedChunkSizeMinutes, remainingDuration);
      const descriptorIndex = chunkIndex < taskDescriptors.length ? chunkIndex : taskDescriptors.length - 1;
      const taskTitle = goal
        ? `${taskDescriptors[descriptorIndex]}: ${goal}`
        : `${taskDescriptors[descriptorIndex]} - Part ${chunkIndex + 1}`;

      workTasks.push({
        id: `task-${taskIdSeed}-${chunkIndex}`,
        title: taskTitle,
        durationMinutes: chunkDuration,
        completed: false,
        completedAt: null,
        isBreak: false
      });
      remainingDuration -= chunkDuration;

      if (includeBreaks && remainingDuration > 0) {
        breakTasks.push({
          id: `task-${taskIdSeed}-break-${chunkIndex}`,
          title: 'Break',
          durationMinutes: breakMinutes,
          completed: false,
          completedAt: null,
          isBreak: true
        });
      }
      chunkIndex++;
    }
    return [...workTasks, ...breakTasks];
  } finally {
    _perfMark('breakDownIntoTasks', 'end');
  }
}

export function recordPerformance(commandName: string, startTime: number, success: boolean, errorType?: string): void {
  const endTime = Date.now();
  performanceMetrics.push({
    commandName, startTime, endTime,
    durationMs: endTime - startTime, success, errorType
  });
  if (performanceMetrics.length > 1000) {
    performanceMetrics = performanceMetrics.slice(-1000);
  }
}

export function getPerformanceMetrics() {
  return [...performanceMetrics];
}

export function getAverageResponseTime(): number {
  if (performanceMetrics.length === 0) return 0;
  const totalMs = performanceMetrics.reduce((sum, m) => sum + (m.endTime - m.startTime), 0);
  return totalMs / performanceMetrics.length;
}

export function getErrorRate(): number {
  if (performanceMetrics.length === 0) return 0;
  const errorCount = performanceMetrics.filter(m => !m.success).length;
  return errorCount / performanceMetrics.length;
}
