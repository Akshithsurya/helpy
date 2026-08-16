import { OptimizationSuggestion, TimerMode } from '../types';

// ==========================================
// 1. Type Definitions
// ==========================================

interface PlanCalculatorWASM {
  calculate_num_chunks: (totalDuration: number, chunkSize: number) => number;
  calculate_chunk_duration: (totalDuration: number, chunkSize: number, chunkIndex: number, numChunks: number) => number;
  generate_task_title: (goalPtr: number, descriptorPtr: number, partNumber: number) => number;
  free_string: (ptr: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, maxBytes: number) => number;
  lengthBytesUTF8: (str: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;
  HEAP32: Int32Array;
  HEAPF32?: Float32Array;
  HEAPF64?: Float64Array;
  
  validate_plan: (totalDuration: number, chunkSize: number, breakDuration: number) => number;
  calculate_num_breaks: (totalDuration: number, chunkSize: number, breakDuration: number) => number;
  calculate_total_duration_with_breaks: (totalDuration: number, chunkSize: number, breakDuration: number) => number;
  generate_full_plan_json: (totalDuration: number, chunkSize: number, breakDuration: number, goalPtr: number, descriptorPtr: number) => number;
  
  optimize_chunk_size: (totalDuration: number, avgFocusTime: number, distractionRate: number) => number;
  optimize_break_duration: (chunkSize: number, workIntensity: number) => number;
  calculate_productivity_score: (totalDuration: number, chunkSize: number, breakDuration: number, numCompletedTasks: number) => number;
  
  validate_dependencies: (dependenciesJsonPtr: number) => number;
  topological_sort_check: (numTasks: number, adjacencyListPtr: number) => number;
  
  get_work_duration_for_mode: (mode: number) => number;
  get_break_duration_for_mode: (mode: number) => number;
  get_long_break_for_mode: (mode: number) => number;
  get_long_break_interval_for_mode: (mode: number) => number;
  generate_timer_plan: (mode: number, totalCycles: number) => number;
  generate_pomodoro_plan: (workMin: number, shortBreak: number, longBreak: number, cyclesBeforeLong: number, totalCycles: number) => number;
  
  suggest_total_duration: (availableTime: number, priority: number) => number;
  generate_optimization_suggestion: (currentChunk: number, currentBreak: number, avgFocus: number, distraction: number) => number;
  
  calculate_productivity_trend: (completedTasksPtr: number, totalTasksPtr: number, days: number) => number;
  find_optimal_work_hour: (hourlyActivityPtr: number, hours: number) => number;
  generate_behavior_insights: (dailyProductivityPtr: number, numDays: number, avgFocusTime: number) => number;
  
  fast_average: (valuesPtr: number, count: number) => number;
  fast_median: (valuesPtr: number, count: number) => number;
  fast_std_dev: (valuesPtr: number, count: number) => number;
  
  generate_smart_plan_recommendation: (totalAvailableMinutes: number, workIntensity: number, userEnergyLevel: number) => number;
  create_full_plan_json: (argsStr: number, source: number) => number;
}

type EmscriptenModuleFactory = () => Promise<PlanCalculatorWASM>;

// ==========================================
// 2. Module State & Initialization
// ==========================================

let wasmModule: PlanCalculatorWASM | null = null;

export const initWASM = async (): Promise<boolean> => {
  if (wasmModule !== null) {
    return true;
  }

  try {
    const moduleExports = await import('./build/plan_calculator.js');
    const ModuleFactory = moduleExports.default as EmscriptenModuleFactory;
    wasmModule = await ModuleFactory();
    console.log('✅ WASM module initialized successfully with enhanced features');
    return true;
  } catch (e) {
    console.warn('⚠️ Could not load WASM module, falling back to JavaScript implementation:', e);
    wasmModule = null; // Explicitly null to ensure fallback is used
    return false;
  }
};

// ==========================================
// 3. WASM Memory Helpers
// ==========================================

const copyStringToWASM = (str: string): number => {
  if (!wasmModule) return 0;
  const len = wasmModule.lengthBytesUTF8(str) + 1;
  const ptr = wasmModule._malloc(len);
  wasmModule.stringToUTF8(str, ptr, len);
  return ptr;
};

const copyArrayToWASM = (arr: number[], type: 'i32' | 'f32' | 'f64' = 'i32'): number => {
  if (!wasmModule || arr.length === 0) return 0;
  
  const bytesPerElement = type === 'i32' ? 4 : type === 'f32' ? 4 : 8;
  const size = arr.length * bytesPerElement;
  const ptr = wasmModule._malloc(size);
  
  try {
    if (type === 'i32' && wasmModule.HEAP32) {
      wasmModule.HEAP32.set(arr, ptr / 4);
    } else if (type === 'f32' && wasmModule.HEAPF32) {
      wasmModule.HEAPF32.set(arr, ptr / 4);
    } else if (type === 'f64' && wasmModule.HEAPF64) {
      wasmModule.HEAPF64.set(arr, ptr / 8);
    } else {
      for (let i = 0; i < arr.length; i++) {
        wasmModule.setValue(ptr + i * bytesPerElement, arr[i], type);
      }
    }
  } catch (e) {
    wasmModule._free(ptr);
    throw e;
  }
  
  return ptr;
};

// ==========================================
// 4. Fallback Helper
// ==========================================

const withWasmFallback = <T>(wasmFn: (() => T) | null, fallbackFn: () => T): T => {
  if (!wasmModule || !wasmFn) {
    return fallbackFn();
  }
  try {
    return wasmFn();
  } catch (e) {
    console.warn('WASM execution failed, falling back to JS:', e);
    return fallbackFn();
  }
};

// ==========================================
// 5. JavaScript Fallback Implementations
// ==========================================

export const calculateNumChunksJS = (totalDuration: number, chunkSize: number): number => {
  const safeChunkSize = chunkSize <= 0 ? 15 : chunkSize;
  if (totalDuration <= 0) return 1;
  return Math.max(1, Math.ceil(totalDuration / safeChunkSize));
};

export const calculateChunkDurationJS = (totalDuration: number, chunkSize: number, chunkIndex: number, numChunks: number): number => {
  if (chunkIndex < 0 || chunkIndex >= numChunks) return 0;
  if (chunkIndex < numChunks - 1) return chunkSize;
  return Math.max(0, totalDuration - chunkSize * (numChunks - 1));
};

export const generateTaskTitleJS = (goal: string, descriptor: string, partNumber: number): string => {
  if (goal && goal.trim().length > 0) {
    return `${descriptor}: ${goal}`;
  }
  return `${descriptor} - Part ${partNumber}`;
};

export const validatePlanJS = (totalDuration: number, chunkSize: number, breakDuration: number): boolean => {
  return totalDuration > 0 && chunkSize > 0 && chunkSize <= totalDuration && breakDuration >= 0;
};

export const calculateNumBreaksJS = (totalDuration: number, chunkSize: number, breakDuration: number): number => {
  const numChunks = calculateNumChunksJS(totalDuration, chunkSize);
  return numChunks > 1 ? numChunks - 1 : 0;
};

export const calculateTotalDurationWithBreaksJS = (totalDuration: number, chunkSize: number, breakDuration: number): number => {
  const numChunks = calculateNumChunksJS(totalDuration, chunkSize);
  const numBreaks = numChunks > 1 ? numChunks - 1 : 0;
  return totalDuration + numBreaks * breakDuration;
};

export const generateFullPlanJsonJS = (totalDuration: number, chunkSize: number, breakDuration: number, goal: string, descriptor: string): string => {
  const numChunks = calculateNumChunksJS(totalDuration, chunkSize);
  const items: Array<{ type: string; title: string; duration: number }> = [];
  
  for (let i = 0; i < numChunks; i++) {
    const chunkDur = calculateChunkDurationJS(totalDuration, chunkSize, i, numChunks);
    const title = goal && goal.trim().length > 0 ? `${descriptor}: ${goal}` : `${descriptor} - Part ${i + 1}`;
    items.push({ type: 'task', title, duration: chunkDur });
    
    if (i < numChunks - 1 && breakDuration > 0) {
      items.push({ type: 'break', title: 'Take a break', duration: breakDuration });
    }
  }
  
  return JSON.stringify(items);
};

export const optimizeChunkSizeJS = (totalDuration: number, avgFocusTime: number, distractionRate: number): number => {
  const safeFocus = avgFocusTime <= 0 ? 25 : avgFocusTime;
  const safeDistraction = Math.max(0, Math.min(100, distractionRate));
  const baseChunk = safeFocus;
  const adjustment = Math.floor((100 - safeDistraction) / 10);
  let optimal = baseChunk + adjustment;
  optimal = Math.max(10, Math.min(60, optimal));
  return Math.min(optimal, Math.max(1, totalDuration));
};

export const optimizeBreakDurationJS = (chunkSize: number, workIntensity: number): number => {
  const safeIntensity = Math.max(0, Math.min(100, workIntensity));
  const ratio = safeIntensity / 100;
  const baseBreak = Math.floor(chunkSize / 5);
  let optimal = Math.floor(baseBreak * (1 + ratio * 0.5));
  return Math.max(3, Math.min(15, optimal));
};

export const calculateProductivityScoreJS = (totalDuration: number, chunkSize: number, breakDuration: number, numCompletedTasks: number): number => {
  if (totalDuration <= 0) return 0;
  const numChunks = calculateNumChunksJS(totalDuration, chunkSize);
  let efficiency = numChunks > 0 ? (numCompletedTasks / numChunks) * 100 : 0;
  const breakRatio = chunkSize > 0 ? breakDuration / chunkSize : 0;
  if (breakRatio >= 0.2 && breakRatio <= 0.4) {
    efficiency += 10;
  }
  return Math.floor(Math.max(0, Math.min(100, efficiency)));
};

type TimerModeConfig = { work: number; break: number; longBreak: number; longInterval: number };

const TIMER_MODES: Record<TimerMode | string, TimerModeConfig> = {
  pomodoro: { work: 25, break: 5, longBreak: 15, longInterval: 4 },
  ultradian: { work: 90, break: 20, longBreak: 30, longInterval: 1 },
  '90minute': { work: 90, break: 20, longBreak: 30, longInterval: 1 },
  custom: { work: 25, break: 5, longBreak: 15, longInterval: 4 }
};

const modeToNumber = (mode: TimerMode | string): number => {
  switch (mode) {
    case 'pomodoro': return 0;
    case 'ultradian': return 1;
    case '90minute': return 2;
    case 'custom': return 3;
    default: return 0;
  }
};

export const getWorkDurationForModeJS = (mode: TimerMode | string): number => TIMER_MODES[mode as string]?.work ?? TIMER_MODES.pomodoro.work;
export const getBreakDurationForModeJS = (mode: TimerMode | string): number => TIMER_MODES[mode as string]?.break ?? TIMER_MODES.pomodoro.break;
export const getLongBreakForModeJS = (mode: TimerMode | string): number => TIMER_MODES[mode as string]?.longBreak ?? TIMER_MODES.pomodoro.longBreak;
export const getLongBreakIntervalForModeJS = (mode: TimerMode | string): number => TIMER_MODES[mode as string]?.longInterval ?? TIMER_MODES.pomodoro.longInterval;

export const generateTimerPlanJS = (mode: TimerMode | string, totalCycles: number): string => {
  const safeCycles = Math.max(1, Math.min(20, totalCycles));
  const config = TIMER_MODES[mode as string] || TIMER_MODES.pomodoro;
  const items: Array<{ type: string; cycle: number; duration: number }> = [];
  
  for (let i = 0; i < safeCycles; i++) {
    items.push({ type: 'work', cycle: i + 1, duration: config.work });
    if (i < safeCycles - 1) {
      const isLongBreak = (i + 1) % config.longInterval === 0;
      items.push({ type: 'break', cycle: i + 1, duration: isLongBreak ? config.longBreak : config.break });
    }
  }
  return JSON.stringify(items);
};

export const generatePomodoroPlanJS = (workMin: number, shortBreak: number, longBreak: number, cyclesBeforeLong: number, totalCycles: number): string => {
  const w = Math.max(1, workMin);
  const sb = Math.max(1, shortBreak);
  const lb = Math.max(1, longBreak);
  const cbl = Math.max(1, cyclesBeforeLong);
  const cycles = Math.max(1, totalCycles);
  const items: Array<{ type: string; title: string; duration: number }> = [];
  
  for (let i = 0; i < cycles; i++) {
    items.push({ type: 'task', title: `Pomodoro ${i + 1}`, duration: w });
    if (i < cycles - 1) {
      const isLongBreak = (i + 1) % cbl === 0;
      items.push({ type: 'break', title: isLongBreak ? 'Long Break' : 'Short Break', duration: isLongBreak ? lb : sb });
    }
  }
  return JSON.stringify(items);
};

export const calculateProductivityTrendJS = (completedTasks: number[], totalTasks: number[], days: number): number => {
  if (days <= 0) return 0;
  let totalEfficiency = 0;
  let validDays = 0;
  const limit = Math.min(days, completedTasks.length, totalTasks.length);
  
  for (let i = 0; i < limit; i++) {
    if (totalTasks[i] > 0) {
      totalEfficiency += completedTasks[i] / totalTasks[i];
      validDays++;
    }
  }
  return validDays === 0 ? 0 : Math.floor((totalEfficiency / validDays) * 100);
};

export const findOptimalWorkHourJS = (hourlyActivity: number[], hours: number): number => {
  const limit = Math.min(Math.max(1, hours), 24, hourlyActivity.length);
  let maxActivity = -1;
  let optimalHour = 9;
  
  for (let i = 0; i < limit; i++) {
    if (hourlyActivity[i] > maxActivity) {
      maxActivity = hourlyActivity[i];
      optimalHour = i;
    }
  }
  return optimalHour;
};

export const generateBehaviorInsightsJS = (dailyProductivity: number[], numDays: number, avgFocusTime: number): string => {
  const insights: { type: string; value: number; message: string }[] = [];
  const limit = Math.min(numDays, dailyProductivity.length);
  let trend = 0;
  
  if (limit >= 2) {
    const halfDays = Math.floor(limit / 2);
    let firstHalfAvg = 0;
    let secondHalfAvg = 0;
    for (let i = 0; i < halfDays; i++) firstHalfAvg += dailyProductivity[i];
    for (let i = halfDays; i < limit; i++) secondHalfAvg += dailyProductivity[i];
    firstHalfAvg /= halfDays;
    secondHalfAvg /= (limit - halfDays);
    trend = Math.floor(secondHalfAvg - firstHalfAvg);
  }
  
  const trendMsg = trend > 10 ? 'Great improvement! Your productivity is increasing.' 
    : trend < -10 ? 'Consider adjusting your routine - productivity trend is downward.' 
    : 'Your productivity is stable. Keep up the good work!';
  insights.push({ type: 'trend', value: trend, message: trendMsg });
  
  const focusMsg = avgFocusTime < 20 ? 'Try shorter focus blocks (15-20 mins) for better results.'
    : avgFocusTime > 45 ? 'Excellent focus capacity! Consider longer blocks (45-60 mins).'
    : 'Your focus time is optimal.';
  insights.push({ type: 'focus_time', value: avgFocusTime, message: focusMsg });
  
  return JSON.stringify({ insights });
};

export const fastAverageJS = (values: number[], count: number): number => {
  const len = Math.min(count, values.length);
  if (len <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += values[i];
  return sum / len;
};

export const fastMedianJS = (values: number[], count: number): number => {
  const len = Math.min(count, values.length);
  if (len <= 0) return 0;
  const sorted = [...values].slice(0, len).sort((a, b) => a - b);
  if (len % 2 === 0) {
    return (sorted[len / 2 - 1] + sorted[len / 2]) / 2;
  }
  return sorted[Math.floor(len / 2)];
};

export const fastStdDevJS = (values: number[], count: number): number => {
  const len = Math.min(count, values.length);
  if (len <= 1) return 0;
  const avg = fastAverageJS(values, len);
  let sumSqDiff = 0;
  for (let i = 0; i < len; i++) {
    const diff = values[i] - avg;
    sumSqDiff += diff * diff;
  }
  return Math.sqrt(sumSqDiff / (len - 1));
};

export const suggestTotalDurationJS = (availableTime: number, priority: number): number => {
  const safeTime = Math.max(15, availableTime);
  const priorityFactor = Math.max(0.5, Math.min(1.5, priority / 50));
  return Math.floor(safeTime * priorityFactor);
};

export const generateSmartPlanRecommendationJS = (totalAvailableMinutes: number, workIntensity: number, userEnergyLevel: number): string => {
  const intensity = Math.max(1, Math.min(100, workIntensity));
  const energy = Math.max(1, Math.min(100, userEnergyLevel));
  const availableTime = Math.max(15, totalAvailableMinutes);

  let optimalWorkMinutes = energy >= 80 && intensity >= 70 ? 60 : energy >= 60 ? 45 : energy >= 40 ? 30 : 20;
  if (availableTime < 30) optimalWorkMinutes = Math.min(optimalWorkMinutes, 20);
  else if (availableTime < 60) optimalWorkMinutes = Math.min(optimalWorkMinutes, 30);

  const optimalBreakMinutes = Math.max(3, Math.min(15, Math.floor(optimalWorkMinutes / 5)));
  const estimatedProductivityGain = Math.min(35, 10 + Math.floor(intensity / 10) + Math.floor(energy / 20));

  const recommendation = energy >= 80 && intensity >= 70 ? "You're in deep work mode! Take advantage of your high energy with longer focus blocks."
    : energy >= 60 ? "Balanced energy levels - standard focus blocks with moderate breaks should work well."
    : energy >= 40 ? "Lower energy levels - shorter, more frequent focus blocks will help maintain productivity."
    : "Low energy - consider light tasks with very short focus bursts.";

  return JSON.stringify({ optimalWorkMinutes, optimalBreakMinutes, estimatedProductivityGain, recommendation });
};

export const createFullPlanJS = (argsStr: string, source: string = "ts"): string => {
  return JSON.stringify({ 
    error: "Full plan creation is not supported in JS fallback. Use plan-command.ts or ensure WASM is loaded.",
    args: argsStr,
    source
  });
};

// ==========================================
// 6. Exported Functions (WASM with JS Fallback)
// ==========================================

export const calculateNumChunks = (totalDuration: number, chunkSize: number): number => 
  withWasmFallback(() => wasmModule!.calculate_num_chunks(totalDuration, chunkSize), () => calculateNumChunksJS(totalDuration, chunkSize));

export const calculateChunkDuration = (totalDuration: number, chunkSize: number, chunkIndex: number, numChunks: number): number => 
  withWasmFallback(() => wasmModule!.calculate_chunk_duration(totalDuration, chunkSize, chunkIndex, numChunks), () => calculateChunkDurationJS(totalDuration, chunkSize, chunkIndex, numChunks));

export const generateTaskTitle = (goal: string, descriptor: string, partNumber: number): string => {
  return withWasmFallback(() => {
    const goalPtr = copyStringToWASM(goal);
    const descriptorPtr = copyStringToWASM(descriptor);
    let titlePtr = 0;
    try {
      titlePtr = wasmModule!.generate_task_title(goalPtr, descriptorPtr, partNumber);
      return wasmModule!.UTF8ToString(titlePtr);
    } finally {
      wasmModule!._free(goalPtr);
      wasmModule!._free(descriptorPtr);
      if (titlePtr) wasmModule!.free_string(titlePtr);
    }
  }, () => generateTaskTitleJS(goal, descriptor, partNumber));
};

export const validatePlan = (totalDuration: number, chunkSize: number, breakDuration: number): boolean => 
  withWasmFallback(() => wasmModule!.validate_plan(totalDuration, chunkSize, breakDuration) !== 0, () => validatePlanJS(totalDuration, chunkSize, breakDuration));

export const calculateNumBreaks = (totalDuration: number, chunkSize: number, breakDuration: number): number => 
  withWasmFallback(() => wasmModule!.calculate_num_breaks(totalDuration, chunkSize, breakDuration), () => calculateNumBreaksJS(totalDuration, chunkSize, breakDuration));

export const calculateTotalDurationWithBreaks = (totalDuration: number, chunkSize: number, breakDuration: number): number => 
  withWasmFallback(() => wasmModule!.calculate_total_duration_with_breaks(totalDuration, chunkSize, breakDuration), () => calculateTotalDurationWithBreaksJS(totalDuration, chunkSize, breakDuration));

export const generateFullPlanJson = (totalDuration: number, chunkSize: number, breakDuration: number, goal: string, descriptor: string): string => {
  return withWasmFallback(() => {
    const goalPtr = copyStringToWASM(goal);
    const descriptorPtr = copyStringToWASM(descriptor);
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.generate_full_plan_json(totalDuration, chunkSize, breakDuration, goalPtr, descriptorPtr);
      return wasmModule!.UTF8ToString(jsonPtr);
    } finally {
      wasmModule!._free(goalPtr);
      wasmModule!._free(descriptorPtr);
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
    }
  }, () => generateFullPlanJsonJS(totalDuration, chunkSize, breakDuration, goal, descriptor));
};

export const optimizeChunkSize = (totalDuration: number, avgFocusTime: number, distractionRate: number): number => 
  withWasmFallback(() => wasmModule!.optimize_chunk_size(totalDuration, avgFocusTime, distractionRate), () => optimizeChunkSizeJS(totalDuration, avgFocusTime, distractionRate));

export const optimizeBreakDuration = (chunkSize: number, workIntensity: number): number => 
  withWasmFallback(() => wasmModule!.optimize_break_duration(chunkSize, workIntensity), () => optimizeBreakDurationJS(chunkSize, workIntensity));

export const calculateProductivityScore = (totalDuration: number, chunkSize: number, breakDuration: number, numCompletedTasks: number): number => 
  withWasmFallback(() => wasmModule!.calculate_productivity_score(totalDuration, chunkSize, breakDuration, numCompletedTasks), () => calculateProductivityScoreJS(totalDuration, chunkSize, breakDuration, numCompletedTasks));

export const getWorkDurationForMode = (mode: TimerMode | string): number => 
  withWasmFallback(() => wasmModule!.get_work_duration_for_mode(modeToNumber(mode)), () => getWorkDurationForModeJS(mode));

export const getBreakDurationForMode = (mode: TimerMode | string): number => 
  withWasmFallback(() => wasmModule!.get_break_duration_for_mode(modeToNumber(mode)), () => getBreakDurationForModeJS(mode));

export const getLongBreakForMode = (mode: TimerMode | string): number => 
  withWasmFallback(() => wasmModule!.get_long_break_for_mode(modeToNumber(mode)), () => getLongBreakForModeJS(mode));

export const getLongBreakIntervalForMode = (mode: TimerMode | string): number => 
  withWasmFallback(() => wasmModule!.get_long_break_interval_for_mode(modeToNumber(mode)), () => getLongBreakIntervalForModeJS(mode));

export const generateTimerPlan = (mode: TimerMode | string, totalCycles: number): string => {
  return withWasmFallback(() => {
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.generate_timer_plan(modeToNumber(mode), totalCycles);
      return wasmModule!.UTF8ToString(jsonPtr);
    } finally {
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
    }
  }, () => generateTimerPlanJS(mode, totalCycles));
};

