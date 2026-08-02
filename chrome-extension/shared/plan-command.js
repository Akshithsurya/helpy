"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MUSIC_GENRES_DEFAULT = exports.MUSIC_SOURCE_WHITELIST = exports.MUSIC_PRESET_METADATA = exports.ADHDPlanSupport = exports.SimpleCache = exports.prioritizeTasksWithCpp = exports.calculateOptimalBreaksWithCpp = exports.scheduleTasksWithCpp = exports.calculateProductivityScoreWithCpp = exports.calculateAnalyticsWithCpp = exports.optimizeTaskDistributionWithCpp = exports.validatePlanWithCpp = exports.processPlanWithCpp = exports.validatePlanArguments = exports.validatePlan = exports.DEFAULT_BREAK_MINUTES = exports.DEFAULT_CHUNK_SIZE_MINUTES = exports.DEFAULT_PLAN_DURATION_MINUTES = exports.MAX_PLAN_DURATION_MINUTES = exports.MIN_PLAN_DURATION_MINUTES = exports.breakDownIntoTasks = exports.DEFAULT_PRESETS = void 0;
exports.getDefaultPresets = getDefaultPresets;
exports.normalizeBoundedInt = normalizeBoundedInt;
exports.normalizeChunkSizeMinutes = normalizeChunkSizeMinutes;
exports.parsePlanArguments = parsePlanArguments;
exports.createPlanConfig = createPlanConfig;
exports.createPlanConfigBatch = createPlanConfigBatch;
exports.loadPresets = loadPresets;
exports.listPresets = listPresets;
exports.removeEmojis = removeEmojis;
exports.validateInput = validateInput;
exports.validatePlanInput = validatePlanInput;
exports.recordPerformance = recordPerformance;
exports.getPerformanceMetrics = getPerformanceMetrics;
exports.getAverageResponseTime = getAverageResponseTime;
exports.getErrorRate = getErrorRate;
exports.exportPlan = exportPlan;
exports.exportPlanEnhanced = exportPlanEnhanced;
exports.calculateSessionStats = calculateSessionStats;
exports.createBreakSchedule = createBreakSchedule;
exports.applyBreakSchedule = applyBreakSchedule;
exports.startPlan = startPlan;
exports.completePlan = completePlan;
exports.cancelPlan = cancelPlan;
exports.completeTask = completeTask;
exports.findPresetByName = findPresetByName;
exports.generateId = generateId;
exports.listShortcuts = listShortcuts;
exports.addShortcut = addShortcut;
exports.removeShortcut = removeShortcut;
exports.useShortcut = useShortcut;
exports.generateSmartRecommendation = generateSmartRecommendation;
exports.getSmartSuggestions = getSmartSuggestions;
exports.comparePlans = comparePlans;
exports.saveTemplate = saveTemplate;
exports.loadTemplate = loadTemplate;
exports.listTemplates = listTemplates;
exports.deleteTemplate = deleteTemplate;
exports.createBatchPlans = createBatchPlans;
exports.parsePlanArgumentsOptimized = parsePlanArgumentsOptimized;
exports.breakDownIntoTasksOptimized = breakDownIntoTasksOptimized;
exports.createPlanConfigOptimized = createPlanConfigOptimized;
exports.getAutocompleteSuggestions = getAutocompleteSuggestions;
exports.addToPlanHistory = addToPlanHistory;
exports.getPlanHistory = getPlanHistory;
exports.loadTemplatesFromStorage = loadTemplatesFromStorage;
exports.saveTemplatesToStorage = saveTemplatesToStorage;
const yaml_loader_1 = require("../../src/utils/yaml-loader");
const plan_validator_1 = require("./plan-validator");
Object.defineProperty(exports, "validatePlan", { enumerable: true, get: function () { return plan_validator_1.validatePlan; } });
Object.defineProperty(exports, "validatePlanArguments", { enumerable: true, get: function () { return plan_validator_1.validatePlanArguments; } });
const axios_1 = __importDefault(require("axios"));
const performance_1 = require("../../src/utils/performance");
const cache_1 = require("../../src/utils/cache");
const MIN_PLAN_DURATION_MINUTES = 5;
exports.MIN_PLAN_DURATION_MINUTES = MIN_PLAN_DURATION_MINUTES;
const MAX_PLAN_DURATION_MINUTES = 240;
exports.MAX_PLAN_DURATION_MINUTES = MAX_PLAN_DURATION_MINUTES;
const DEFAULT_PLAN_DURATION_MINUTES = 30;
exports.DEFAULT_PLAN_DURATION_MINUTES = DEFAULT_PLAN_DURATION_MINUTES;
const DEFAULT_CHUNK_SIZE_MINUTES = 15;
exports.DEFAULT_CHUNK_SIZE_MINUTES = DEFAULT_CHUNK_SIZE_MINUTES;
const DEFAULT_BREAK_MINUTES = 5;
exports.DEFAULT_BREAK_MINUTES = DEFAULT_BREAK_MINUTES;
// 6 music focus presets (mirrors PlanParser.php + CoffeeScript MUSIC_PRESETS constant)
const MUSIC_PRESET_METADATA = {
    'lofi-focus': { title: 'Lo-fi Focus Session', duration: 90, goal: 'Ambient focus', musicPreset: 'lofi', genre: 'ambient', source: 'all' },
    'classical-study': { title: 'Classical Study Session', duration: 60, goal: 'Deep study', musicPreset: 'classical', genre: 'classical', source: 'all' },
    'white-noise': { title: 'White Noise Session', duration: 120, goal: 'Noise isolation', musicPreset: 'noise', genre: 'noise', source: 'local' },
    'binaural': { title: 'Binaural Focus Session', duration: 45, goal: 'Binaural focus', musicPreset: 'binaural', genre: 'binaural', source: 'local' },
    'ambient-code': { title: 'Ambient Coding Session', duration: 120, goal: 'Flow coding', musicPreset: 'ambient', genre: 'electronic', source: 'all' },
    'energize': { title: 'Energize Sprint', duration: 25, goal: 'Upbeat energy', musicPreset: 'upbeat', genre: 'electronic', source: 'all' },
};
exports.MUSIC_PRESET_METADATA = MUSIC_PRESET_METADATA;
const MUSIC_SOURCE_WHITELIST = Object.freeze([
    'local', 'youtube', 'spotify', 'soundcloud', 'all',
]);
exports.MUSIC_SOURCE_WHITELIST = MUSIC_SOURCE_WHITELIST;
const MUSIC_GENRES_DEFAULT = Object.freeze([
    'ambient', 'classical', 'noise', 'binaural', 'electronic', 'lofi',
    'jazz', 'instrumental', 'soundtrack', 'blues', 'folk', 'rock', 'pop',
]);
exports.MUSIC_GENRES_DEFAULT = MUSIC_GENRES_DEFAULT;
const TASK_DESCRIPTORS = Object.freeze([
    'Start strong', 'Keep going', 'Making progress', 'Almost there', 'Final push',
]);
const EMOJI_REGEX = /[\u{1F000}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu;
let _taskIdCounter = 0;
const _nextTaskId = () => ++_taskIdCounter;
let _mergedPresetsBuilt = false;
let _mergedPresets = null;
let _presetNamesSortedByLength = [];
let _musicPresetMetadataMap = null;
function _ensurePresetsBuilt() {
    if (_mergedPresetsBuilt)
        return;
    _mergedPresets = new Map();
    Object.keys(DEFAULT_PRESETS).forEach((name) => {
        const p = DEFAULT_PRESETS[name];
        const base = { title: p.title, durationMinutes: p.duration, goal: p.goal };
        if (name in MUSIC_PRESET_METADATA) {
            const md = MUSIC_PRESET_METADATA[name];
            base.musicPreset = md.musicPreset;
            base.genre = md.genre;
            base.source = md.source;
        }
        _mergedPresets.set(name.toLowerCase(), base);
    });
    const yamlPresets = loadPresets();
    yamlPresets.forEach((p) => {
        const key = p.name.toLowerCase();
        if (!_mergedPresets.has(key)) {
            _mergedPresets.set(key, {
                title: p.title, durationMinutes: p.durationMinutes, goal: p.goal, chunkSizeMinutes: p.chunkSizeMinutes,
            });
        }
    });
    _presetNamesSortedByLength = Object.freeze(Array.from(_mergedPresets.keys()).sort((a, b) => b.length - a.length));
    _musicPresetMetadataMap = new Map();
    Object.keys(MUSIC_PRESET_METADATA).forEach((k) => _musicPresetMetadataMap.set(k, MUSIC_PRESET_METADATA[k]));
    _mergedPresetsBuilt = true;
}
const _parseCache = new cache_1.Cache(5000, 200);
const _taskBreakdownCache = new cache_1.Cache(60000, 50);
const _emojiRemoveCache = new cache_1.Cache(10000, 500);
let _erlangAvailable = true;
let _erlangUnavailableUntil = 0;
function _isErlangAvailable() {
    if (!_erlangAvailable && Date.now() < _erlangUnavailableUntil)
        return false;
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
const DEFAULT_PRESETS = {
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
    'lofi-focus': { title: MUSIC_PRESET_METADATA['lofi-focus'].title, duration: MUSIC_PRESET_METADATA['lofi-focus'].duration, goal: MUSIC_PRESET_METADATA['lofi-focus'].goal },
    'classical-study': { title: MUSIC_PRESET_METADATA['classical-study'].title, duration: MUSIC_PRESET_METADATA['classical-study'].duration, goal: MUSIC_PRESET_METADATA['classical-study'].goal },
    'white-noise': { title: MUSIC_PRESET_METADATA['white-noise'].title, duration: MUSIC_PRESET_METADATA['white-noise'].duration, goal: MUSIC_PRESET_METADATA['white-noise'].goal },
    'binaural': { title: MUSIC_PRESET_METADATA['binaural'].title, duration: MUSIC_PRESET_METADATA['binaural'].duration, goal: MUSIC_PRESET_METADATA['binaural'].goal },
    'ambient-code': { title: MUSIC_PRESET_METADATA['ambient-code'].title, duration: MUSIC_PRESET_METADATA['ambient-code'].duration, goal: MUSIC_PRESET_METADATA['ambient-code'].goal },
    'energize': { title: MUSIC_PRESET_METADATA['energize'].title, duration: MUSIC_PRESET_METADATA['energize'].duration, goal: MUSIC_PRESET_METADATA['energize'].goal },
};
exports.DEFAULT_PRESETS = DEFAULT_PRESETS;
let cachedPresets = null;
// Performance metrics storage
let performanceMetrics = [];
function getDefaultPresets() {
    return { ...DEFAULT_PRESETS };
}
function normalizeBoundedMinutes(value, fallback, min = MIN_PLAN_DURATION_MINUTES, max = MAX_PLAN_DURATION_MINUTES) {
    const parsedValue = Number.parseInt(value, 10);
    if (!Number.isFinite(parsedValue)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsedValue));
}
function normalizeChunkSizeMinutes(value, fallback = DEFAULT_CHUNK_SIZE_MINUTES) {
    return normalizeBoundedMinutes(value, fallback, MIN_PLAN_DURATION_MINUTES, 60);
}
function normalizeBoundedInt(value, fallback, min = MIN_PLAN_DURATION_MINUTES, max = MAX_PLAN_DURATION_MINUTES) {
    return normalizeBoundedMinutes(value, fallback, min, max);
}
// Input validation functions
function removeEmojis(text) {
    if (typeof text !== 'string' || text.length === 0)
        return '';
    const k = 'e:' + (0, performance_1.cyrb53)(text);
    const hit = _emojiRemoveCache.get(k);
    if (hit !== undefined)
        return hit;
    const out = text.replace(EMOJI_REGEX, '').replace(/\s+/g, ' ').trim();
    _emojiRemoveCache.set(k, out);
    return out;
}
function validateInput(input, maxLength = 100) {
    if (typeof input !== 'string')
        return '';
    let sanitized = removeEmojis(input.trim());
    // Remove potentially dangerous characters
    sanitized = sanitized.replace(/[<>]/g, '');
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }
    return sanitized;
}
function validatePlanInput(title, goal) {
    const errors = [];
    const warnings = [];
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
function generateId() {
    return `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
function parsePlanArgumentsUncached(args = '') {
    try {
        const normalizedArgs = typeof args === 'string' ? args : '';
        let remainingArgs = normalizedArgs.trim();
        let title = 'Planned session';
        let durationMinutes = DEFAULT_PLAN_DURATION_MINUTES;
        let goal = '';
        let usedPreset = null;
        let chunkSizeMinutes = undefined;
        let breakMinutes = undefined;
        let tags = [];
        let musicPreset = null;
        let playlistId = null;
        let musicSource = null;
        let genre = null;
        const COMBINED_FLAGS_REGEX = /--(goal|chunk|break|tags|music|playlist|source|genre)\s+("([^"]+)"|'([^']+)'|(\S+))/gi;
        const flagMatches = [];
        for (const match of remainingArgs.matchAll(COMBINED_FLAGS_REGEX)) {
            const name = match[1];
            const value = match[3] !== undefined ? match[3].trim() : match[4] !== undefined ? match[4].trim() : match[5] !== undefined ? match[5].trim() : '';
            flagMatches.push({ match, name, value, fullSpan: match[0] });
        }
        for (const fm of flagMatches) {
            if (fm.name === 'goal') {
                goal = validateInput(fm.value, 500);
            }
            else if (fm.name === 'chunk') {
                chunkSizeMinutes = Number.parseInt(fm.value, 10);
            }
            else if (fm.name === 'break') {
                breakMinutes = Number.parseInt(fm.value, 10);
            }
            else if (fm.name === 'tags') {
                const tagsStr = validateInput(fm.value, 200);
                tags = tagsStr.split(',').map(t => validateInput(t, 40)).filter(t => t);
            }
            else if (fm.name === 'music') {
                const raw = validateInput(fm.value, 60);
                if (raw.length > 0 && raw in MUSIC_PRESET_METADATA)
                    musicPreset = raw;
                else if (raw.length > 0)
                    musicPreset = raw;
            }
            else if (fm.name === 'playlist') {
                const raw = validateInput(fm.value, 100);
                if (raw.length > 0)
                    playlistId = raw;
            }
            else if (fm.name === 'source') {
                const raw = validateInput(fm.value, 30).toLowerCase();
                if (raw.length > 0 && MUSIC_SOURCE_WHITELIST.includes(raw)) {
                    musicSource = raw;
                }
            }
            else if (fm.name === 'genre') {
                const raw = validateInput(fm.value, 40);
                if (raw.length > 0)
                    genre = raw;
            }
            remainingArgs = remainingArgs.replace(fm.fullSpan, '').trim();
        }
        const parts = remainingArgs ? remainingArgs.split(/\s+/) : [];
        if (remainingArgs && _mergedPresets && _mergedPresetsBuilt) {
            const lowerTrimmedArgs = remainingArgs.toLowerCase();
            const matchedPresetName = _presetNamesSortedByLength.find(name => lowerTrimmedArgs === name || lowerTrimmedArgs.startsWith(`${name} `));
            if (matchedPresetName) {
                const preset = _mergedPresets.get(matchedPresetName);
                title = preset.title;
                durationMinutes = preset.durationMinutes;
                if (!goal)
                    goal = preset.goal;
                usedPreset = matchedPresetName;
                if (preset.chunkSizeMinutes && !chunkSizeMinutes)
                    chunkSizeMinutes = preset.chunkSizeMinutes;
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
                }
                else {
                    parts.length = 0;
                }
            }
        }
        if (parts.length > 0) {
            const partsStr = parts.join(' ');
            let totalMinutes = 0;
            let durationFound = false;
            let matchedDurationPart = '';
            const unitPatterns = [
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
                        }
                        else if (pattern === unitPatterns[1]) {
                            minutes = match[1] ? Number.parseInt(match[1], 10) : 0;
                        }
                        else if (pattern === unitPatterns[2]) {
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
                }
                catch (error) {
                    console.warn('Error parsing duration pattern:', error);
                }
            }
            if (durationFound) {
                const customTitle = partsStr.replace(matchedDurationPart, '').trim();
                if (customTitle) {
                    title = validateInput(customTitle, 100);
                }
            }
            else {
                title = validateInput(partsStr, 100);
            }
        }
        else {
            title = validateInput(title, 100);
        }
        if (goal)
            goal = validateInput(goal, 500);
        durationMinutes = normalizeBoundedMinutes(durationMinutes, DEFAULT_PLAN_DURATION_MINUTES, MIN_PLAN_DURATION_MINUTES, MAX_PLAN_DURATION_MINUTES);
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
    }
    catch (error) {
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
function parsePlanArguments(args = '') {
    try {
        _ensurePresetsBuilt();
    }
    catch (_) { }
    const k = 'p:' + (0, performance_1.cyrb53)(args ?? '');
    const cached = _parseCache.get(k);
    if (cached)
        return cached;
    const result = parsePlanArgumentsUncached(args);
    _parseCache.set(k, result);
    return result;
}
function loadPresets() {
    if (cachedPresets === null) {
        cachedPresets = (0, yaml_loader_1.loadPlanPresets)() || [];
    }
    return cachedPresets || [];
}
function listPresets() {
    return loadPresets().slice();
}
function findPresetByName(name) {
    try {
        _ensurePresetsBuilt();
    }
    catch (_) { }
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
            };
        }
    }
    const presets = loadPresets();
    return presets.find(p => p.name.toLowerCase() === lowerName);
}
function breakDownIntoTasksUncached(planConfig = {}, chunkSizeMinutes = DEFAULT_CHUNK_SIZE_MINUTES, breakMinutes = DEFAULT_BREAK_MINUTES, includeBreaks = false) {
    const totalDuration = normalizeBoundedMinutes(planConfig.durationMinutes, DEFAULT_PLAN_DURATION_MINUTES, MIN_PLAN_DURATION_MINUTES, MAX_PLAN_DURATION_MINUTES);
    const normalizedChunkSizeMinutes = normalizeChunkSizeMinutes(chunkSizeMinutes);
    const goal = planConfig.goal || planConfig.title || '';
    const chunkCount = Math.ceil(totalDuration / normalizedChunkSizeMinutes);
    const estimate = includeBreaks ? chunkCount + (chunkCount - 1) : chunkCount;
    const result = new Array(Math.max(0, estimate));
    let writeIdx = 0;
    let remainingDuration = totalDuration;
    let chunkIndex = 0;
    while (remainingDuration > 0) {
        const chunkDuration = Math.min(normalizedChunkSizeMinutes, remainingDuration);
        const descriptorIndex = chunkIndex < TASK_DESCRIPTORS.length ? chunkIndex : TASK_DESCRIPTORS.length - 1;
        let taskTitle;
        if (goal) {
            taskTitle = `${TASK_DESCRIPTORS[descriptorIndex]}: ${goal}`;
        }
        else {
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
function breakDownIntoTasksCached(planConfig = {}, chunkSizeMinutes = DEFAULT_CHUNK_SIZE_MINUTES, breakMinutes = DEFAULT_BREAK_MINUTES, includeBreaks = false) {
    const key = `${planConfig.durationMinutes ?? 0}:${chunkSizeMinutes}:${breakMinutes}:${includeBreaks ? 1 : 0}:${(0, performance_1.cyrb53)((planConfig.goal || '') + '|' + (planConfig.title || ''))}`;
    const cached = _taskBreakdownCache.get(key);
    if (cached)
        return cached;
    const result = breakDownIntoTasksUncached(planConfig, chunkSizeMinutes, breakMinutes, includeBreaks);
    _taskBreakdownCache.set(key, result);
    return result;
}
const breakDownIntoTasks = breakDownIntoTasksCached;
exports.breakDownIntoTasks = breakDownIntoTasks;
function normalizeAssistantPlanDraft(rawDraft = {}, options = {}) {
    const normalizedDraft = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
    const durationMinutes = normalizeBoundedInt(normalizedDraft.durationMinutes, DEFAULT_PLAN_DURATION_MINUTES, MIN_PLAN_DURATION_MINUTES, MAX_PLAN_DURATION_MINUTES);
    const chunkSizeMinutes = normalizeChunkSizeMinutes(normalizedDraft.chunkSizeMinutes, durationMinutes <= 30 ? 15 : durationMinutes <= 60 ? 20 : 25);
    const breakMinutes = normalizeBoundedMinutes(normalizedDraft.breakMinutes, durationMinutes >= 90 ? 10 : DEFAULT_BREAK_MINUTES, 1, 30);
    const title = validateInput(normalizedDraft.title || options.title || 'Planned session', 100) ||
        'Planned session';
    const goal = validateInput(normalizedDraft.goal || options.goal || title, 500);
    const tags = Array.isArray(normalizedDraft.tags)
        ? normalizedDraft.tags.map((tag) => validateInput(String(tag), 40)).filter(Boolean)
        : [];
    const draftTasks = Array.isArray(normalizedDraft.tasks) ? normalizedDraft.tasks : [];
    const fallbackTaskDuration = Math.max(MIN_PLAN_DURATION_MINUTES, Math.round(durationMinutes / Math.max(1, draftTasks.length || 1)));
    const normalizedTasks = draftTasks
        .map((task, index) => {
        const taskTitle = typeof task === 'string'
            ? validateInput(task, 100)
            : validateInput(String(task?.title || task?.name || ''), 100);
        if (!taskTitle)
            return null;
        return {
            id: typeof task === 'object' && typeof task?.id === 'string' && task.id.trim()
                ? task.id.trim()
                : `task-${_nextTaskId()}-assistant-${index}`,
            title: taskTitle,
            durationMinutes: normalizeBoundedMinutes(typeof task === 'object' ? task?.durationMinutes : undefined, fallbackTaskDuration, MIN_PLAN_DURATION_MINUTES, 120),
            completed: false,
            completedAt: null,
            isBreak: Boolean(typeof task === 'object' && task?.isBreak),
        };
    })
        .filter(Boolean);
    return {
        title,
        goal,
        durationMinutes,
        chunkSizeMinutes,
        breakMinutes,
        tasks: normalizedTasks.length > 0
            ? normalizedTasks
            : breakDownIntoTasks({ title, goal, durationMinutes }, chunkSizeMinutes, breakMinutes, false),
        source: typeof options.source === 'string' && options.source.trim()
            ? options.source.trim()
            : 'assistant',
        createdAt: typeof options.createdAt === 'string' && options.createdAt.trim()
            ? options.createdAt
            : new Date().toISOString(),
        status: 'pending',
        tags,
        nextQueue: Array.isArray(options.nextQueue) ? options.nextQueue : [],
        theme: options.theme,
        icon: options.icon,
    };
}
function createPlanConfigUncached(planArgs = '', options = {}) {
    try {
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        const parsed = parsePlanArguments(planArgs);
        const now = new Date();
        const nowIso = now.toISOString();
        const chunkSizeMinutes = normalizeChunkSizeMinutes(normalizedOptions.chunkSizeMinutes !== undefined
            ? normalizedOptions.chunkSizeMinutes
            : parsed.chunkSizeMinutes, DEFAULT_CHUNK_SIZE_MINUTES);
        const breakMinutes = normalizeBoundedMinutes(normalizedOptions.breakMinutes !== undefined
            ? normalizedOptions.breakMinutes
            : parsed.breakMinutes, DEFAULT_BREAK_MINUTES, 1, 30);
        const createdAt = typeof normalizedOptions.createdAt === 'string' && normalizedOptions.createdAt.trim()
            ? normalizedOptions.createdAt
            : nowIso;
        const source = typeof normalizedOptions.source === 'string' && normalizedOptions.source.trim()
            ? normalizedOptions.source.trim()
            : 'extension';
        const nextQueue = Array.isArray(normalizedOptions.nextQueue)
            ? normalizedOptions.nextQueue.filter(item => typeof item === 'string' && item.trim())
            : [];
        const title = typeof normalizedOptions.title === 'string' && normalizedOptions.title.trim()
            ? normalizedOptions.title.trim()
            : parsed.title;
        const goal = typeof normalizedOptions.goal === 'string' && normalizedOptions.goal.trim()
            ? normalizedOptions.goal.trim()
            : parsed.goal;
        const durationMinutes = normalizeBoundedInt(normalizedOptions.durationMinutes, parsed.durationMinutes, MIN_PLAN_DURATION_MINUTES, MAX_PLAN_DURATION_MINUTES);
        const tags = Array.isArray(normalizedOptions.tags)
            ? normalizedOptions.tags.filter(t => typeof t === 'string' && t.trim())
            : (parsed.tags || []);
        const tasks = breakDownIntoTasks({
            title,
            goal,
            durationMinutes,
        }, chunkSizeMinutes, breakMinutes, !!normalizedOptions.includeBreaks);
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
    }
    catch (error) {
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
function createPlanConfig(planArgs = '', options = {}) {
    const plan = createPlanConfigUncached(planArgs, options);
    try {
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
            Object.freeze(plan);
        }
    }
    catch (_) { }
    return plan;
}
function createPlanConfigBatch(count, templateArgs = '', sharedOptions = {}) {
    const results = [];
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
function startPlan(plan) {
    return {
        ...plan,
        status: 'in_progress',
        startedAt: new Date().toISOString()
    };
}
function completePlan(plan) {
    return {
        ...plan,
        status: 'completed',
        completedAt: new Date().toISOString(),
        tasks: plan.tasks.map((task) => ({ ...task, completed: true, completedAt: new Date().toISOString() }))
    };
}
function cancelPlan(plan) {
    return {
        ...plan,
        status: 'cancelled',
        cancelledAt: new Date().toISOString()
    };
}
function completeTask(plan, taskId) {
    return {
        ...plan,
        tasks: plan.tasks.map((task) => {
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
function createBreakSchedule(enabled = true, breakMinutes = 5, longBreakMinutes, longBreakInterval) {
    return {
        enabled,
        breakMinutes,
        longBreakMinutes,
        longBreakInterval
    };
}
function applyBreakSchedule(plan, schedule) {
    if (!schedule.enabled) {
        return plan;
    }
    const tasks = breakDownIntoTasks(plan, plan.chunkSizeMinutes, schedule.breakMinutes, true);
    return {
        ...plan,
        tasks,
        breakMinutes: schedule.breakMinutes
    };
}
function calculateSessionStats(plan) {
    const totalTasks = plan.tasks.length;
    const tasksCompleted = plan.tasks.filter((t) => t.completed).length;
    const completionPercentage = totalTasks > 0 ? Math.round((tasksCompleted / totalTasks) * 100) : 0;
    const totalFocusMinutes = plan.tasks
        .filter((t) => !t.isBreak)
        .reduce((sum, t) => sum + t.durationMinutes, 0);
    return {
        totalFocusMinutes,
        totalTasks,
        tasksCompleted,
        completionPercentage,
        estimatedDurationMinutes: plan.durationMinutes
    };
}
function exportPlan(plan, options = {}) {
    const format = options.format || 'json';
    const includeTasks = options.includeTasks !== false;
    const includeMetadata = options.includeMetadata !== false;
    if (format === 'json') {
        let exportObj = { ...plan };
        if (!includeTasks) {
            delete exportObj.tasks;
        }
        if (!includeMetadata) {
            delete exportObj.createdAt;
            delete exportObj.source;
            delete exportObj.nextQueue;
        }
        return JSON.stringify(exportObj, null, 2);
    }
    else if (format === 'markdown') {
        let md = `# ${plan.title}\n\n`;
        if (plan.goal) {
            md += `## Goal\n${plan.goal}\n\n`;
        }
        md += `## Duration\n${plan.durationMinutes} minutes\n\n`;
        if (includeTasks && plan.tasks.length > 0) {
            md += `## Tasks\n\n`;
            plan.tasks.forEach((task) => {
                const status = task.completed ? '[x]' : '[ ]';
                md += `${status} ${task.title} (${task.durationMinutes} min)\n`;
            });
        }
        return md;
    }
    else { // text
        let text = `${plan.title}\n`;
        if (plan.goal) {
            text += `\nGoal: ${plan.goal}\n`;
        }
        text += `\nDuration: ${plan.durationMinutes} minutes\n`;
        if (includeTasks && plan.tasks.length > 0) {
            text += `\nTasks:\n`;
            plan.tasks.forEach((task) => {
                const status = task.completed ? '[x]' : '[ ]';
                text += `${status} ${task.title} (${task.durationMinutes} min)\n`;
            });
        }
        return text;
    }
}
// Enhanced export function with CSV support
function exportPlanEnhanced(plan, format = 'json') {
    if (format === 'csv') {
        let csv = 'Task ID,Title,Duration (min),Is Break,Completed\n';
        plan.tasks.forEach((task) => {
            csv += `"${task.id}","${task.title}",${task.durationMinutes},${task.isBreak},${task.completed}\n`;
        });
        return csv;
    }
    return exportPlan(plan, { format });
}
// Performance monitoring functions
function recordPerformance(commandName, startTime, success) {
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
function getAverageResponseTime() {
    if (performanceMetrics.length === 0)
        return 0;
    const totalMs = performanceMetrics.reduce((sum, m) => sum + (m.endTime - m.startTime), 0);
    return totalMs / performanceMetrics.length;
}
function getErrorRate() {
    if (performanceMetrics.length === 0)
        return 0;
    const errorCount = performanceMetrics.filter(m => !m.success).length;
    return errorCount / performanceMetrics.length;
}
const ERLANG_API_BASE = process.env.ERLANG_API_BASE || 'http://localhost:8080';
const processPlanWithCpp = async (planJson) => {
    if (!_isErlangAvailable()) {
        return planJson;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/process-plan`, { plan: planJson }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        console.log('C++ module not available, falling back to native processing');
        return planJson;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for plan processing:', error);
        return planJson;
    }
};
exports.processPlanWithCpp = processPlanWithCpp;
const validatePlanWithCpp = async (planJson) => {
    if (!_isErlangAvailable()) {
        return true;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/validate-plan`, { plan: planJson }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && typeof response.data.valid === 'boolean') {
            return response.data.valid;
        }
        return validatePlanInput('', '').valid;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for plan validation:', error);
        return true;
    }
};
exports.validatePlanWithCpp = validatePlanWithCpp;
const optimizeTaskDistributionWithCpp = async (planJson, workBlockMinutes, breakMinutes) => {
    if (!_isErlangAvailable()) {
        return null;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/optimize-tasks`, { plan: planJson, workBlockMinutes, breakMinutes }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        return null;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for task optimization:', error);
        return null;
    }
};
exports.optimizeTaskDistributionWithCpp = optimizeTaskDistributionWithCpp;
const calculateAnalyticsWithCpp = async (plans) => {
    if (!_isErlangAvailable()) {
        return null;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/calculate-analytics`, { plans }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        return null;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for analytics:', error);
        return null;
    }
};
exports.calculateAnalyticsWithCpp = calculateAnalyticsWithCpp;
const calculateProductivityScoreWithCpp = async (completedTasks) => {
    if (!_isErlangAvailable()) {
        return null;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/productivity-score`, { tasks: completedTasks }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        return null;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for productivity score:', error);
        return null;
    }
};
exports.calculateProductivityScoreWithCpp = calculateProductivityScoreWithCpp;
const scheduleTasksWithCpp = async (tasks, strategy) => {
    if (!_isErlangAvailable()) {
        return null;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/schedule-tasks`, { tasks, strategy }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        return null;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for task scheduling:', error);
        return null;
    }
};
exports.scheduleTasksWithCpp = scheduleTasksWithCpp;
const calculateOptimalBreaksWithCpp = async (totalWorkMinutes, preferredWorkBlock) => {
    if (!_isErlangAvailable()) {
        return null;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/optimal-breaks`, { totalWorkMinutes, preferredWorkBlock }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        return null;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for optimal breaks:', error);
        return null;
    }
};
exports.calculateOptimalBreaksWithCpp = calculateOptimalBreaksWithCpp;
const prioritizeTasksWithCpp = async (tasks, priorities) => {
    if (!_isErlangAvailable()) {
        return null;
    }
    try {
        const response = await Promise.race([
            axios_1.default.post(`${ERLANG_API_BASE}/api/cpp/prioritize-tasks`, { tasks, priorities }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), _erlangTimeoutMs)),
        ]);
        if (response.data && response.data.result) {
            return response.data.result;
        }
        return null;
    }
    catch (error) {
        _markErlangUnavailable();
        console.warn('Error calling C++ module for task prioritization:', error);
        return null;
    }
};
exports.prioritizeTasksWithCpp = prioritizeTasksWithCpp;
const shortcuts = [];
function addShortcut(name, command, description) {
    const shortcut = { id: generateId(), name, command, description, createdAt: Date.now(), usageCount: 0 };
    shortcuts.push(shortcut);
    return shortcut;
}
function listShortcuts() {
    return shortcuts.map((shortcut) => ({ ...shortcut }));
}
function removeShortcut(id) {
    const index = shortcuts.findIndex((shortcut) => shortcut.id === id);
    if (index === -1)
        return false;
    shortcuts.splice(index, 1);
    return true;
}
function useShortcut(id) {
    const shortcut = shortcuts.find((item) => item.id === id);
    if (shortcut)
        shortcut.usageCount += 1;
    return shortcut;
}
function generateSmartRecommendation(durationMinutes, workIntensity, userEnergy) {
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
class SimpleCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }
    set(key, value, expiryMs = 60000) {
        if (this.cache.size >= this.maxSize) {
            // 移除最早的条目
            const firstKey = this.cache.keys().next().value;
            if (firstKey)
                this.cache.delete(firstKey);
        }
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            expiryMs
        });
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.timestamp > entry.expiryMs) {
            this.cache.delete(key);
            return null;
        }
        return entry.value;
    }
    clear() {
        this.cache.clear();
    }
}
exports.SimpleCache = SimpleCache;
// 全局缓存实例
const parseArgumentsCache = new SimpleCache(50);
const taskBreakdownCache = new SimpleCache(30);
function getSmartSuggestions(context = {}) {
    const hour = context.hourOfDay || new Date().getHours();
    let productivityPrediction = 'medium';
    let bestTimeOfDay = 'morning (9-12 AM)';
    if (hour >= 9 && hour <= 12) {
        productivityPrediction = 'high';
        bestTimeOfDay = 'now (optimal time!)';
    }
    else if (hour >= 14 && hour <= 17) {
        productivityPrediction = 'medium';
        bestTimeOfDay = 'afternoon (2-5 PM)';
    }
    else if (hour >= 20 && hour <= 23) {
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
function comparePlans(plan1, plan2) {
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
let planTemplates = [];
const templatesStorageKey = 'helpy-plan-templates';
function loadTemplatesFromStorage() {
    if (typeof localStorage !== 'undefined') {
        try {
            const stored = localStorage.getItem(templatesStorageKey);
            if (stored) {
                planTemplates = JSON.parse(stored);
            }
        }
        catch (e) {
            console.error('Failed to load templates:', e);
        }
    }
}
function saveTemplatesToStorage() {
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(templatesStorageKey, JSON.stringify(planTemplates));
        }
        catch (e) {
            console.error('Failed to save templates:', e);
        }
    }
}
function saveTemplate(name, planConfig, description) {
    loadTemplatesFromStorage();
    const template = {
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
function loadTemplate(name) {
    loadTemplatesFromStorage();
    return planTemplates.find(t => t.name.toLowerCase() === name.toLowerCase()) || null;
}
function listTemplates() {
    loadTemplatesFromStorage();
    return [...planTemplates];
}
function deleteTemplate(name) {
    loadTemplatesFromStorage();
    const index = planTemplates.findIndex(t => t.name.toLowerCase() === name.toLowerCase());
    if (index >= 0) {
        planTemplates.splice(index, 1);
        saveTemplatesToStorage();
        return true;
    }
    return false;
}
function createBatchPlans(request) {
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
function parsePlanArgumentsOptimized(args = '') {
    const cacheKey = `parse:${args}`;
    const cached = parseArgumentsCache.get(cacheKey);
    if (cached)
        return cached;
    const result = parsePlanArguments(args);
    parseArgumentsCache.set(cacheKey, result, 30000); // 30秒缓存
    return result;
}
// 优化后的 breakDownIntoTasks - 添加缓存
function breakDownIntoTasksOptimized(planConfig = {}, chunkSizeMinutes = DEFAULT_CHUNK_SIZE_MINUTES, breakMinutes = DEFAULT_BREAK_MINUTES, includeBreaks = false) {
    const cacheKey = `tasks:${JSON.stringify(planConfig)}:${chunkSizeMinutes}:${breakMinutes}:${includeBreaks}`;
    const cached = taskBreakdownCache.get(cacheKey);
    if (cached)
        return cached;
    const result = breakDownIntoTasks(planConfig, chunkSizeMinutes, breakMinutes, includeBreaks);
    taskBreakdownCache.set(cacheKey, result, 60000); // 1分钟缓存
    return result;
}
// 优化后的 createPlanConfig
function createPlanConfigOptimized(planArgs = '', options = {}) {
    const startTime = Date.now();
    try {
        const normalizedOptions = options && typeof options === 'object' ? options : {};
        const parsed = parsePlanArgumentsOptimized(planArgs);
        const chunkSizeMinutes = normalizeChunkSizeMinutes(normalizedOptions.chunkSizeMinutes !== undefined
            ? normalizedOptions.chunkSizeMinutes
            : parsed.chunkSizeMinutes, DEFAULT_CHUNK_SIZE_MINUTES);
        const breakMinutes = normalizeBoundedMinutes(normalizedOptions.breakMinutes !== undefined
            ? normalizedOptions.breakMinutes
            : parsed.breakMinutes, DEFAULT_BREAK_MINUTES, 1, 30);
        const createdAt = typeof normalizedOptions.createdAt === 'string' && normalizedOptions.createdAt.trim()
            ? normalizedOptions.createdAt
            : new Date().toISOString();
        const source = typeof normalizedOptions.source === 'string' && normalizedOptions.source.trim()
            ? normalizedOptions.source.trim()
            : 'extension';
        const nextQueue = Array.isArray(normalizedOptions.nextQueue)
            ? normalizedOptions.nextQueue.filter(item => typeof item === 'string' && item.trim())
            : [];
        const title = typeof normalizedOptions.title === 'string' && normalizedOptions.title.trim()
            ? normalizedOptions.title.trim()
            : parsed.title;
        const goal = typeof normalizedOptions.goal === 'string' && normalizedOptions.goal.trim()
            ? normalizedOptions.goal.trim()
            : parsed.goal;
        const durationMinutes = normalizeBoundedInt(normalizedOptions.durationMinutes, parsed.durationMinutes, MIN_PLAN_DURATION_MINUTES, MAX_PLAN_DURATION_MINUTES);
        const tags = Array.isArray(normalizedOptions.tags)
            ? normalizedOptions.tags.filter(t => typeof t === 'string' && t.trim())
            : (parsed.tags || []);
        const tasks = breakDownIntoTasksOptimized({
            title,
            goal,
            durationMinutes,
        }, chunkSizeMinutes, breakMinutes, !!normalizedOptions.includeBreaks);
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
        return result;
    }
    catch (error) {
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
function getAutocompleteSuggestions(args = '') {
    const suggestions = [];
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
const planHistory = [];
const MAX_HISTORY_SIZE = 50;
function addToPlanHistory(plan) {
    planHistory.unshift(plan);
    if (planHistory.length > MAX_HISTORY_SIZE) {
        planHistory.pop();
    }
}
function getPlanHistory() {
    return [...planHistory];
}
class ADHDPlanSupport {
    static createFocusTimer(config = {}) {
        return {
            durationMinutes: config.durationMinutes || 25,
            distractionPromptsEnabled: config.distractionPromptsEnabled !== false,
            promptIntervalMinutes: config.promptIntervalMinutes || 15,
            customPrompts: config.customPrompts || this.defaultDistractionPrompts
        };
    }
    static decomposeToMicroTasks(task, maxMicroTaskMinutes = 5) {
        const microTasks = [];
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
    static getSensoryReminders() {
        return [...this.defaultSensoryReminders];
    }
    static createTransitionChecklist(fromTask, toTask) {
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
    static getVisualTaskTrackingData(tasks) {
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
exports.ADHDPlanSupport = ADHDPlanSupport;
ADHDPlanSupport.defaultDistractionPrompts = [
    "Take a 10-second pause",
    "What's one small step you can take right now?",
    "Remember your goal for this session",
    "Take a deep breath and refocus"
];
ADHDPlanSupport.defaultSensoryReminders = [
    { id: 'breathing-1', type: 'breathing', message: 'Take 3 deep breaths', intervalMinutes: 30, enabled: true },
    { id: 'stretch-1', type: 'stretch', message: 'Stretch your arms and shoulders', intervalMinutes: 60, enabled: true },
    { id: 'hydration-1', type: 'hydration', message: 'Drink some water', intervalMinutes: 90, enabled: true }
];
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
        validatePlan: plan_validator_1.validatePlan,
        validatePlanArguments: plan_validator_1.validatePlanArguments,
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
