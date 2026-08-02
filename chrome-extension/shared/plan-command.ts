import { Task, FocusPlan, PlanPreset } from '../../src/types';
import { loadPlanPresets, getPlanPresetByName } from '../../src/utils/yaml-loader';
import { validatePlan, validatePlanArguments } from './plan-validator';
import axiosStatic from 'axios';
import { cyrb53, debounce as makeDebounce } from '../../src/utils/performance';
import { Cache } from '../../src/utils/cache';

const MIN_PLAN_DURATION_MINUTES = 5;
const MAX_PLAN_DURATION_MINUTES = 240;
const DEFAULT_PLAN_DURATION_MINUTES = 30;
const DEFAULT_CHUNK_SIZE_MINUTES = 15;
const DEFAULT_BREAK_MINUTES = 5;

// 6 music focus presets (mirrors PlanParser.php + CoffeeScript MUSIC_PRESETS constant)
const MUSIC_PRESET_METADATA: Record<string, {
  title: string;
  duration: number;
  goal: string;
  musicPreset: string;
  genre: string;
  source: 'local' | 'youtube' | 'spotify' | 'soundcloud' | 'all';
}> = {
  'lofi-focus':     { title: 'Lo-fi Focus Session',      duration: 90,  goal: 'Ambient focus',        musicPreset: 'lofi',      genre: 'ambient',     source: 'all' },
  'classical-study':{ title: 'Classical Study Session',   duration: 60,  goal: 'Deep study',         musicPreset: 'classical', genre: 'classical',   source: 'all' },
  'white-noise':    { title: 'White Noise Session',       duration: 120, goal: 'Noise isolation',    musicPreset: 'noise',     genre: 'noise',       source: 'local' },
  'binaural':       { title: 'Binaural Focus Session',    duration: 45,  goal: 'Binaural focus',     musicPreset: 'binaural',  genre: 'binaural',    source: 'local' },
  'ambient-code':   { title: 'Ambient Coding Session',    duration: 120, goal: 'Flow coding',        musicPreset: 'ambient',   genre: 'electronic',  source: 'all' },
  'energize':       { title: 'Energize Sprint',           duration: 25,  goal: 'Upbeat energy',      musicPreset: 'upbeat',    genre: 'electronic',  source: 'all' },
};

const MUSIC_SOURCE_WHITELIST = Object.freeze([
  'local', 'youtube', 'spotify', 'soundcloud', 'all',
] as const);
type MusicSourceType = typeof MUSIC_SOURCE_WHITELIST[number];

const MUSIC_GENRES_DEFAULT = Object.freeze([
  'ambient', 'classical', 'noise', 'binaural', 'electronic', 'lofi',
  'jazz', 'instrumental', 'soundtrack', 'blues', 'folk', 'rock', 'pop',
]);

const TASK_DESCRIPTORS: readonly string[] = Object.freeze([
  'Start strong', 'Keep going', 'Making progress', 'Almost there', 'Final push',
]);
const EMOJI_REGEX = /[\u{1F000}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu;
let _taskIdCounter = 0;
const _nextTaskId = () => ++_taskIdCounter;

let _mergedPresetsBuilt = false;
let _mergedPresets: Map<string, { title: string; durationMinutes: number; goal: string; chunkSizeMinutes?: number; musicPreset?: string; genre?: string; source?: string }> | null = null;
let _presetNamesSortedByLength: readonly string[] = [];
let _musicPresetMetadataMap: Map<string, typeof MUSIC_PRESET_METADATA[string]> | null = null;
function _ensurePresetsBuilt() {
  if (_mergedPresetsBuilt) return;
  _mergedPresets = new Map();
  Object.keys(DEFAULT_PRESETS).forEach((name) => {
    const p = DEFAULT_PRESETS[name];
    const base: any = { title: p.title, durationMinutes: p.duration, goal: p.goal };
    if (name in MUSIC_PRESET_METADATA) {
      const md = (MUSIC_PRESET_METADATA as any)[name];
      base.musicPreset = md.musicPreset;
      base.genre = md.genre;
      base.source = md.source;
    }
    _mergedPresets!.set(name.toLowerCase(), base);
  });
  const yamlPresets = loadPresets();
  yamlPresets.forEach((p) => {
    const key = p.name.toLowerCase();
    if (!_mergedPresets!.has(key)) {
      _mergedPresets!.set(key, {
        title: p.title, durationMinutes: p.durationMinutes, goal: p.goal, chunkSizeMinutes: (p as any).chunkSizeMinutes,
      });
    }
  });
  _presetNamesSortedByLength = Object.freeze(Array.from(_mergedPresets.keys()).sort((a, b) => b.length - a.length));
  _musicPresetMetadataMap = new Map();
  Object.keys(MUSIC_PRESET_METADATA).forEach((k) =>
    _musicPresetMetadataMap!.set(k, MUSIC_PRESET_METADATA[k as keyof typeof MUSIC_PRESET_METADATA])
  );
  _mergedPresetsBuilt = true;
}

const _parseCache = new Cache<any>(5000, 200);
const _taskBreakdownCache = new Cache<any>(60000, 50);
const _emojiRemoveCache = new Cache<string>(10000, 500);
let _erlangAvailable = true;
let _erlangUnavailableUntil = 0;
function _isErlangAvailable() {
  if (!_erlangAvailable && Date.now() < _erlangUnavailableUntil) return false;
  return true;
}
function _markErlangUnavailable() {
  _erlangAvailable = false;
  _erlangUnavailableUntil = Date.now() + 30000;
}
const _erlangTimeoutMs = 50;

// Compatibility DEFAULT_PRESETS (matches the JS version). Each music preset
// (lofi-focus, classical-study, ...) is also appended so existing allPresets
// matching logic picks them up automatically.
const DEFAULT_PRESETS: Record<string, { title: string; duration: number; goal: string }> = {
  work: { title: 'Work Session', duration: 60, goal: 'Focus on work tasks' },
  study: { title: 'Study Session', duration: 45, goal: 'Focus on studying' },
  focus: { title: 'Deep Focus', duration: 25, goal: 'Deep focus session' },
  'focus session': { title: 'Deep Focus', duration: 25, goal: 'Deep focus session' },
  code: { title: 'Coding Session', duration: 90, goal: 'Write code and solve problems' },
  design: { title: 'Design Session', duration: 60, goal: 'Create and refine designs' },
  write: { title: 'Writing Session', duration: 45, goal: 'Write articles, docs, or content' },
  read: { title: 'Reading Session', duration: 30, goal: 'Read and learn new things' },
  exercise: { title: 'Exercise Session', duration: 45, goal: 'Physical activity or workout' },
  meditate: {
    title: 'Meditation Session',
    duration: 15,
    goal: 'Practice mindfulness and meditation',
  },
  clean: { title: 'Cleaning Session', duration: 30, goal: 'Clean and organize space' },
  review: { title: 'Review Session', duration: 45, goal: 'Review work or materials' },
  plan: { title: 'Planning Session', duration: 30, goal: 'Plan and organize tasks' },
  sprint: { title: 'Quick Focus Sprint', duration: 25, goal: 'Short, focused burst of work' },
  blitz: { title: 'Task Blitz', duration: 15, goal: 'Knock out small tasks quickly' },
  micro: { title: 'Micro Focus', duration: 10, goal: 'Ultra-short focus session' },
  deep: { title: 'Deep Dive', duration: 45, goal: 'Extended focused work' },
  'quick task': { title: 'Quick Task Blitz', duration: 10, goal: 'Tackle one small task' },
  'lofi-focus':      { title: MUSIC_PRESET_METADATA['lofi-focus'].title,      duration: MUSIC_PRESET_METADATA['lofi-focus'].duration,      goal: MUSIC_PRESET_METADATA['lofi-focus'].goal },
  'classical-study': { title: MUSIC_PRESET_METADATA['classical-study'].title, duration: MUSIC_PRESET_METADATA['classical-study'].duration, goal: MUSIC_PRESET_METADATA['classical-study'].goal },
  'white-noise':     { title: MUSIC_PRESET_METADATA['white-noise'].title,     duration: MUSIC_PRESET_METADATA['white-noise'].duration,     goal: MUSIC_PRESET_METADATA['white-noise'].goal },
  'binaural':        { title: MUSIC_PRESET_METADATA['binaural'].title,        duration: MUSIC_PRESET_METADATA['binaural'].duration,        goal: MUSIC_PRESET_METADATA['binaural'].goal },
  'ambient-code':    { title: MUSIC_PRESET_METADATA['ambient-code'].title,    duration: MUSIC_PRESET_METADATA['ambient-code'].duration,    goal: MUSIC_PRESET_METADATA['ambient-code'].goal },
  'energize':        { title: MUSIC_PRESET_METADATA['energize'].title,        duration: MUSIC_PRESET_METADATA['energize'].duration,        goal: MUSIC_PRESET_METADATA['energize'].goal },
};

let cachedPresets: PlanPreset[] | null = null;

// Performance metrics storage
let performanceMetrics: Array<{
  commandName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
}> = [];

function getDefaultPresets(): Record<string, { title: string; duration: number; goal: string }> {
  return { ...DEFAULT_PRESETS };
}

function normalizeBoundedMinutes(
  value: unknown,
  fallback: number,
  min: number = MIN_PLAN_DURATION_MINUTES,
  max: number = MAX_PLAN_DURATION_MINUTES
): number {
  const parsedValue = Number.parseInt(value as string, 10);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsedValue));
}

