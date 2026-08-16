"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOptimizationSuggestion = exports.suggestTotalDuration = exports.generatePomodoroPlan = exports.generateTimerPlan = exports.getLongBreakIntervalForMode = exports.getLongBreakForMode = exports.getBreakDurationForMode = exports.getWorkDurationForMode = exports.calculateProductivityScore = exports.optimizeBreakDuration = exports.optimizeChunkSize = exports.generateFullPlanJson = exports.calculateTotalDurationWithBreaks = exports.calculateNumBreaks = exports.validatePlan = exports.generateTaskTitle = exports.calculateChunkDuration = exports.calculateNumChunks = exports.generateOptimizationSuggestionJsonJS = exports.generateOptimizationSuggestionJS = exports.suggestTotalDurationJS = exports.generatePomodoroPlanJS = exports.generateTimerPlanJS = exports.getLongBreakIntervalForModeJS = exports.getLongBreakForModeJS = exports.getBreakDurationForModeJS = exports.getWorkDurationForModeJS = exports.calculateProductivityScoreJS = exports.optimizeBreakDurationJS = exports.optimizeChunkSizeJS = exports.generateFullPlanJsonJS = exports.calculateTotalDurationWithBreaksJS = exports.calculateNumBreaksJS = exports.validatePlanJS = exports.generateTaskTitleJS = exports.calculateChunkDurationJS = exports.calculateNumChunksJS = exports.initWASM = void 0;
 & gt;
