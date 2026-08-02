export interface Task {
  id: string;
  title: string;
  durationMinutes: number;
  completed: boolean;
  completedAt: string | null;
  isBreak?: boolean;
  // NEW: Dependencies
  dependencies?: string[]; // Array of task IDs that this task depends on
}

export interface FocusPlan {
  id?: string;
  title: string;
  goal: string;
  durationMinutes: number;
  tasks: Task[];
  chunkSizeMinutes?: number;
  breakMinutes?: number;
  nextQueue?: string[];
  source?: string;
  createdAt: string;
  tags?: string[];
  theme?: string;
  icon?: string;
  difficulty?: string;
  completedAt?: string | null;
  cancelledAt?: string;
  startedAt?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  // NEW: Additional fields for advanced features
  category?: string;
  timerMode?: 'pomodoro' | 'ultradian' | '90minute' | 'custom';
  longBreakMinutes?: number;
  longBreakInterval?: number;
  optimizationEnabled?: boolean;
}

export interface PlanPreset {
  name: string;
  title: string;
  goal: string;
  durationMinutes: number;
  chunkSizeMinutes?: number;
  breakMinutes?: number;
  difficulty?: string;
  theme?: string;
  icon?: string;
  tags?: string[];
  // NEW: Additional preset fields
  category?: string;
  timerMode?: 'pomodoro' | 'ultradian' | '90minute' | 'custom';
  longBreakMinutes?: number;
  longBreakInterval?: number;
}

export interface PlanHistoryEntry {
  planId: string;
  title: string;
  goal: string;
  durationMinutes: number;
  tasks: Task[];
  actualDurationMinutes?: number;
  status: string;
  source?: string;
  createdAt: string;
  completedAt: string | null;
  taskId?: string;
  taskTitle?: string;
  tags?: string[];
  // NEW: Additional history fields
  productivityScore?: number;
  focusRating?: number; // 1-5 rating of focus quality
  distractions?: number;
}

export interface PlanTemplate {
  id: string;
  name: string;
  description?: string;
  defaultTitle: string;
  defaultGoal: string;
  defaultDurationMinutes: number;
  defaultChunkSizeMinutes?: number;
  defaultBreakMinutes?: number;
  tags?: string[];
  isBuiltIn?: boolean;
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
  theme?: string;
  icon?: string;
  // NEW: Additional template fields
  category?: string;
  timerMode?: 'pomodoro' | 'ultradian' | '90minute' | 'custom';
  defaultLongBreakMinutes?: number;
  defaultLongBreakInterval?: number;
}

export interface PlanAnalytics {
  totalPlans: number;
  totalCompleted: number;
  totalDurationMinutes: number;
  averageDurationMinutes: number;
  mostUsedPreset?: string;
  usageByHour: Record<number, number>;
  usageByDay: Record<string, number>;
  productivityScore?: number;
  streakDays?: number;
  // NEW: Additional analytics fields
  averageProductivityScore?: number;
  bestFocusTime?: number; // Hour of day with highest productivity
  completionRateByCategory?: Record<string, number>;
  focusTrend?: Array<{ date: string; score: number }>;
}

export interface PerformanceMetrics {
  commandName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  errorType?: string;
  memoryUsage?: number;
}