function normalizeChunkSizeMinutes(value: unknown, fallback: number = DEFAULT_CHUNK_SIZE_MINUTES): number {
  return normalizeBoundedMinutes(value, fallback, MIN_PLAN_DURATION_MINUTES, 60);
}

function normalizeBoundedInt(
  value: unknown,
  fallback: number,
  min: number = MIN_PLAN_DURATION_MINUTES,
  max: number = MAX_PLAN_DURATION_MINUTES
): number {
  return normalizeBoundedMinutes(value, fallback, min, max);
}

interface ParsedPlanArgs {
  title: string;
  goal: string;
  durationMinutes: number;
  usedPreset: string | null;
  chunkSizeMinutes?: number;
  breakMinutes?: number;
  tags?: string[];
  musicPreset?: string | null;
  playlistId?: string | null;
  musicSource?: MusicSourceType | string | null;
  genre?: string | null;
}

// Input validation functions
function removeEmojis(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  const k = 'e:' + cyrb53(text);
  const hit = _emojiRemoveCache.get(k);
  if (hit !== undefined) return hit;
  const out = text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
  _emojiRemoveCache.set(k, out);
  return out;
}

function validateInput(input: string, maxLength: number = 100): string {
  if (typeof input !== 'string') return '';
  let sanitized = removeEmojis(input.trim());
  // Remove potentially dangerous characters
  sanitized = sanitized.replace(/[<>]/g, '');
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validatePlanInput(title: string, goal: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!title || title.trim().length === 0) {
    warnings.push('Plan title is empty');
  }
  if (title.length > 100) {
    errors.push('Plan title is too long (max 100 characters)');
  }
  if (goal.length > 500) {
    errors.push('Plan goal is too long (max 500 characters)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Generate unique IDs
function generateId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function parsePlanArgumentsUncached(args: string = ''): ParsedPlanArgs {
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
    let musicPreset: string | null = null;
    let playlistId: string | null = null;
    let musicSource: string | null = null;
    let genre: string | null = null;

    const COMBINED_FLAGS_REGEX = /--(goal|chunk|break|tags|music|playlist|source|genre)\s+("([^"]+)"|'([^']+)'|(\S+))/gi;
    const flagMatches: Array<{ match: RegExpMatchArray; name: string; value: string; fullSpan: string }> = [];
    for (const match of remainingArgs.matchAll(COMBINED_FLAGS_REGEX)) {
      const name = match[1];
      const value = match[3] !== undefined ? match[3].trim() : match[4] !== undefined ? match[4].trim() : match[5] !== undefined ? match[5].trim() : '';
      flagMatches.push({ match, name, value, fullSpan: match[0] });
    }
    for (const fm of flagMatches) {
      if (fm.name === 'goal') {
        goal = validateInput(fm.value, 500);
      } else if (fm.name === 'chunk') {
        chunkSizeMinutes = Number.parseInt(fm.value, 10);
      } else if (fm.name === 'break') {
        breakMinutes = Number.parseInt(fm.value, 10);
      } else if (fm.name === 'tags') {
        const tagsStr = validateInput(fm.value, 200);
        tags = tagsStr.split(',').map(t => validateInput(t, 40)).filter(t => t);
      } else if (fm.name === 'music') {
        const raw = validateInput(fm.value, 60);
        if (raw.length > 0 && raw in MUSIC_PRESET_METADATA) musicPreset = raw;
        else if (raw.length > 0) musicPreset = raw;
      } else if (fm.name === 'playlist') {
        const raw = validateInput(fm.value, 100);
        if (raw.length > 0) playlistId = raw;
      } else if (fm.name === 'source') {
        const raw = validateInput(fm.value, 30).toLowerCase();
        if (raw.length > 0 && (MUSIC_SOURCE_WHITELIST as readonly string[]).includes(raw)) {
          musicSource = raw;
        }
      } else if (fm.name === 'genre') {
        const raw = validateInput(fm.value, 40);
        if (raw.length > 0) genre = raw;
      }
      remainingArgs = remainingArgs.replace(fm.fullSpan, '').trim();
    }

    const parts = remainingArgs ? remainingArgs.split(/\s+/) : [];

    if (remainingArgs && _mergedPresets && _mergedPresetsBuilt) {
      const lowerTrimmedArgs = remainingArgs.toLowerCase();
      const matchedPresetName = _presetNamesSortedByLength.find(name =>
        lowerTrimmedArgs === name || lowerTrimmedArgs.startsWith(`${name} `)
      );

      if (matchedPresetName) {
        const preset = _mergedPresets.get(matchedPresetName)!;
        title = preset.title;
        durationMinutes = preset.durationMinutes;
        if (!goal) goal = preset.goal;
        usedPreset = matchedPresetName;
        if (preset.chunkSizeMinutes && !chunkSizeMinutes) chunkSizeMinutes = preset.chunkSizeMinutes;

        if (!musicPreset && preset.musicPreset) {
          musicPreset = preset.musicPreset;
        }
        if (!genre && preset.genre) {
          genre = preset.genre;
        }
        if (!musicSource && preset.source) {
          musicSource = preset.source;
        }

        const afterPresetArgs = remainingArgs.slice(matchedPresetName.length).trim();
        if (afterPresetArgs) {
          parts.length = 0;
          parts.push(...afterPresetArgs.split(/\s+/));
        } else {
          parts.length = 0;
        }
      }
    }

    if (parts.length > 0) {
      const partsStr = parts.join(' ');

      let totalMinutes = 0;
      let durationFound = false;
      let matchedDurationPart = '';

      const unitPatterns: RegExp[] = [
        /(\d+)\s*h(?:ours?)?\s*(\d*)\s*(?:m(?:in(?:utes?)?)?)?/i,
        /(\d+)\s*(?:m(?:in(?:utes?)?)?)?/i,
        /(\d+)\s*h(?:ours?)?/i,
      ];

      for (const pattern of unitPatterns) {
        try {
          const match = partsStr.match(pattern);
          if (match) {
            let hours = 0;
            let minutes = 0;

            if (pattern === unitPatterns[0]) {
              hours = match[1] ? Number.parseInt(match[1], 10) : 0;
              minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
            } else if (pattern === unitPatterns[1]) {
              minutes = match[1] ? Number.parseInt(match[1], 10) : 0;
            } else if (pattern === unitPatterns[2]) {
              hours = match[1] ? Number.parseInt(match[1], 10) : 0;
            }

            totalMinutes = hours * 60 + minutes;
            if (totalMinutes > 0) {
              durationMinutes = totalMinutes;
              durationFound = true;
              matchedDurationPart = match[0];
              break;
            }
          }
        } catch (error) {
          console.warn('Error parsing duration pattern:', error);
        }
      }

      if (durationFound) {
        const customTitle = partsStr.replace(matchedDurationPart, '').trim();
        if (customTitle) {
          title = validateInput(customTitle, 100);
        }
      } else {
        title = validateInput(partsStr, 100);
      }
    } else {
      title = validateInput(title, 100);
    }

    if (goal) goal = validateInput(goal, 500);

    durationMinutes = normalizeBoundedMinutes(
      durationMinutes,
      DEFAULT_PLAN_DURATION_MINUTES,
      MIN_PLAN_DURATION_MINUTES,
      MAX_PLAN_DURATION_MINUTES
    );

    return {
      title,
      goal,
      durationMinutes,
      usedPreset,
      chunkSizeMinutes,
      breakMinutes,
      tags,
      musicPreset,
      playlistId,
      musicSource,
      genre,
    };
  } catch (error) {
    console.error('Error in parsePlanArguments:', error);
    return {
      title: 'Planned session',
      goal: '',
      durationMinutes: DEFAULT_PLAN_DURATION_MINUTES,
      usedPreset: null,
      chunkSizeMinutes: undefined,
      breakMinutes: undefined,
      tags: [],
      musicPreset: null,
      playlistId: null,
      musicSource: null,
      genre: null,
    };
  }
}

function parsePlanArguments(args: string = ''): ParsedPlanArgs {
  try { _ensurePresetsBuilt(); } catch (_) {}
  const k = 'p:' + cyrb53(args ?? '');
  const cached = _parseCache.get(k);
  if (cached) return cached as ParsedPlanArgs;
  const result = parsePlanArgumentsUncached(args);
  _parseCache.set(k, result);
  return result;
}

function loadPresets(): PlanPreset[] {
  if (cachedPresets === null) {
    cachedPresets = loadPlanPresets() || [];
  }
  return cachedPresets || [];
}

function listPresets(): PlanPreset[] {
  return loadPresets().slice();
}

function findPresetByName(name: string): PlanPreset | undefined {
  try { _ensurePresetsBuilt(); } catch (_) {}
  const lowerName = name.toLowerCase();
  if (_mergedPresets && _mergedPresetsBuilt) {
    const merged = _mergedPresets.get(lowerName);
    if (merged) {
      return {
        name: lowerName,
        title: merged.title,
        durationMinutes: merged.durationMinutes,
        goal: merged.goal,
        chunkSizeMinutes: merged.chunkSizeMinutes,
      } as PlanPreset;
    }
  }
  const presets = loadPresets();
  return presets.find(p => p.name.toLowerCase() === lowerName);
}

function breakDownIntoTasksUncached(
  planConfig: Partial<FocusPlan> = {},
  chunkSizeMinutes: number = DEFAULT_CHUNK_SIZE_MINUTES,
  breakMinutes: number = DEFAULT_BREAK_MINUTES,
  includeBreaks: boolean = false
): Task[] {
  const totalDuration = normalizeBoundedMinutes(
    planConfig.durationMinutes,
    DEFAULT_PLAN_DURATION_MINUTES,
    MIN_PLAN_DURATION_MINUTES,
    MAX_PLAN_DURATION_MINUTES
  );
  const normalizedChunkSizeMinutes = normalizeChunkSizeMinutes(chunkSizeMinutes);
  const goal = planConfig.goal || planConfig.title || '';
  const chunkCount = Math.ceil(totalDuration / normalizedChunkSizeMinutes);
  const estimate = includeBreaks ? chunkCount + (chunkCount - 1) : chunkCount;
  const result = new Array<Task>(Math.max(0, estimate));
  let writeIdx = 0;
  let remainingDuration = totalDuration;
  let chunkIndex = 0;

  while (remainingDuration > 0) {
    const chunkDuration = Math.min(normalizedChunkSizeMinutes, remainingDuration);
    const descriptorIndex = chunkIndex < TASK_DESCRIPTORS.length ? chunkIndex : TASK_DESCRIPTORS.length - 1;
    let taskTitle: string;

    if (goal) {
      taskTitle = `${TASK_DESCRIPTORS[descriptorIndex]}: ${goal}`;
    } else {
      taskTitle = `${TASK_DESCRIPTORS[descriptorIndex]} - Part ${chunkIndex + 1}`;
    }

    result[writeIdx++] = {
      id: `task-${_nextTaskId()}-${chunkIndex}`,
      title: taskTitle,
      durationMinutes: chunkDuration,
      completed: false,
      completedAt: null,
      isBreak: false
    };

    remainingDuration -= chunkDuration;
    if (includeBreaks && remainingDuration > 0) {
      result[writeIdx++] = {
        id: `task-${_nextTaskId()}-break-${chunkIndex}`,
        title: 'Break',
        durationMinutes: Math.min(breakMinutes, remainingDuration),
        completed: false,
        completedAt: null,
        isBreak: true
      };
      remainingDuration -= breakMinutes;
    }
    chunkIndex++;
  }

  return result.slice(0, writeIdx);
}

function breakDownIntoTasksCached(
  planConfig: Partial<FocusPlan> = {},
  chunkSizeMinutes: number = DEFAULT_CHUNK_SIZE_MINUTES,
  breakMinutes: number = DEFAULT_BREAK_MINUTES,
  includeBreaks: boolean = false
): Task[] {
  const key = `${planConfig.durationMinutes ?? 0}:${chunkSizeMinutes}:${breakMinutes}:${includeBreaks ? 1 : 0}:${cyrb53((planConfig.goal || '') + '|' + (planConfig.title || ''))}`;
  const cached = _taskBreakdownCache.get(key);
  if (cached) return cached as Task[];
  const result = breakDownIntoTasksUncached(planConfig, chunkSizeMinutes, breakMinutes, includeBreaks);
  _taskBreakdownCache.set(key, result);
  return result;
}

const breakDownIntoTasks = breakDownIntoTasksCached;

interface CreatePlanOptions {
  chunkSizeMinutes?: number;
  breakMinutes?: number;
  includeBreaks?: boolean;
  source?: string;
  createdAt?: string;
  nextQueue?: string[];
  title?: string;
  goal?: string;
  durationMinutes?: number;
  tags?: string[];
  theme?: string;
  icon?: string;
}

interface AssistantPlanDraft {
  title?: string;
  goal?: string;
  durationMinutes?: number;
  chunkSizeMinutes?: number;
  breakMinutes?: number;
  tags?: string[];
  tasks?: Array<(Partial<Task> & { name?: string }) | string>;
}

function normalizeAssistantPlanDraft(
  rawDraft: AssistantPlanDraft = {},
  options: CreatePlanOptions = {}
): Partial<FocusPlan> {
  const normalizedDraft = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
  const durationMinutes = normalizeBoundedInt(
    normalizedDraft.durationMinutes,
    DEFAULT_PLAN_DURATION_MINUTES,
    MIN_PLAN_DURATION_MINUTES,
    MAX_PLAN_DURATION_MINUTES
  );
  const chunkSizeMinutes = normalizeChunkSizeMinutes(
    normalizedDraft.chunkSizeMinutes,
    durationMinutes <= 30 ? 15 : durationMinutes <= 60 ? 20 : 25
  );
  const breakMinutes = normalizeBoundedMinutes(
    normalizedDraft.breakMinutes,
    durationMinutes >= 90 ? 10 : DEFAULT_BREAK_MINUTES,
    1,
    30
  );
  const title =
    validateInput(normalizedDraft.title || options.title || 'Planned session', 100) ||
    'Planned session';
  const goal = validateInput(normalizedDraft.goal || options.goal || title, 500);
  const tags = Array.isArray(normalizedDraft.tags)
    ? normalizedDraft.tags.map((tag) => validateInput(String(tag), 40)).filter(Boolean)
    : [];
  const draftTasks = Array.isArray(normalizedDraft.tasks) ? normalizedDraft.tasks : [];
  const fallbackTaskDuration = Math.max(
    MIN_PLAN_DURATION_MINUTES,
    Math.round(durationMinutes / Math.max(1, draftTasks.length || 1))
  );
  const normalizedTasks = draftTasks
    .map((task, index) => {
      const taskTitle =
        typeof task === 'string'
          ? validateInput(task, 100)
          : validateInput(String(task?.title || task?.name || ''), 100);
      if (!taskTitle) return null;
      return {
        id:
          typeof task === 'object' && typeof task?.id === 'string' && task.id.trim()
            ? task.id.trim()
            : `task-${_nextTaskId()}-assistant-${index}`,
        title: taskTitle,
        durationMinutes: normalizeBoundedMinutes(
          typeof task === 'object' ? task?.durationMinutes : undefined,
          fallbackTaskDuration,
          MIN_PLAN_DURATION_MINUTES,
          120
        ),
        completed: false,
        completedAt: null,
        isBreak: Boolean(typeof task === 'object' && task?.isBreak),
      } as Task;
    })
    .filter(Boolean) as Task[];

  return {
    title,
    goal,
    durationMinutes,
    chunkSizeMinutes,
    breakMinutes,
    tasks:
      normalizedTasks.length > 0
        ? normalizedTasks
        : breakDownIntoTasks({ title, goal, durationMinutes }, chunkSizeMinutes, breakMinutes, false),
    source:
      typeof options.source === 'string' && options.source.trim()
        ? options.source.trim()
        : 'assistant',
    createdAt:
      typeof options.createdAt === 'string' && options.createdAt.trim()
        ? options.createdAt
        : new Date().toISOString(),
    status: 'pending',
    tags,
    nextQueue: Array.isArray(options.nextQueue) ? options.nextQueue : [],
    theme: options.theme,
    icon: options.icon,
  };
}

function createPlanConfigUncached(
  planArgs: string = '',
  options: CreatePlanOptions = {}
): FocusPlan {
  try {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const parsed = parsePlanArguments(planArgs);
    const now = new Date();
    const nowIso = now.toISOString();
    const chunkSizeMinutes = normalizeChunkSizeMinutes(
      normalizedOptions.chunkSizeMinutes !== undefined
        ? normalizedOptions.chunkSizeMinutes
        : parsed.chunkSizeMinutes,
      DEFAULT_CHUNK_SIZE_MINUTES
    );
    const breakMinutes = normalizeBoundedMinutes(
      normalizedOptions.breakMinutes !== undefined
        ? normalizedOptions.breakMinutes
        : parsed.breakMinutes,
      DEFAULT_BREAK_MINUTES,
      1,
      30
    );
    const createdAt =
      typeof normalizedOptions.createdAt === 'string' && normalizedOptions.createdAt.trim()
        ? normalizedOptions.createdAt
        : nowIso;
    const source =
      typeof normalizedOptions.source === 'string' && normalizedOptions.source.trim()
        ? normalizedOptions.source.trim()
        : 'extension';
    const nextQueue = Array.isArray(normalizedOptions.nextQueue)
      ? normalizedOptions.nextQueue.filter(item => typeof item === 'string' && item.trim())
      : [];
    const title =
      typeof normalizedOptions.title === 'string' && normalizedOptions.title.trim()
        ? normalizedOptions.title.trim()
        : parsed.title;
    const goal =
      typeof normalizedOptions.goal === 'string' && normalizedOptions.goal.trim()
        ? normalizedOptions.goal.trim()
        : parsed.goal;
    const durationMinutes = normalizeBoundedInt(
      normalizedOptions.durationMinutes,
      parsed.durationMinutes,
      MIN_PLAN_DURATION_MINUTES,
      MAX_PLAN_DURATION_MINUTES
    );
    const tags = Array.isArray(normalizedOptions.tags)
      ? normalizedOptions.tags.filter(t => typeof t === 'string' && t.trim())
      : (parsed.tags || []);
    const tasks = breakDownIntoTasks(
      {
        title,
        goal,
        durationMinutes,
      },
      chunkSizeMinutes,
      breakMinutes,
      !!normalizedOptions.includeBreaks
    );

    return {
      id: generateId(),
      title,
      goal,
      durationMinutes,
      tasks,
      chunkSizeMinutes,
      breakMinutes,
      nextQueue,
      source,
      createdAt,
      status: 'pending',
      tags,
      theme: normalizedOptions.theme,
      icon: normalizedOptions.icon
    };
  } catch (error) {
    console.error('Error in createPlanConfig:', error);
    const nowIso = new Date().toISOString();
    return {
      id: generateId(),
      title: 'Planned session',
      goal: '',
      durationMinutes: DEFAULT_PLAN_DURATION_MINUTES,
      tasks: breakDownIntoTasks({ title: 'Planned session', durationMinutes: DEFAULT_PLAN_DURATION_MINUTES }),
      chunkSizeMinutes: DEFAULT_CHUNK_SIZE_MINUTES,
      breakMinutes: DEFAULT_BREAK_MINUTES,
      nextQueue: [],
      source: 'extension',
      createdAt: nowIso,
      status: 'pending',
      tags: []
    };
  }
}

function createPlanConfig(
  planArgs: string = '',
  options: CreatePlanOptions = {}
): FocusPlan {
  const plan = createPlanConfigUncached(planArgs, options);
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      Object.freeze(plan);
    }
  } catch (_) {}
  return plan;
}