export const generatePomodoroPlan = (workMin: number, shortBreak: number, longBreak: number, cyclesBeforeLong: number, totalCycles: number): string => {
  return withWasmFallback(() => {
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.generate_pomodoro_plan(workMin, shortBreak, longBreak, cyclesBeforeLong, totalCycles);
      return wasmModule!.UTF8ToString(jsonPtr);
    } finally {
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
    }
  }, () => generatePomodoroPlanJS(workMin, shortBreak, longBreak, cyclesBeforeLong, totalCycles));
};

export const suggestTotalDuration = (availableTime: number, priority: number): number => 
  withWasmFallback(() => wasmModule!.suggest_total_duration(availableTime, priority), () => suggestTotalDurationJS(availableTime, priority));

export const generateOptimizationSuggestion = (currentChunk: number, currentBreak: number, avgFocus: number, distraction: number): OptimizationSuggestion => {
  return withWasmFallback(() => {
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.generate_optimization_suggestion(currentChunk, currentBreak, avgFocus, distraction);
      const json = wasmModule!.UTF8ToString(jsonPtr);
      return JSON.parse(json) as OptimizationSuggestion;
    } catch (e) {
      console.warn('Failed to parse WASM optimization suggestion, falling back', e);
      throw e; // Triggers the fallback function
    } finally {
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
    }
  }, () => {
    const safeFocus = avgFocus <= 0 ? 25 : avgFocus;
    const safeDistraction = Math.max(0, Math.min(100, distraction));
    const optimizedChunk = optimizeChunkSizeJS(240, safeFocus, safeDistraction);
    const optimizedBreak = optimizeBreakDurationJS(optimizedChunk, 70);
    
    let suggestionText = '';
    if (optimizedChunk !== currentChunk || optimizedBreak !== currentBreak) {
      suggestionText = `Based on your focus pattern, we suggest ${optimizedChunk}min work blocks with ${optimizedBreak}min breaks. `;
      suggestionText += optimizedChunk > currentChunk ? 'You seem to be able to focus for longer periods!' : 'Shorter, more frequent breaks might help maintain focus.';
    } else {
      suggestionText = 'Your current settings seem well-optimized for your focus pattern!';
    }
    
    return {
      currentChunkSizeMinutes: currentChunk,
      optimizedChunkSizeMinutes: optimizedChunk,
      currentBreakMinutes: currentBreak,
      optimizedBreakMinutes: optimizedBreak,
      suggestion: suggestionText,
      confidence: safeFocus > 0 ? Math.min(90, 50 + (100 - safeDistraction) / 2) : 50
    };
  });
};