export interface PlanRecommendation {
  type: 'preset' | 'template' | 'history' | 'optimized';
  name: string;
  title: string;
  durationMinutes: number;
  goal: string;
  score: number;
  reason: string;
  // NEW: Additional recommendation fields
  category?: string;
  optimizedParameters?: {
    chunkSizeMinutes?: number;
    breakMinutes?: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface PlanExportOptions {
  format: 'json' | 'markdown' | 'text' | 'ical';
  includeTasks?: boolean;
  includeMetadata?: boolean;
  includeHistory?: boolean;
}

export interface PlanShareLink {
  id: string;
  planId: string;
  shortCode: string;
  createdAt: string;
  expiresAt?: string;
  accessCount: number;
}

export interface BreakSchedule {
  enabled: boolean;
  breakMinutes: number;
  longBreakMinutes?: number;
  longBreakInterval?: number;
}

export interface PlanSessionStats {
  totalFocusMinutes: number;
  totalBreakMinutes: number;
  tasksCompleted: number;
  totalTasks: number;
  startTime: string;
  endTime?: string | null;
  // NEW: Additional session stats
  productivityScore?: number;
  averageTaskDuration?: number;
  longestFocusStreak?: number;
  distractionCount?: number;
}

// ==========================================
// NEW: Smart Optimizer Types
// ==========================================

export interface UserFocusProfile {
  averageFocusTime: number; // Average minutes of uninterrupted focus
  distractionRate: number; // 0-100, higher means more distractions
  preferredWorkIntensity: number; // 0-100, higher means more intense work
  workPatterns: {
    bestHours: number[]; // Array of hours (0-23) when user is most productive
    preferredSessionLength: number;
    breakFrequency: number;
  };
  historicalData: {
    totalSessions: number;
    averageProductivity: number;
    completionRate: number;
  };
}

export interface OptimizationSuggestion {
  currentChunkSizeMinutes: number;
  optimizedChunkSizeMinutes: number;
  currentBreakMinutes: number;
  optimizedBreakMinutes: number;
  suggestion: string;
  confidence: number; // 0-100, how confident we are in the suggestion
  expectedProductivityGain?: number; // Percentage gain expected
}

export interface OptimizationConfig {
  enabled: boolean;
  autoApply?: boolean;
  learningRate?: number; // How quickly the optimizer adapts (0-1)
  minChunkSize?: number;
  maxChunkSize?: number;
  minBreakSize?: number;
  maxBreakSize?: number;
}

// ==========================================
// NEW: Dependency Management Types
// ==========================================

export interface TaskDependency {
  taskId: string;
  dependsOn: string[]; // Array of task IDs that must be completed first
  dependencyType: 'finish_to_start' | 'start_to_start' | 'finish_to_finish';
  lagTimeMinutes?: number; // Delay between dependency and this task
}

export interface DependencyGraph {
  tasks: Map<string, Task>;
  dependencies: TaskDependency[];
  isValid: boolean;
  hasCycle: boolean;
  topologicalOrder?: string[]; // Tasks in order they should be executed
}

// ==========================================
// NEW: Timer Mode Types
// ==========================================

export type TimerMode = 'pomodoro' | 'ultradian' | '90minute' | 'custom';

export interface TimerConfig {
  mode: TimerMode;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  totalCycles?: number;
  autoStartBreaks?: boolean;
  autoStartWork?: boolean;
  notifications?: boolean;
  soundEnabled?: boolean;
}

export interface TimerState {
  currentCycle: number;
  totalCycles: number;
  phase: 'work' | 'break' | 'long_break' | 'idle';
  remainingSeconds: number;
  totalSeconds: number;
  isPaused: boolean;
  isRunning: boolean;
  startTime?: string;
  endTime?: string;
}

// ==========================================
// NEW: Configuration Types
// ==========================================

export interface AppConfig {
  version: string;
  theme: 'light' | 'dark' | 'system' | 'space';
  notifications: {
    enabled: boolean;
    sound: boolean;
    reminderMinutes: number;
  };
  optimization: OptimizationConfig;
  defaults: {
    preset: string;
    durationMinutes: number;
    chunkSizeMinutes: number;
    breakMinutes: number;
  };
  analytics: {
    enabled: boolean;
    collectAnonymousData: boolean;
  };
}

// Additional types for new utilities
export interface ToastConfig {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

export interface LoadingState {
  isLoading: boolean;
  text?: string;
}

export interface ErrorState {
  hasError: boolean;
  error?: Error;
  message?: string;
}