function createPlanConfigBatch(
  count: number,
  templateArgs: string = '',
  sharedOptions: CreatePlanOptions = {}
): FocusPlan[] {
  const results: FocusPlan[] = [];
  const hasExplicitTitle = typeof sharedOptions.title === 'string' && sharedOptions.title.trim().length > 0;
  for (let i = 0; i < count; i++) {
    let opts = sharedOptions;
    if (!hasExplicitTitle) {
      opts = { ...sharedOptions, title: undefined };
    }
    const plan = createPlanConfig(templateArgs, opts);
    if (!hasExplicitTitle) {
      plan.title = `${plan.title} (${i + 1})`;
    }
    results.push(plan);
  }
  return results;
}

// Plan lifecycle management
function startPlan(plan: FocusPlan): FocusPlan {
  return {
    ...plan,
    status: 'in_progress',
    startedAt: new Date().toISOString()
  };
}

function completePlan(plan: FocusPlan): FocusPlan {
  return {
    ...plan,
    status: 'completed',
    completedAt: new Date().toISOString(),
    tasks: plan.tasks.map((task: Task) => ({ ...task, completed: true, completedAt: new Date().toISOString() }))
  };
}

function cancelPlan(plan: FocusPlan): FocusPlan {
  return {
    ...plan,
    status: 'cancelled',
    cancelledAt: new Date().toISOString()
  };
}