export const calculateProductivityTrend = (completedTasks: number[], totalTasks: number[], days: number): number => {
  return withWasmFallback(() => {
    const completedPtr = copyArrayToWASM(completedTasks, 'i32');
    const totalPtr = copyArrayToWASM(totalTasks, 'i32');
    try {
      return wasmModule!.calculate_productivity_trend(completedPtr, totalPtr, days);
    } finally {
      wasmModule!._free(completedPtr);
      wasmModule!._free(totalPtr);
    }
  }, () => calculateProductivityTrendJS(completedTasks, totalTasks, days));
};

export const findOptimalWorkHour = (hourlyActivity: number[], hours: number): number => {
  return withWasmFallback(() => {
    const arrPtr = copyArrayToWASM(hourlyActivity, 'i32');
    try {
      return wasmModule!.find_optimal_work_hour(arrPtr, hours);
    } finally {
      wasmModule!._free(arrPtr);
    }
  }, () => findOptimalWorkHourJS(hourlyActivity, hours));
};

export const generateBehaviorInsights = (dailyProductivity: number[], numDays: number, avgFocusTime: number): string => {
  return withWasmFallback(() => {
    // Using f64 in case productivity contains decimal percentages, falls back to i32 logic if HEAPF64 is missing
    const arrPtr = copyArrayToWASM(dailyProductivity, 'f64'); 
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.generate_behavior_insights(arrPtr, numDays, avgFocusTime);
      return wasmModule!.UTF8ToString(jsonPtr);
    } finally {
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
      wasmModule!._free(arrPtr);
    }
  }, () => generateBehaviorInsightsJS(dailyProductivity, numDays, avgFocusTime));
};

