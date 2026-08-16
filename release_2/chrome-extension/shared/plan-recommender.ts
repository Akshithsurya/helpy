import { PlanRecommendation, PlanPreset, PlanTemplate, PlanHistoryEntry } from '../../src/types';
import { getDefaultPresets } from './plan-command';

const MAX_RECOMMENDATIONS = 5;

interface ScoredItem {
  item: any;
  score: number;
  type: 'preset' | 'template' | 'history';
}

export function getPlanRecommendations(
  presets: PlanPreset[],
  templates: PlanTemplate[],
  history: PlanHistoryEntry[],
  count: number = MAX_RECOMMENDATIONS
): PlanRecommendation[] {
  const recommendations: ScoredItem[] = [];
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();
  
  presets.forEach(preset => {
    let score = 0.5;
    
    if (currentHour >= 9 && currentHour <= 17 && (preset.name === 'work' || preset.name === 'focus')) {
      score += 0.3;
    }
    
    if ((currentHour < 9 || currentHour > 17) && (preset.name === 'study' || preset.name === 'read')) {
      score += 0.3;
    }
    
    if ((currentDay === 0 || currentDay === 6) && preset.name === 'exercise') {
      score += 0.2;
    }
    
    recommendations.push({
      item: preset,
      score,
      type: 'preset',
    });
  });
  
  templates.forEach(template => {
    let score = 0.4;
    if (template.usageCount) {
      score += Math.min(template.usageCount * 0.1, 0.5);
    }
    recommendations.push({
      item: template,
      score,
      type: 'template',
    });
  });
  
  const recentHistory = history.slice(0, 10);
  const historyFrequency: Record<string, number> = {};
  recentHistory.forEach(entry => {
    if (entry.title) {
      const key = entry.title.toLowerCase();
      historyFrequency[key] = (historyFrequency[key] || 0) + 1;
    }
  });
  
  history.forEach(entry => {
    let score = 0.3;
    if (entry.title) {
      const key = entry.title.toLowerCase();
      score += (historyFrequency[key] || 0) * 0.15;
    }
    
    const entryDate = new Date(entry.createdAt);
    const daysDiff = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) {
      score += 0.4;
    } else if (daysDiff <= 7) {
      score += 0.2;
    }
    
    recommendations.push({
      item: entry,
      score,
      type: 'history',
    });
  });
  
  recommendations.sort((a, b) => b.score - a.score);
  
  const seenTitles = new Set<string>();
  const uniqueRecommendations: PlanRecommendation[] = [];
  
  for (const rec of recommendations) {
    let title: string;
    let name: string;
    let goal: string;
    let durationMinutes: number;
    let reason: string;
    
    if (rec.type === 'preset') {
      const preset = rec.item as PlanPreset;
      title = preset.title;
      name = preset.name;
      goal = preset.goal;
      durationMinutes = preset.durationMinutes;
      reason = 'Popular preset';
    } else if (rec.type === 'template') {
      const template = rec.item as PlanTemplate;
      title = template.defaultTitle;
      name = template.name;
      goal = template.defaultGoal;
      durationMinutes = template.defaultDurationMinutes;
      reason = 'Saved template';
    } else {
      const entry = rec.item as PlanHistoryEntry;
      title = entry.title;
      name = entry.title;
      goal = entry.goal;
      durationMinutes = entry.durationMinutes;
      reason = 'Recently used';
    }
    
    const titleKey = title.toLowerCase();
    if (!seenTitles.has(titleKey)) {
      seenTitles.add(titleKey);
      uniqueRecommendations.push({
        type: rec.type,
        name,
        title,
        goal,
        durationMinutes,
        score: rec.score,
        reason,
      });
    }
    
    if (uniqueRecommendations.length >= count) {
      break;
    }
  }
  
  return uniqueRecommendations;
}

export function getQuickSuggestions(): string[] {
  return [
    'work',
    'study',
    'focus',
    'exercise',
    'code',
    'read',
    'write',
    'meditate',
  ];
}