function completeTask(plan: FocusPlan, taskId: string): FocusPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((task: Task) => {
      if (task.id === taskId) {
        return {
          ...task,
          completed: true,
          completedAt: new Date().toISOString()
        };
      }
      return task;
    })
  };
}

// Break schedule management
interface BreakSchedule {
  enabled: boolean;
  breakMinutes: number;
  longBreakMinutes?: number;
  longBreakInterval?: number;
}

function createBreakSchedule(
  enabled: boolean = true,
  breakMinutes: number = 5,
  longBreakMinutes?: number,
  longBreakInterval?: number
): BreakSchedule {
  return {
    enabled,
    breakMinutes,
    longBreakMinutes,
    longBreakInterval
  };
}

function applyBreakSchedule(plan: FocusPlan, schedule: BreakSchedule): FocusPlan {
  if (!schedule.enabled) {
    return plan;
  }

  const tasks = breakDownIntoTasks(
    plan,
    plan.chunkSizeMinutes,
    schedule.breakMinutes,
    true
  );

  return {
    ...plan,
    tasks,
    breakMinutes: schedule.breakMinutes
  };
}

// Session statistics
interface SessionStats {
  totalFocusMinutes: number;
  totalTasks: number;
  tasksCompleted: number;
  completionPercentage: number;
  estimatedDurationMinutes: number;
}