export const fastAverage = (values: number[], count: number): number => {
  return withWasmFallback(() => {
    const arrPtr = copyArrayToWASM(values, 'f64');
    try {
      return wasmModule!.fast_average(arrPtr, count);
    } finally {
      wasmModule!._free(arrPtr);
    }
  }, () => fastAverageJS(values, count));
};

export const fastMedian = (values: number[], count: number): number => {
  return withWasmFallback(() => {
    const arrPtr = copyArrayToWASM(values, 'f64');
    try {
      return wasmModule!.fast_median(arrPtr, count);
    } finally {
      wasmModule!._free(arrPtr);
    }
  }, () => fastMedianJS(values, count));
};

export const fastStdDev = (values: number[], count: number): number => {
  return withWasmFallback(() => {
    const arrPtr = copyArrayToWASM(values, 'f64');
    try {
      return wasmModule!.fast_std_dev(arrPtr, count);
    } finally {
      wasmModule!._free(arrPtr);
    }
  }, () => fastStdDevJS(values, count));
};

export const generateSmartPlanRecommendation = (totalAvailableMinutes: number, workIntensity: number, userEnergyLevel: number): string => {
  return withWasmFallback(() => {
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.generate_smart_plan_recommendation(totalAvailableMinutes, workIntensity, userEnergyLevel);
      return wasmModule!.UTF8ToString(jsonPtr);
    } finally {
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
    }
  }, () => generateSmartPlanRecommendationJS(totalAvailableMinutes, workIntensity, userEnergyLevel));
};