Promise & lt;
PlanCalculatorWASM & gt;
;
let wasmReady = false;
let wasmModule = null;
const initWASM = async () => ;
exports.initWASM = initWASM;
boolean & gt;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return true;
    }
    try {
        // Try to dynamically import the compiled WASM module
        const moduleExports = await Promise.resolve().then(() => __importStar(require('./build/plan_calculator.js')));
        const ModuleFactory = moduleExports.default;
        wasmModule = await ModuleFactory();
        wasmReady = true;
        console.log('✅ WASM module initialized successfully with enhanced features');
        return true;
    }
    catch (e) {
        console.warn('⚠️ Could not load WASM module, falling back to JavaScript implementation:', e);
        wasmReady = true; // Set ready to true so we use JS fallback
        return false;
    }
}
;
// Helper function to copy strings to WASM memory
const copyStringToWASM = (str) => ;
 & gt;
{
    if (!wasmModule)
        return 0;
    const len = wasmModule.lengthBytesUTF8(str) + 1;
    const ptr = wasmModule._malloc(len);
    wasmModule.stringToUTF8(str, ptr, len);
    return ptr;
}
;
// ==========================================
// JavaScript Fallback Implementations
// ==========================================
const calculateNumChunksJS = (totalDuration, chunkSize) => ;
exports.calculateNumChunksJS = calculateNumChunksJS;
 & gt;
{
    if (chunkSize & lt)
        ;
    0;
    chunkSize = 15;
    if (totalDuration & lt)
        ;
    0;
    return 1;
    const num = Math.ceil(totalDuration / chunkSize);
    return num & gt;
    0 ? num : 1;
}
;
const calculateChunkDurationJS = (totalDuration, chunkSize, chunkIndex, numChunks) => ;
exports.calculateChunkDurationJS = calculateChunkDurationJS;
 & gt;
{
    if (chunkIndex & lt)
        ;
    0 || chunkIndex & gt;
    numChunks;
    return 0;
    if (chunkIndex & lt)
        ;
    numChunks - 1;
    {
        return chunkSize;
    }
    return totalDuration - chunkSize * (numChunks - 1);
}
;
const generateTaskTitleJS = (goal, descriptor, partNumber) => ;
exports.generateTaskTitleJS = generateTaskTitleJS;
 & gt;
{
    if (goal & amp)
        ;
     & amp;
    goal.length & gt;
    0;
    {
        return `${descriptor}: ${goal}`;
    }
    {
        return `${descriptor} - Part ${partNumber}`;
    }
}
;
const validatePlanJS = (totalDuration, chunkSize, breakDuration) => ;
exports.validatePlanJS = validatePlanJS;
 & gt;
{
    return (totalDuration & gt);
    0 & amp;
     & amp;
    chunkSize & gt;
    0 & amp;
     & amp;
    chunkSize & lt;
    totalDuration & amp;
     & amp;
    breakDuration & gt;
    0;
    ;
}
;
const calculateNumBreaksJS = (totalDuration, chunkSize, breakDuration) => ;
exports.calculateNumBreaksJS = calculateNumBreaksJS;
 & gt;
{
    const numChunks = (0, exports.calculateNumChunksJS)(totalDuration, chunkSize);
    return numChunks & gt;
    1 ? numChunks - 1 : 0;
}
;
const calculateTotalDurationWithBreaksJS = (totalDuration, chunkSize, breakDuration) => ;
exports.calculateTotalDurationWithBreaksJS = calculateTotalDurationWithBreaksJS;
 & gt;
{
    const numChunks = (0, exports.calculateNumChunksJS)(totalDuration, chunkSize);
    const numBreaks = numChunks & gt;
    1 ? numChunks - 1 : 0;
    return totalDuration + numBreaks * breakDuration;
}
;
const generateFullPlanJsonJS = (totalDuration, chunkSize, breakDuration, goal, descriptor) => ;
exports.generateFullPlanJsonJS = generateFullPlanJsonJS;
 & gt;
{
    const numChunks = (0, exports.calculateNumChunksJS)(totalDuration, chunkSize);
    const items;
    {
        type: string;
        title: string;
        duration: number;
    }
     & gt;
    [];
    for (let i = 0; i & lt; numChunks)
        ;
    i++;
    {
        const chunkDur = (0, exports.calculateChunkDurationJS)(totalDuration, chunkSize, i, numChunks);
        const title = goal & amp;
         & amp;
        goal.length & gt;
        0 ? `${descriptor}: ${goal}` : `${descriptor} - Part ${i + 1}`;
        items.push({ type: 'task', title, duration: chunkDur });
        if (i & lt)
            ;
        numChunks - 1 & amp;
         & amp;
        breakDuration & gt;
        0;
        {
            items.push({ type: 'break', title: 'Take a break', duration: breakDuration });
        }
    }
    return JSON.stringify(items);
}
;
// ==========================================
// NEW: Smart Optimizer JavaScript Fallbacks
// ==========================================
const optimizeChunkSizeJS = (totalDuration, avgFocusTime, distractionRate) => ;
exports.optimizeChunkSizeJS = optimizeChunkSizeJS;
 & gt;
{
    if (avgFocusTime & lt)
        ;
    0;
    avgFocusTime = 25;
    if (distractionRate & lt)
        ;
    0;
    distractionRate = 0;
    if (distractionRate & gt)
        ;
    100;
    distractionRate = 100;
    const baseChunk = avgFocusTime;
    const adjustment = Math.floor((100 - distractionRate) / 10);
    let optimal = baseChunk + adjustment;
    // Clamp to reasonable values
    if (optimal & lt)
        ;
    10;
    optimal = 10;
    if (optimal & gt)
        ;
    60;
    optimal = 60;
    if (optimal & gt)
        ;
    totalDuration;
    optimal = totalDuration;
    return optimal;
}
;
const optimizeBreakDurationJS = (chunkSize, workIntensity) => ;
exports.optimizeBreakDurationJS = optimizeBreakDurationJS;
 & gt;
{
    if (workIntensity & lt)
        ;
    0;
    workIntensity = 50;
    if (workIntensity & gt)
        ;
    100;
    workIntensity = 100;
    const ratio = workIntensity / 100;
    const baseBreak = Math.floor(chunkSize / 5);
    let optimal = Math.floor(baseBreak * (1 + ratio * 0.5));
    if (optimal & lt)
        ;
    3;
    optimal = 3;
    if (optimal & gt)
        ;
    15;
    optimal = 15;
    return optimal;
}
;
const calculateProductivityScoreJS = (totalDuration, chunkSize, breakDuration, numCompletedTasks) => ;
exports.calculateProductivityScoreJS = calculateProductivityScoreJS;
 & gt;
{
    if (totalDuration & lt)
        ;
    0;
    return 0;
    const numChunks = (0, exports.calculateNumChunksJS)(totalDuration, chunkSize);
    let efficiency = numChunks & gt;
    0 ? (numCompletedTasks / numChunks) * 100 : 0;
    // Factor in break ratio
    const breakRatio = chunkSize & gt;
    0 ? breakDuration / chunkSize : 0;
    if (breakRatio & gt)
        ;
    0.2 & amp;
     & amp;
    breakRatio & lt;
    0.4;
    {
        efficiency += 10;
    }
    if (efficiency & gt)
        ;
    100;
    efficiency = 100;
    if (efficiency & lt)
        ;
    0;
    efficiency = 0;
    return Math.floor(efficiency);
}
;
// ==========================================
// NEW: Timer Mode JavaScript Fallbacks
// ==========================================
const TIMER_MODES;
types_1.TimerMode, { work: number, break: number, longBreak: number, longInterval: number } & gt;
{
    pomodoro: {
        work: 25, ;
        break ;
        5, longBreak;
        15, longInterval;
        4;
    }
    ultradian: {
        work: 90, ;
        break ;
        20, longBreak;
        30, longInterval;
        1;
    }
    '90minute';
    {
        work: 90, ;
        break ;
        20, longBreak;
        30, longInterval;
        1;
    }
    custom: {
        work: 25, ;
        break ;
        5, longBreak;
        15, longInterval;
        4;
    }
}
;
const modeToNumber = (mode) => ;
 & gt;
{
    switch (mode) {
        case 'pomodoro': return 0;
        case 'ultradian': return 1;
        case '90minute': return 2;
        case 'custom': return 3;
        default: return 0;
    }
}
;
const getWorkDurationForModeJS = (mode) => ;
exports.getWorkDurationForModeJS = getWorkDurationForModeJS;
 & gt;
{
    return TIMER_MODES[mode]?.work || TIMER_MODES.pomodoro.work;
}
;
const getBreakDurationForModeJS = (mode) => ;
exports.getBreakDurationForModeJS = getBreakDurationForModeJS;
 & gt;
{
    return TIMER_MODES[mode]?.break || TIMER_MODES.pomodoro.break;
}
;
const getLongBreakForModeJS = (mode) => ;
exports.getLongBreakForModeJS = getLongBreakForModeJS;
 & gt;
{
    return TIMER_MODES[mode]?.longBreak || TIMER_MODES.pomodoro.longBreak;
}
;
const getLongBreakIntervalForModeJS = (mode) => ;
exports.getLongBreakIntervalForModeJS = getLongBreakIntervalForModeJS;
 & gt;
{
    return TIMER_MODES[mode]?.longInterval || TIMER_MODES.pomodoro.longInterval;
}
;
const generateTimerPlanJS = (mode, totalCycles) => ;
exports.generateTimerPlanJS = generateTimerPlanJS;
 & gt;
{
    if (totalCycles & lt)
        ;
    0;
    totalCycles = 4;
    if (totalCycles & gt)
        ;
    20;
    totalCycles = 20;
    const config = TIMER_MODES[mode] || TIMER_MODES.pomodoro;
    const items;
    {
        type: string;
        cycle: number;
        duration: number;
    }
     & gt;
    [];
    for (let i = 0; i & lt; totalCycles)
        ;
    i++;
    {
        items.push({ type: 'work', cycle: i + 1, duration: config.work });
        if (i & lt)
            ;
        totalCycles - 1;
        {
            const isLongBreak = (i + 1) % config.longInterval === 0;
            const breakDuration = isLongBreak ? config.longBreak : config.break;
            items.push({ type: 'break', cycle: i + 1, duration: breakDuration });
        }
    }
    return JSON.stringify(items);
}
;
const generatePomodoroPlanJS = (workMin, shortBreak, longBreak, cyclesBeforeLong, totalCycles) => ;
exports.generatePomodoroPlanJS = generatePomodoroPlanJS;
 & gt;
{
    if (workMin & lt)
        ;
    0;
    workMin = 25;
    if (shortBreak & lt)
        ;
    0;
    shortBreak = 5;
    if (longBreak & lt)
        ;
    0;
    longBreak = 15;
    if (cyclesBeforeLong & lt)
        ;
    0;
    cyclesBeforeLong = 4;
    if (totalCycles & lt)
        ;
    0;
    totalCycles = 4;
    const items;
    {
        type: string;
        title: string;
        duration: number;
    }
     & gt;
    [];
    for (let i = 0; i & lt; totalCycles)
        ;
    i++;
    {
        items.push({ type: 'task', title: `Pomodoro ${i + 1}`, duration: workMin });
        if (i & lt)
            ;
        totalCycles - 1;
        {
            const isLongBreak = (i + 1) % cyclesBeforeLong === 0;
            const breakDuration = isLongBreak ? longBreak : shortBreak;
            const breakTitle = isLongBreak ? 'Long Break' : 'Short Break';
            items.push({ type: 'break', title: breakTitle, duration: breakDuration });
        }
    }
    return JSON.stringify(items);
}
;
const suggestTotalDurationJS = (availableTime, priority) => ;
exports.suggestTotalDurationJS = suggestTotalDurationJS;
 & gt;
{
    if (availableTime & lt)
        ;
    0;
    return 30;
    if (priority & lt)
        ;
    0;
    priority = 50;
    if (priority & gt)
        ;
    100;
    priority = 100;
    let baseSuggestion;
    if (availableTime & lt)
        ;
    30;
    {
        baseSuggestion = availableTime;
    }
    if (availableTime & lt)
        ;
    60;
    {
        baseSuggestion = Math.floor(availableTime / 15) * 15;
    }
    if (availableTime & lt)
        ;
    120;
    {
        baseSuggestion = Math.floor(availableTime / 30) * 30;
    }
    {
        baseSuggestion = Math.floor(availableTime / 60) * 60;
    }
    const adjustment = Math.floor((priority - 50) / 10) * 5;
    let suggestion = baseSuggestion + adjustment;
    if (suggestion & lt)
        ;
    15;
    suggestion = 15;
    if (suggestion & gt)
        ;
    availableTime;
    suggestion = availableTime;
    return suggestion;
}
;
const generateOptimizationSuggestionJS = (currentChunk, currentBreak, avgFocus, distraction) => ;
exports.generateOptimizationSuggestionJS = generateOptimizationSuggestionJS;
 & gt;
{
    const optimizedChunk = (0, exports.optimizeChunkSizeJS)(240, avgFocus, distraction);
    const optimizedBreak = (0, exports.optimizeBreakDurationJS)(optimizedChunk, 70);
    let suggestionText;
    if (optimizedChunk !== currentChunk || optimizedBreak !== currentBreak) {
        suggestionText = `Based on your focus pattern, we suggest ${optimizedChunk}min work blocks with ${optimizedBreak}min breaks. `;
        if (optimizedChunk & gt)
            ;
        currentChunk;
        {
            suggestionText += 'You seem to be able to focus for longer periods!';
        }
        {
            suggestionText += 'Shorter, more frequent breaks might help maintain focus.';
        }
    }
    else {
        suggestionText = 'Your current settings seem well-optimized for your focus pattern!';
    }
    return {
        currentChunkSizeMinutes: currentChunk,
        optimizedChunkSizeMinutes: optimizedChunk,
        currentBreakMinutes: currentBreak,
        optimizedBreakMinutes: optimizedBreak,
        suggestion: suggestionText,
        confidence: avgFocus & gt, 0: Math.min(90, 50 + (100 - distraction) / 2), 50: 
    };
}
;
const generateOptimizationSuggestionJsonJS = (currentChunk, currentBreak, avgFocus, distraction) => ;
exports.generateOptimizationSuggestionJsonJS = generateOptimizationSuggestionJsonJS;
 & gt;
{
    const suggestion = (0, exports.generateOptimizationSuggestionJS)(currentChunk, currentBreak, avgFocus, distraction);
    return JSON.stringify({
        current_chunk: suggestion.currentChunkSizeMinutes,
        optimized_chunk: suggestion.optimizedChunkSizeMinutes,
        current_break: suggestion.currentBreakMinutes,
        optimized_break: suggestion.optimizedBreakMinutes,
        suggestion: suggestion.suggestion
    });
}
;
// ==========================================
// Exported Functions (WASM or JS Fallback)
// ==========================================
const calculateNumChunks = (totalDuration, chunkSize) => ;
exports.calculateNumChunks = calculateNumChunks;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.calculate_num_chunks(totalDuration, chunkSize);
    }
    return (0, exports.calculateNumChunksJS)(totalDuration, chunkSize);
}
;
const calculateChunkDuration = (totalDuration, chunkSize, chunkIndex, numChunks) => ;
exports.calculateChunkDuration = calculateChunkDuration;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.calculate_chunk_duration(totalDuration, chunkSize, chunkIndex, numChunks);
    }
    return (0, exports.calculateChunkDurationJS)(totalDuration, chunkSize, chunkIndex, numChunks);
}
;
const generateTaskTitle = (goal, descriptor, partNumber) => ;
exports.generateTaskTitle = generateTaskTitle;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        const module = wasmModule;
        const goalPtr = copyStringToWASM(goal);
        const descriptorPtr = copyStringToWASM(descriptor);
        const titlePtr = module.generate_task_title(goalPtr, descriptorPtr, partNumber);
        const title = module.UTF8ToString(titlePtr);
        module._free(goalPtr);
        module._free(descriptorPtr);
        module.free_string(titlePtr);
        return title;
    }
    return (0, exports.generateTaskTitleJS)(goal, descriptor, partNumber);
}
;
const validatePlan = (totalDuration, chunkSize, breakDuration) => ;
exports.validatePlan = validatePlan;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.validate_plan(totalDuration, chunkSize, breakDuration) !== 0;
    }
    return (0, exports.validatePlanJS)(totalDuration, chunkSize, breakDuration);
}
;
const calculateNumBreaks = (totalDuration, chunkSize, breakDuration) => ;
exports.calculateNumBreaks = calculateNumBreaks;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.calculate_num_breaks(totalDuration, chunkSize, breakDuration);
    }
    return (0, exports.calculateNumBreaksJS)(totalDuration, chunkSize, breakDuration);
}
;
const calculateTotalDurationWithBreaks = (totalDuration, chunkSize, breakDuration) => ;
exports.calculateTotalDurationWithBreaks = calculateTotalDurationWithBreaks;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.calculate_total_duration_with_breaks(totalDuration, chunkSize, breakDuration);
    }
    return (0, exports.calculateTotalDurationWithBreaksJS)(totalDuration, chunkSize, breakDuration);
}
;
const generateFullPlanJson = (totalDuration, chunkSize, breakDuration, goal, descriptor) => ;
exports.generateFullPlanJson = generateFullPlanJson;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        const module = wasmModule;
        const goalPtr = copyStringToWASM(goal);
        const descriptorPtr = copyStringToWASM(descriptor);
        const jsonPtr = module.generate_full_plan_json(totalDuration, chunkSize, breakDuration, goalPtr, descriptorPtr);
        const json = module.UTF8ToString(jsonPtr);
        module._free(goalPtr);
        module._free(descriptorPtr);
        module.free_string(jsonPtr);
        return json;
    }
    return (0, exports.generateFullPlanJsonJS)(totalDuration, chunkSize, breakDuration, goal, descriptor);
}
;
// ==========================================
// NEW: Exported Enhanced Functions
// ==========================================
const optimizeChunkSize = (totalDuration, avgFocusTime, distractionRate) => ;
exports.optimizeChunkSize = optimizeChunkSize;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.optimize_chunk_size(totalDuration, avgFocusTime, distractionRate);
    }
    return (0, exports.optimizeChunkSizeJS)(totalDuration, avgFocusTime, distractionRate);
}
;
const optimizeBreakDuration = (chunkSize, workIntensity) => ;
exports.optimizeBreakDuration = optimizeBreakDuration;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.optimize_break_duration(chunkSize, workIntensity);
    }
    return (0, exports.optimizeBreakDurationJS)(chunkSize, workIntensity);
}
;
const calculateProductivityScore = (totalDuration, chunkSize, breakDuration, numCompletedTasks) => ;
exports.calculateProductivityScore = calculateProductivityScore;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.calculate_productivity_score(totalDuration, chunkSize, breakDuration, numCompletedTasks);
    }
    return (0, exports.calculateProductivityScoreJS)(totalDuration, chunkSize, breakDuration, numCompletedTasks);
}
;
const getWorkDurationForMode = (mode) => ;
exports.getWorkDurationForMode = getWorkDurationForMode;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.get_work_duration_for_mode(modeToNumber(mode));
    }
    return (0, exports.getWorkDurationForModeJS)(mode);
}
;
const getBreakDurationForMode = (mode) => ;
exports.getBreakDurationForMode = getBreakDurationForMode;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.get_break_duration_for_mode(modeToNumber(mode));
    }
    return (0, exports.getBreakDurationForModeJS)(mode);
}
;
const getLongBreakForMode = (mode) => ;
exports.getLongBreakForMode = getLongBreakForMode;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.get_long_break_for_mode(modeToNumber(mode));
    }
    return (0, exports.getLongBreakForModeJS)(mode);
}
;
const getLongBreakIntervalForMode = (mode) => ;
exports.getLongBreakIntervalForMode = getLongBreakIntervalForMode;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.get_long_break_interval_for_mode(modeToNumber(mode));
    }
    return (0, exports.getLongBreakIntervalForModeJS)(mode);
}
;
const generateTimerPlan = (mode, totalCycles) => ;
exports.generateTimerPlan = generateTimerPlan;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        const jsonPtr = wasmModule.generate_timer_plan(modeToNumber(mode), totalCycles);
        const json = wasmModule.UTF8ToString(jsonPtr);
        wasmModule.free_string(jsonPtr);
        return json;
    }
    return (0, exports.generateTimerPlanJS)(mode, totalCycles);
}
;
const generatePomodoroPlan = (workMin, shortBreak, longBreak, cyclesBeforeLong, totalCycles) => ;
exports.generatePomodoroPlan = generatePomodoroPlan;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        const jsonPtr = wasmModule.generate_pomodoro_plan(workMin, shortBreak, longBreak, cyclesBeforeLong, totalCycles);
        const json = wasmModule.UTF8ToString(jsonPtr);
        wasmModule.free_string(jsonPtr);
        return json;
    }
    return (0, exports.generatePomodoroPlanJS)(workMin, shortBreak, longBreak, cyclesBeforeLong, totalCycles);
}
;
const suggestTotalDuration = (availableTime, priority) => ;
exports.suggestTotalDuration = suggestTotalDuration;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        return wasmModule.suggest_total_duration(availableTime, priority);
    }
    return (0, exports.suggestTotalDurationJS)(availableTime, priority);
}
;
const generateOptimizationSuggestion = (currentChunk, currentBreak, avgFocus, distraction) => ;
exports.generateOptimizationSuggestion = generateOptimizationSuggestion;
 & gt;
{
    if (wasmReady & amp)
        ;
     & amp;
    wasmModule;
    {
        const jsonPtr = wasmModule.generate_optimization_suggestion(currentChunk, currentBreak, avgFocus, distraction);
        const json = wasmModule.UTF8ToString(jsonPtr);
        wasmModule.free_string(jsonPtr);
        return json;
    }
    return (0, exports.generateOptimizationSuggestionJsonJS)(currentChunk, currentBreak, avgFocus, distraction);
}
;