function calculateSessionStats(plan: FocusPlan): SessionStats {
  const totalTasks = plan.tasks.length;
  const tasksCompleted = plan.tasks.filter((t: Task) => t.completed).length;
  const completionPercentage = totalTasks > 0 ? Math.round((tasksCompleted / totalTasks) * 100) : 0;
  const totalFocusMinutes = plan.tasks
    .filter((t: Task) => !t.isBreak)
    .reduce((sum: number, t: Task) => sum + t.durationMinutes, 0);

  return {
    totalFocusMinutes,
    totalTasks,
    tasksCompleted,
    completionPercentage,
    estimatedDurationMinutes: plan.durationMinutes
  };
}

// Export functions
interface ExportOptions {
  format?: 'json' | 'markdown' | 'text';
  includeTasks?: boolean;
  includeMetadata?: boolean;
}

function exportPlan(plan: FocusPlan, options: ExportOptions = {}): string {
  const format = options.format || 'json';
  const includeTasks = options.includeTasks !== false;
  const includeMetadata = options.includeMetadata !== false;

  if (format === 'json') {
    let exportObj: any = { ...plan };
    if (!includeTasks) {
      delete exportObj.tasks;
    }
    if (!includeMetadata) {
      delete exportObj.createdAt;
      delete exportObj.source;
      delete exportObj.nextQueue;
    }
    return JSON.stringify(exportObj, null, 2);
  } else if (format === 'markdown') {
    let md = `# ${plan.title}\n\n`;
    if (plan.goal) {
      md += `## Goal\n${plan.goal}\n\n`;
    }
    md += `## Duration\n${plan.durationMinutes} minutes\n\n`;
    if (includeTasks && plan.tasks.length > 0) {
      md += `## Tasks\n\n`;
      plan.tasks.forEach((task: Task) => {
        const status = task.completed ? '[x]' : '[ ]';
        md += `${status} ${task.title} (${task.durationMinutes} min)\n`;
      });
    }
    return md;
  } else { // text
    let text = `${plan.title}\n`;
    if (plan.goal) {
      text += `\nGoal: ${plan.goal}\n`;
    }
    text += `\nDuration: ${plan.durationMinutes} minutes\n`;
    if (includeTasks && plan.tasks.length > 0) {
      text += `\nTasks:\n`;
      plan.tasks.forEach((task: Task) => {
        const status = task.completed ? '[x]' : '[ ]';
        text += `${status} ${task.title} (${task.durationMinutes} min)\n`;
      });
    }
    return text;
  }
}

// Enhanced export function with CSV support
function exportPlanEnhanced(
  plan: FocusPlan,
  format: 'json' | 'markdown' | 'csv' = 'json'
): string {
  if (format === 'csv') {
    let csv = 'Task ID,Title,Duration (min),Is Break,Completed\n';
    plan.tasks.forEach((task: Task) => {
      csv += `"${task.id}","${task.title}",${task.durationMinutes},${task.isBreak},${task.completed}\n`;
    });
    return csv;
  }
  return exportPlan(plan, { format });
}

// Performance monitoring functions
function recordPerformance(commandName: string, startTime: number, success: boolean): void {
  const endTime = Date.now();
  performanceMetrics.push({
    commandName,
    startTime,
    endTime,
    durationMs: endTime - startTime,
    success
  });
  // Keep only last 1000 metrics
  if (performanceMetrics.length > 1000) {
    performanceMetrics = performanceMetrics.slice(-1000);
  }
}

function getPerformanceMetrics() {
  return [...performanceMetrics];
}

function getAverageResponseTime(): number {
  if (performanceMetrics.length === 0) return 0;
  const totalMs = performanceMetrics.reduce(
    (sum, m) => sum + (m.endTime - m.startTime),
    0
  );
  return totalMs / performanceMetrics.length;
}

function getErrorRate(): number {
  if (performanceMetrics.length === 0) return 0;
  const errorCount = performanceMetrics.filter(m => !m.success).length;
  return errorCount / performanceMetrics.length;
}

// ==================== C++ Module Integration ====================

interface CppPlanOptimization {
  originalPlan: string;
  workBlockMinutes: number;
  breakMinutes: number;
  optimizationStrategy: string;
}

interface CppAnalytics {
  totalPlans: number;
  completedPlans: number;
  completionRate: number;
  avgDurationMinutes: number;
}

interface CppProductivityScore {
  score: number;
  level: string;
}

interface CppOptimalBreaks {
  workBlockMinutes: number;
  breakMinutes: number;
  numBlocks: number;
  remainingMinutes: number;
}

const ERLANG_API_BASE = process.env.ERLANG_API_BASE || 'http://localhost:8080';

const processPlanWithCpp = async (planJson: string): Promise<string> => {
  if (!_isErlangAvailable()) {
    return planJson;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/process-plan`, { plan: planJson }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    console.log('C++ module not available, falling back to native processing');
    return planJson;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for plan processing:', error);
    return planJson;
  }
};

const validatePlanWithCpp = async (planJson: string): Promise<boolean> => {
  if (!_isErlangAvailable()) {
    return true;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/validate-plan`, { plan: planJson }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && typeof response.data.valid === 'boolean') {
      return response.data.valid;
    }
    return validatePlanInput('', '').valid;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for plan validation:', error);
    return true;
  }
};

const optimizeTaskDistributionWithCpp = async (
  planJson: string,
  workBlockMinutes: number,
  breakMinutes: number
): Promise<CppPlanOptimization | null> => {
  if (!_isErlangAvailable()) {
    return null;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/optimize-tasks`, { plan: planJson, workBlockMinutes, breakMinutes }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for task optimization:', error);
    return null;
  }
};

const calculateAnalyticsWithCpp = async (plans: string[]): Promise<CppAnalytics | null> => {
  if (!_isErlangAvailable()) {
    return null;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/calculate-analytics`, { plans }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for analytics:', error);
    return null;
  }
};

const calculateProductivityScoreWithCpp = async (completedTasks: string[]): Promise<CppProductivityScore | null> => {
  if (!_isErlangAvailable()) {
    return null;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/productivity-score`, { tasks: completedTasks }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for productivity score:', error);
    return null;
  }
};

const scheduleTasksWithCpp = async (tasks: string[], strategy: string): Promise<any> => {
  if (!_isErlangAvailable()) {
    return null;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/schedule-tasks`, { tasks, strategy }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for task scheduling:', error);
    return null;
  }
};