export const createFullPlan = (argsStr: string, source: string = "ts"): string => {
  return withWasmFallback(() => {
    const argsPtr = copyStringToWASM(argsStr);
    const sourcePtr = copyStringToWASM(source);
    let jsonPtr = 0;
    try {
      jsonPtr = wasmModule!.create_full_plan_json(argsPtr, sourcePtr);
      return wasmModule!.UTF8ToString(jsonPtr);
    } finally {
      wasmModule!._free(argsPtr);
      wasmModule!._free(sourcePtr);
      if (jsonPtr) wasmModule!.free_string(jsonPtr);
    }
  }, () => createFullPlanJS(argsStr, source));
};

// Optional: Expose dependency functions if needed elsewhere
export const validateDependencies = (dependenciesJson: string): number => {
  return withWasmFallback(() => {
    const ptr = copyStringToWASM(dependenciesJson);
    try {
      return wasmModule!.validate_dependencies(ptr);
    } finally {
      wasmModule!._free(ptr);
    }
  }, () => 1); // Fallback to valid
};

export const topologicalSortCheck = (numTasks: number, adjacencyList: number[]): number => {
  return withWasmFallback(() => {
    const ptr = copyArrayToWASM(adjacencyList, 'i32');
    try {
      return wasmModule!.topological_sort_check(numTasks, ptr);
    } finally {
      wasmModule!._free(ptr);
    }
  }, () => 1); // Fallback to valid
};