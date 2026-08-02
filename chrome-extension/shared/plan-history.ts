import { FocusPlan, PlanHistoryEntry, PlanAnalytics } from '../../src/types';

const MAX_HISTORY_ENTRIES = 100;
const STORAGE_KEY = 'planHistory';

let cachedHistory: PlanHistoryEntry[] | null = null;
let cacheValid = false;

function generatePlanId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function getStorage(): Promise<any> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return null;
}

export async function savePlanToHistory(plan: FocusPlan): Promise<PlanHistoryEntry> {
  const history = await loadPlanHistory();
  
  const entry: PlanHistoryEntry = {
    planId: plan.id || generatePlanId(),
    title: plan.title,
    goal: plan.goal,
    durationMinutes: plan.durationMinutes,
    tasks: plan.tasks,
    status: 'created',
    source: plan.source || 'unknown',
    createdAt: plan.createdAt,
    completedAt: null,
    tags: plan.tags,
  };
  
  history.unshift(entry);
  
  if (history.length > MAX_HISTORY_ENTRIES) {
    history.pop();
  }
  
  await savePlanHistory(history);
  return entry;
}

export async function loadPlanHistory(): Promise<PlanHistoryEntry[]> {
  if (cachedHistory && cacheValid) {
    return [...cachedHistory];
  }
  
  const storage = await getStorage();
  if (storage) {
    try {
      const result = await storage.get([STORAGE_KEY]);
      if (result[STORAGE_KEY] && Array.isArray(result[STORAGE_KEY])) {
        cachedHistory = result[STORAGE_KEY];
        cacheValid = true;
        return [...cachedHistory];
      }
    } catch (error) {
      console.warn('Error loading plan history from storage:', error);
    }
  }
  
  cachedHistory = [];
  cacheValid = true;
  return cachedHistory;
}

export async function savePlanHistory(history: PlanHistoryEntry[]): Promise<void> {
  cachedHistory = [...history];
  cacheValid = true;
  
  const storage = await getStorage();
  if (storage) {
    try {
      await storage.set({ [STORAGE_KEY]: cachedHistory });
    } catch (error) {
      console.warn('Error saving plan history to storage:', error);
    }
  }
}

export async function clearPlanHistory(): Promise<void> {
  cachedHistory = [];
  cacheValid = true;
  
  const storage = await getStorage();
  if (storage) {
    try {
      await storage.remove([STORAGE_KEY]);
    } catch (error) {
      console.warn('Error clearing plan history:', error);
    }
  }
}

export async function getPlanFromHistory(planId: string): Promise<PlanHistoryEntry | null> {
  const history = await loadPlanHistory();
  return history.find(entry => entry.planId === planId) || null;
}

export async function updatePlanHistoryEntry(
  planId: string,
  updates: Partial<PlanHistoryEntry>
): Promise<PlanHistoryEntry | null> {
  const history = await loadPlanHistory();
  const index = history.findIndex(entry => entry.planId === planId);
  
  if (index === -1) {
    return null;
  }
  
  history[index] = {
    ...history[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await savePlanHistory(history);
  return history[index];
}

export async function deletePlanFromHistory(planId: string): Promise<boolean> {
  const history = await loadPlanHistory();
  const initialLength = history.length;
  const filteredHistory = history.filter(entry => entry.planId !== planId);
  
  if (filteredHistory.length < initialLength) {
    await savePlanHistory(filteredHistory);
    return true;
  }
  return false;
}

export async function calculatePlanAnalytics(): Promise<PlanAnalytics> {
  const history = await loadPlanHistory();
  
  const analytics: PlanAnalytics = {
    totalPlans: history.length,
    totalCompleted: history.filter(entry => entry.status === 'completed').length,
    totalDurationMinutes: history.reduce((sum, entry) => sum + entry.durationMinutes, 0),
    averageDurationMinutes: 0,
    usageByHour: {},
    usageByDay: {},
  };
  
  if (history.length > 0) {
    analytics.averageDurationMinutes = Math.round(
      analytics.totalDurationMinutes / history.length
    );
  }
  
  const presetUsage: Record<string, number> = {};
  history.forEach(entry => {
    if (entry.source && entry.source !== 'custom') {
      presetUsage[entry.source] = (presetUsage[entry.source] || 0) + 1;
    }
    
    const date = new Date(entry.createdAt);
    const hour = date.getHours();
    const dayKey = date.toISOString().split('T')[0];
    
    analytics.usageByHour[hour] = (analytics.usageByHour[hour] || 0) + 1;
    analytics.usageByDay[dayKey] = (analytics.usageByDay[dayKey] || 0) + 1;
  });
  
  if (Object.keys(presetUsage).length > 0) {
    analytics.mostUsedPreset = Object.entries(presetUsage).sort(
      (a, b) => b[1] - a[1]
    )[0][0];
  }
  
  return analytics;
}

export function exportPlanToJson(plan: FocusPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function importPlanFromJson(jsonString: string): FocusPlan | null {
  try {
    const plan = JSON.parse(jsonString);
    if (plan && plan.title && plan.durationMinutes) {
      return plan;
    }
    return null;
  } catch (error) {
    console.warn('Error importing plan from JSON:', error);
    return null;
  }
}

export function invalidateHistoryCache(): void {
  cacheValid = false;
}