const calculateOptimalBreaksWithCpp = async (
  totalWorkMinutes: number,
  preferredWorkBlock: number
): Promise<CppOptimalBreaks | null> => {
  if (!_isErlangAvailable()) {
    return null;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/optimal-breaks`, { totalWorkMinutes, preferredWorkBlock }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for optimal breaks:', error);
    return null;
  }
};

const prioritizeTasksWithCpp = async (tasks: string[], priorities: number[]): Promise<any> => {
  if (!_isErlangAvailable()) {
    return null;
  }
  try {
    const response = await Promise.race([
      axiosStatic.post(`${ERLANG_API_BASE}/api/cpp/prioritize-tasks`, { tasks, priorities }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
    ]);
    if (response.data && response.data.result) {
      return response.data.result;
    }
    return null;
  } catch (error) {
    _markErlangUnavailable();
    console.warn('Error calling C++ module for task prioritization:', error);
    return null;
  }
};

// Export both ES modules and CommonJS for compatibility.
// Shortcuts are kept in memory here; callers can replace this with persistent
// storage without changing the public API.
interface PlanShortcut {
  id: string;
  name: string;
  command: string;
  description?: string;
  createdAt: number;
  usageCount: number;
}

const shortcuts: PlanShortcut[] = [];

function addShortcut(name: string, command: string, description?: string): PlanShortcut {
  const shortcut = { id: generateId(), name, command, description, createdAt: Date.now(), usageCount: 0 };
  shortcuts.push(shortcut);
  return shortcut;
}

function listShortcuts(): PlanShortcut[] {
  return shortcuts.map((shortcut) => ({ ...shortcut }));
}

function removeShortcut(id: string): boolean {
  const index = shortcuts.findIndex((shortcut) => shortcut.id === id);
  if (index === -1) return false;
  shortcuts.splice(index, 1);
  return true;
}

function useShortcut(id: string): PlanShortcut | undefined {
  const shortcut = shortcuts.find((item) => item.id === id);
  if (shortcut) shortcut.usageCount += 1;
  return shortcut;
}

function generateSmartRecommendation(durationMinutes: number, workIntensity: number, userEnergy: number) {
  const intensity = Math.max(0, Math.min(100, workIntensity));
  const energy = Math.max(0, Math.min(100, userEnergy));
  const optimalWorkMinutes = energy >= 70 ? 25 : energy >= 40 ? 20 : 15;
  return {
    optimalWorkMinutes: Math.min(Math.max(optimalWorkMinutes, 5), Math.max(durationMinutes, 5)),
    optimalBreakMinutes: intensity >= 70 ? 8 : 5,
    recommendation: energy >= 70
      ? 'Your energy level supports a focused work session.'
      : 'Use shorter work sessions to maintain steady focus.',
    estimatedProductivityGain: Math.round((energy * 0.12) + ((100 - intensity) * 0.04)),
  };
}

export {
  DEFAULT_PRESETS,
  getDefaultPresets,
  normalizeBoundedInt,
  normalizeChunkSizeMinutes,
  parsePlanArguments,
  breakDownIntoTasks,
  createPlanConfig,
  createPlanConfigBatch,
  MIN_PLAN_DURATION_MINUTES,
  MAX_PLAN_DURATION_MINUTES,
  DEFAULT_PLAN_DURATION_MINUTES,
  DEFAULT_CHUNK_SIZE_MINUTES,
  DEFAULT_BREAK_MINUTES,
  loadPresets,
  listPresets,
  removeEmojis,
  validateInput,
  validatePlanInput,
  validatePlan,
  validatePlanArguments,
  recordPerformance,
  getPerformanceMetrics,
  getAverageResponseTime,
  getErrorRate,
  exportPlan,
  exportPlanEnhanced,
  calculateSessionStats,
  createBreakSchedule,
  applyBreakSchedule,
  startPlan,
  completePlan,
  cancelPlan,
  completeTask,
  findPresetByName,
  generateId,
  listShortcuts,
  addShortcut,
  removeShortcut,
  useShortcut,
  generateSmartRecommendation,
  // C++ module integration functions
  processPlanWithCpp,
  validatePlanWithCpp,
  optimizeTaskDistributionWithCpp,
  calculateAnalyticsWithCpp,
  calculateProductivityScoreWithCpp,
  scheduleTasksWithCpp,
  calculateOptimalBreaksWithCpp,
  prioritizeTasksWithCpp,
  // 新增功能
  getSmartSuggestions,
  comparePlans,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  createBatchPlans,
  // 优化后的函数
  parsePlanArgumentsOptimized,
  breakDownIntoTasksOptimized,
  createPlanConfigOptimized,
  // 辅助函数
  getAutocompleteSuggestions,
  addToPlanHistory,
  getPlanHistory,
  SimpleCache,
  loadTemplatesFromStorage,
  saveTemplatesToStorage,
  // ADHD support functions
  ADHDPlanSupport,
  FocusTimerConfig,
  MicroTask,
  SensoryReminder,
  TransitionChecklist,
  TransitionChecklistItem,
  // Music domain
  MUSIC_PRESET_METADATA,
  MUSIC_SOURCE_WHITELIST,
  MUSIC_GENRES_DEFAULT,
  MusicSourceType,
  ParsedPlanArgs
};

// ==================== 新增 4 项实用功能 ====================

// 缓存系统 - 用于性能优化
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiryMs: number;
}

class SimpleCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  set(key: string, value: T, expiryMs: number = 60000): void {
    if (this.cache.size >= this.maxSize) {
      // 移除最早的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      expiryMs
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.expiryMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  clear(): void {
    this.cache.clear();
  }
}

// 全局缓存实例
const parseArgumentsCache = new SimpleCache<ParsedPlanArgs>(50);
const taskBreakdownCache = new SimpleCache<Task[]>(30);

// 功能 1: 智能时间建议
interface SmartSuggestion {
  recommendedDuration: number;
  recommendedChunkSize: number;
  recommendedBreakMinutes: number;
  bestTimeOfDay: string;
  productivityPrediction: 'low' | 'medium' | 'high';
  tips: string[];
}

function getSmartSuggestions(context: {
  hourOfDay?: number;
  historicalPlans?: FocusPlan[];
} = {}): SmartSuggestion {
  const hour = context.hourOfDay || new Date().getHours();
  let productivityPrediction: 'low' | 'medium' | 'high' = 'medium';
  let bestTimeOfDay = 'morning (9-12 AM)';
  
  if (hour >= 9 && hour <= 12) {
    productivityPrediction = 'high';
    bestTimeOfDay = 'now (optimal time!)';
  } else if (hour >= 14 && hour <= 17) {
    productivityPrediction = 'medium';
    bestTimeOfDay = 'afternoon (2-5 PM)';
  } else if (hour >= 20 && hour <= 23) {
    productivityPrediction = 'low';
    bestTimeOfDay = 'evening - consider shorter sessions';
  }

  return {
    recommendedDuration: productivityPrediction === 'high' ? 60 : 45,
    recommendedChunkSize: productivityPrediction === 'high' ? 25 : 20,
    recommendedBreakMinutes: 5,
    bestTimeOfDay,
    productivityPrediction,
    tips: [
      'Start with your most important task first',
      'Take short breaks to maintain focus',
      'Eliminate distractions during focus time'
    ]
  };
}

// 功能 2: 计划对比与分析
interface PlanComparison {
  plan1Stats: SessionStats;
  plan2Stats: SessionStats;
  differences: {
    durationDiff: number;
    taskCountDiff: number;
    focusTimeDiff: number;
  };
  recommendation: string;
}

function comparePlans(plan1: FocusPlan, plan2: FocusPlan): PlanComparison {
  const stats1 = calculateSessionStats(plan1);
  const stats2 = calculateSessionStats(plan2);

  return {
    plan1Stats: stats1,
    plan2Stats: stats2,
    differences: {
      durationDiff: plan2.durationMinutes - plan1.durationMinutes,
      taskCountDiff: plan2.tasks.length - plan1.tasks.length,
      focusTimeDiff: stats2.totalFocusMinutes - stats1.totalFocusMinutes
    },
    recommendation: stats1.totalFocusMinutes > stats2.totalFocusMinutes 
      ? 'Plan 1 has more effective focus time' 
      : 'Plan 2 has more effective focus time'
  };
}

// 功能 3: 计划模板管理
interface PlanTemplate {
  id: string;
  name: string;
  description?: string;
  planConfig: Partial<FocusPlan>;
  createdAt: string;
}

let planTemplates: PlanTemplate[] = [];
const templatesStorageKey = 'helpy-plan-templates';

function loadTemplatesFromStorage(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(templatesStorageKey);
      if (stored) {
        planTemplates = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load templates:', e);
    }
  }
}

function saveTemplatesToStorage(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(templatesStorageKey, JSON.stringify(planTemplates));
    } catch (e) {
      console.error('Failed to save templates:', e);
    }
  }
}

function saveTemplate(name: string, planConfig: Partial<FocusPlan>, description?: string): PlanTemplate {
  loadTemplatesFromStorage();
  const template: PlanTemplate = {
    id: generateId(),
    name,
    description,
    planConfig,
    createdAt: new Date().toISOString()
  };
  planTemplates.push(template);
  saveTemplatesToStorage();
  return template;
}

function loadTemplate(name: string): PlanTemplate | null {
  loadTemplatesFromStorage();
  return planTemplates.find(t => t.name.toLowerCase() === name.toLowerCase()) || null;
}

function listTemplates(): PlanTemplate[] {
  loadTemplatesFromStorage();
  return [...planTemplates];
}

function deleteTemplate(name: string): boolean {
  loadTemplatesFromStorage();
  const index = planTemplates.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
  if (index >= 0) {
    planTemplates.splice(index, 1);
    saveTemplatesToStorage();
    return true;
  }
  return false;
}

// 功能 4: 快速批量任务创建
interface BatchPlanRequest {
  tasks: Array<{
    title: string;
    durationMinutes?: number;
    goal?: string;
  }>;
  defaultDuration?: number;
}

function createBatchPlans(request: BatchPlanRequest): FocusPlan[] {
  const defaultDuration = request.defaultDuration || 30;
  return request.tasks.map(task => {
    return createPlanConfig(task.title, {
      durationMinutes: task.durationMinutes || defaultDuration,
      goal: task.goal
    });
  });
}

// ==================== 性能优化版本的函数 ====================

// 优化后的 parsePlanArguments - 添加缓存
function parsePlanArgumentsOptimized(args: string = ''): ParsedPlanArgs {
  const cacheKey = `parse:${args}`;
  const cached = parseArgumentsCache.get(cacheKey);
  if (cached) return cached;

  const result = parsePlanArguments(args);
  parseArgumentsCache.set(cacheKey, result, 30000); // 30秒缓存
  return result;
}

// 优化后的 breakDownIntoTasks - 添加缓存
function breakDownIntoTasksOptimized(
  planConfig: Partial<FocusPlan> = {},
  chunkSizeMinutes: number = DEFAULT_CHUNK_SIZE_MINUTES,
  breakMinutes: number = DEFAULT_BREAK_MINUTES,
  includeBreaks: boolean = false
): Task[] {
  const cacheKey = `tasks:${JSON.stringify(planConfig)}:${chunkSizeMinutes}:${breakMinutes}:${includeBreaks}`;
  const cached = taskBreakdownCache.get(cacheKey);
  if (cached) return cached;

  const result = breakDownIntoTasks(planConfig, chunkSizeMinutes, breakMinutes, includeBreaks);
  taskBreakdownCache.set(cacheKey, result, 60000); // 1分钟缓存
  return result;
}

// 优化后的 createPlanConfig
function createPlanConfigOptimized(
  planArgs: string = '',
  options: CreatePlanOptions = {}
): FocusPlan {
  const startTime = Date.now();
  try {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const parsed = parsePlanArgumentsOptimized(planArgs);
    const chunkSizeMinutes = normalizeChunkSizeMinutes(
      normalizedOptions.chunkSizeMinutes !== undefined
        ? normalizedOptions.chunkSizeMinutes
        : parsed.chunkSizeMinutes,
      DEFAULT_CHUNK_SIZE_MINUTES
    );
    const breakMinutes = normalizeBoundedMinutes(
      normalizedOptions.breakMinutes !== undefined
        ? normalizedOptions.breakMinutes
        : parsed.breakMinutes,
      DEFAULT_BREAK_MINUTES,
      1,
      30
    );
    const createdAt =
      typeof normalizedOptions.createdAt === 'string' && normalizedOptions.createdAt.trim()
        ? normalizedOptions.createdAt
        : new Date().toISOString();
    const source =
      typeof normalizedOptions.source === 'string' && normalizedOptions.source.trim()
        ? normalizedOptions.source.trim()
        : 'extension';
    const nextQueue = Array.isArray(normalizedOptions.nextQueue)
      ? normalizedOptions.nextQueue.filter(item => typeof item === 'string' && item.trim())
      : [];
    const title =
      typeof normalizedOptions.title === 'string' && normalizedOptions.title.trim()
        ? normalizedOptions.title.trim()
        : parsed.title;
    const goal =
      typeof normalizedOptions.goal === 'string' && normalizedOptions.goal.trim()
        ? normalizedOptions.goal.trim()
        : parsed.goal;
    const durationMinutes = normalizeBoundedInt(
      normalizedOptions.durationMinutes,
      parsed.durationMinutes,
      MIN_PLAN_DURATION_MINUTES,
      MAX_PLAN_DURATION_MINUTES
    );
    const tags = Array.isArray(normalizedOptions.tags)
      ? normalizedOptions.tags.filter(t => typeof t === 'string' && t.trim())
      : (parsed.tags || []);
    const tasks = breakDownIntoTasksOptimized(
      {
        title,
        goal,
        durationMinutes,
      },
      chunkSizeMinutes,
      breakMinutes,
      !!normalizedOptions.includeBreaks
    );

    const result = {
      id: generateId(),
      title,
      goal,
      durationMinutes,
      tasks,
      chunkSizeMinutes,
      breakMinutes,
      nextQueue,
      source,
      createdAt,
      status: 'pending',
      tags,
      theme: normalizedOptions.theme,
      icon: normalizedOptions.icon
    };

    recordPerformance('createPlanConfig', startTime, true);
    return result as FocusPlan;
  } catch (error) {
    console.error('Error in createPlanConfigOptimized:', error);
    recordPerformance('createPlanConfig', startTime, false);
    // Fallback
    return {
      id: generateId(),
      title: 'Planned session',
      goal: '',
      durationMinutes: DEFAULT_PLAN_DURATION_MINUTES,
      tasks: breakDownIntoTasks({ title: 'Planned session', durationMinutes: DEFAULT_PLAN_DURATION_MINUTES }),
      chunkSizeMinutes: DEFAULT_CHUNK_SIZE_MINUTES,
      breakMinutes: DEFAULT_BREAK_MINUTES,
      nextQueue: [],
      source: 'extension',
      createdAt: new Date().toISOString(),
      status: 'pending',
      tags: []
    };
  }
}

// ==================== 自动补全增强 ====================

function getAutocompleteSuggestions(args: string = ''): Array<{
  content: string;
  description: string;
  type: string;
  priority: number;
}> {
  const suggestions: Array<{
    content: string;
    description: string;
    type: string;
    priority: number;
  }> = [];

  const lowerArgs = args.toLowerCase().trim();

  // 新功能的建议
  if (lowerArgs === '' || lowerArgs.startsWith('s')) {
    suggestions.push({
      content: 'suggest',
      description: 'Get smart time recommendations',
      type: 'feature',
      priority: 95
    });
  }
  if (lowerArgs === '' || lowerArgs.startsWith('c')) {
    suggestions.push({
      content: 'compare',
      description: 'Compare two plans',
      type: 'feature',
      priority: 90
    });
  }
  if (lowerArgs === '' || lowerArgs.startsWith('t')) {
    suggestions.push({
      content: 'template',
      description: 'Manage plan templates',
      type: 'feature',
      priority: 85
    });
  }
  if (lowerArgs === '' || lowerArgs.startsWith('b')) {
    suggestions.push({
      content: 'batch',
      description: 'Create multiple plans at once',
      type: 'feature',
      priority: 80
    });
  }
  if (lowerArgs === '' || lowerArgs.startsWith('e')) {
    suggestions.push({
      content: 'export',
      description: 'Export plan to JSON/Markdown',
      type: 'feature',
      priority: 75
    });
  }

  // 预设建议
  const presets = loadPresets();
  presets.forEach(preset => {
    if (lowerArgs === '' || preset.name.toLowerCase().startsWith(lowerArgs)) {
      suggestions.push({
        content: preset.name,
        description: preset.title,
        type: 'preset',
        priority: 70
      });
    }
  });

  return suggestions;
}

// 计划历史记录管理
const planHistory: FocusPlan[] = [];
const MAX_HISTORY_SIZE = 50;

function addToPlanHistory(plan: FocusPlan): void {
  planHistory.unshift(plan);
  if (planHistory.length > MAX_HISTORY_SIZE) {
    planHistory.pop();
  }
}

function getPlanHistory(): FocusPlan[] {
  return [...planHistory];
}

// ==================== ADHD Support Module ====================

interface FocusTimerConfig {
  durationMinutes: number;
  distractionPromptsEnabled: boolean;
  promptIntervalMinutes?: number;
  customPrompts?: string[];
}

interface MicroTask {
  id: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
}

interface SensoryReminder {
  id: string;
  type: 'breathing' | 'stretch' | 'hydration' | 'sensory-break';
  message: string;
  intervalMinutes: number;
  enabled: boolean;
}

interface TransitionChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

interface TransitionChecklist {
  id: string;
  name: string;
  items: TransitionChecklistItem[];
}

class ADHDPlanSupport {
  private static defaultDistractionPrompts = [
    "Take a 10-second pause",
    "What's one small step you can take right now?",
    "Remember your goal for this session",
    "Take a deep breath and refocus"
  ];

  private static defaultSensoryReminders: SensoryReminder[] = [
    { id: 'breathing-1', type: 'breathing', message: 'Take 3 deep breaths', intervalMinutes: 30, enabled: true },
    { id: 'stretch-1', type: 'stretch', message: 'Stretch your arms and shoulders', intervalMinutes: 60, enabled: true },
    { id: 'hydration-1', type: 'hydration', message: 'Drink some water', intervalMinutes: 90, enabled: true }
  ];

  static createFocusTimer(config: Partial<FocusTimerConfig> = {}): FocusTimerConfig {
    return {
      durationMinutes: config.durationMinutes || 25,
      distractionPromptsEnabled: config.distractionPromptsEnabled !== false,
      promptIntervalMinutes: config.promptIntervalMinutes || 15,
      customPrompts: config.customPrompts || this.defaultDistractionPrompts
    };
  }

  static decomposeToMicroTasks(
    task: { title: string; durationMinutes: number },
    maxMicroTaskMinutes: number = 5
  ): MicroTask[] {
    const microTasks: MicroTask[] = [];
    const totalMinutes = task.durationMinutes;
    const numMicroTasks = Math.ceil(totalMinutes / maxMicroTaskMinutes);
    
    for (let i = 0; i < numMicroTasks; i++) {
      const remaining = totalMinutes - (i * maxMicroTaskMinutes);
      const duration = Math.min(remaining, maxMicroTaskMinutes);
      microTasks.push({
        id: `micro-${generateId()}-${i}`,
        description: `${task.title} - Step ${i + 1}`,
        estimatedMinutes: duration,
        completed: false
      });
    }
    return microTasks;
  }

  static getSensoryReminders(): SensoryReminder[] {
    return [...this.defaultSensoryReminders];
  }

  static createTransitionChecklist(
    fromTask: string,
    toTask: string
  ): TransitionChecklist {
    return {
      id: `checklist-${generateId()}`,
      name: `Transition: ${fromTask} → ${toTask}`,
      items: [
        { id: 'item-1', text: 'Save current work', completed: false },
        { id: 'item-2', text: 'Close unnecessary tabs', completed: false },
        { id: 'item-3', text: 'Gather materials for next task', completed: false },
        { id: 'item-4', text: 'Take a 30-second break', completed: false }
      ]
    };
  }

  static getVisualTaskTrackingData(tasks: any[]): {
    completionPercentage: number;
    completedTasks: number;
    totalTasks: number;
    progressSegments: { label: string; percentage: number }[];
  } {
    const completedTasks = tasks.filter(t => t.completed).length;
    const totalTasks = tasks.length;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    return {
      completionPercentage,
      completedTasks,
      totalTasks,
      progressSegments: tasks.map((task, index) => ({
        label: `Task ${index + 1}`,
        percentage: task.completed ? (100 / totalTasks) : 0
      }))
    };
  }
}

// For CommonJS compatibility (when compiled to JS)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_PRESETS,
    getDefaultPresets,
    normalizeBoundedInt,
    normalizeChunkSizeMinutes,
    parsePlanArguments,
    breakDownIntoTasks,
    createPlanConfig,
    normalizeAssistantPlanDraft,
    createPlanConfigBatch,
    MIN_PLAN_DURATION_MINUTES,
    MAX_PLAN_DURATION_MINUTES,
    DEFAULT_PLAN_DURATION_MINUTES,
    DEFAULT_CHUNK_SIZE_MINUTES,
    loadPresets,
    listPresets,
    removeEmojis,
    validateInput,
    validatePlanInput,
    validatePlan,
    validatePlanArguments,
    recordPerformance,
    getPerformanceMetrics,
    getAverageResponseTime,
    getErrorRate,
    exportPlan,
    exportPlanEnhanced,
    calculateSessionStats,
    createBreakSchedule,
    applyBreakSchedule,
    startPlan,
    completePlan,
    cancelPlan,
    completeTask,
    findPresetByName,
    generateId,
    listShortcuts,
    // C++ module integration functions
    processPlanWithCpp,
    validatePlanWithCpp,
    optimizeTaskDistributionWithCpp,
    calculateAnalyticsWithCpp,
    calculateProductivityScoreWithCpp,
    scheduleTasksWithCpp,
    calculateOptimalBreaksWithCpp,
    prioritizeTasksWithCpp,
    // 新增功能
    getSmartSuggestions,
    comparePlans,
    saveTemplate,
    loadTemplate,
    listTemplates,
    deleteTemplate,
    createBatchPlans,
    // 优化后的函数
    parsePlanArgumentsOptimized,
    breakDownIntoTasksOptimized,
    createPlanConfigOptimized,
    // 辅助函数
    getAutocompleteSuggestions,
    addToPlanHistory,
    getPlanHistory,
    SimpleCache,
    loadTemplatesFromStorage,
    saveTemplatesToStorage,
    // ADHD support
    ADHDPlanSupport
  };
}
