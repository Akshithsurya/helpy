'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getQuickSuggestions = exports.getPlanRecommendations = void 0;

const { getDefaultPresets } = require('./plan-command');

const MAX_RECOMMENDATIONS = 5;

function getPlanRecommendations(presets, templates, history, count = MAX_RECOMMENDATIONS) {
  const recommendations = [];
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  presets.forEach((preset) => {
    let score = 0.5;

    if (
      currentHour >= 9 &&
      currentHour <= 17 &&
      (preset.name === 'work' || preset.name === 'focus')
    ) {
      score += 0.3;
    }

    if (
      (currentHour < 9 || currentHour > 17) &&
      (preset.name === 'study' || preset.name === 'read')
    ) {
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

  templates.forEach((template) => {
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
  const historyFrequency = {};
  recentHistory.forEach((entry) => {
    if (entry.title) {
      const key = entry.title.toLowerCase();
      historyFrequency[key] = (historyFrequency[key] || 0) + 1;
    }
  });

  history.forEach((entry) => {
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

  const seenTitles = new Set();
  const uniqueRecommendations = [];

  for (const rec of recommendations) {
    let title;
    let name;
    let goal;
    let durationMinutes;
    let reason;

    if (rec.type === 'preset') {
      const preset = rec.item;
      title = preset.title;
      name = preset.name;
      goal = preset.goal;
      durationMinutes = preset.durationMinutes;
      reason = 'Popular preset';
    } else if (rec.type === 'template') {
      const template = rec.item;
      title = template.defaultTitle;
      name = template.name;
      goal = template.defaultGoal;
      durationMinutes = template.defaultDurationMinutes;
      reason = 'Saved template';
    } else {
      const entry = rec.item;
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
exports.getPlanRecommendations = getPlanRecommendations;

function getQuickSuggestions() {
  return ['work', 'study', 'focus', 'exercise', 'code', 'read', 'write', 'meditate'];
}
exports.getQuickSuggestions = getQuickSuggestions;
