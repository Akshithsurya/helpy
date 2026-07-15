const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');
const { startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } = require('date-fns');

const ANALYTICS_DATA_PATH = 'analytics-data.json';

const ANALYTICS_METRICS = {
  FOCUS_SESSIONS: 'focus_sessions',
  TASKS_COMPLETED: 'tasks_completed',
  TABS_TRACKED: 'tabs_tracked',
  APPS_USED: 'apps_used',
  REMINDERS_SENT: 'reminders_sent',
  DAILY_STREAK: 'daily_streak',
};

class AnalyticsManager {
  constructor(logger) {
    this.logger = logger || console;
    this.analyticsData = this._loadAnalyticsData();
    this.currentDayStats = this._getCurrentDayStats();
  }

  _loadAnalyticsData() {
    try {
      const filePath = getDataFilePath(ANALYTICS_DATA_PATH);
      return safeReadJson(filePath, { dailyStats: {}, habits: {}, overall: {} });
    } catch (error) {
      this.logger.error('Error loading analytics data:', error);
      return { dailyStats: {}, habits: {}, overall: {} };
    }
  }

  _saveAnalyticsData() {
    try {
      const filePath = getDataFilePath(ANALYTICS_DATA_PATH);
      writeJsonAtomic(filePath, this.analyticsData);
    } catch (error) {
      this.logger.error('Error saving analytics data:', error);
    }
  }

  _getDayKey(date = new Date()) {
    return format(date, 'yyyy-MM-dd');
  }

  _getCurrentDayStats() {
    const dayKey = this._getDayKey();
    if (!this.analyticsData.dailyStats[dayKey]) {
      this.analyticsData.dailyStats[dayKey] = {
        date: dayKey,
        focusSessions: 0,
        totalFocusMinutes: 0,
        tasksCompleted: 0,
        tabsTracked: 0,
        appsUsed: 0,
        remindersSent: 0,
        productiveHours: [],
        distractions: 0,
      };
    }
    return this.analyticsData.dailyStats[dayKey];
  }

  recordFocusSession(durationMinutes, _goal = '') {
    try {
      this.currentDayStats.focusSessions++;
      this.currentDayStats.totalFocusMinutes += durationMinutes;

      const hour = new Date().getHours();
      if (!this.currentDayStats.productiveHours.includes(hour)) {
        this.currentDayStats.productiveHours.push(hour);
      }

      this._updateOverallStats('totalFocusMinutes', durationMinutes);
      this._updateOverallStats('totalFocusSessions', 1);
      this._saveAnalyticsData();

      this.logger.info(`Recorded focus session: ${durationMinutes} minutes`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error recording focus session:', error);
      return { success: false, error: error.message };
    }
  }

  recordTaskCompleted(_taskId = null, priority = 'medium') {
    try {
      this.currentDayStats.tasksCompleted++;

      if (!this.currentDayStats.tasksByPriority) {
        this.currentDayStats.tasksByPriority = { low: 0, medium: 0, high: 0 };
      }
      this.currentDayStats.tasksByPriority[priority] =
        (this.currentDayStats.tasksByPriority[priority] || 0) + 1;

      this._updateOverallStats('totalTasksCompleted', 1);
      this._saveAnalyticsData();

      this.logger.info('Recorded task completion');
      return { success: true };
    } catch (error) {
      this.logger.error('Error recording task completion:', error);
      return { success: false, error: error.message };
    }
  }

  recordTabTracking(count = 1) {
    try {
      this.currentDayStats.tabsTracked += count;
      this._updateOverallStats('totalTabsTracked', count);
      this._saveAnalyticsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error recording tab tracking:', error);
      return { success: false, error: error.message };
    }
  }

  recordAppUsage(appName, durationMinutes) {
    try {
      this.currentDayStats.appsUsed++;

      if (!this.currentDayStats.appUsage) {
        this.currentDayStats.appUsage = {};
      }
      this.currentDayStats.appUsage[appName] =
        (this.currentDayStats.appUsage[appName] || 0) + durationMinutes;

      this._saveAnalyticsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error recording app usage:', error);
      return { success: false, error: error.message };
    }
  }

  recordReminderSent() {
    try {
      this.currentDayStats.remindersSent++;
      this._updateOverallStats('totalRemindersSent', 1);
      this._saveAnalyticsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error recording reminder:', error);
      return { success: false, error: error.message };
    }
  }

  recordDistraction() {
    try {
      this.currentDayStats.distractions++;
      this._updateOverallStats('totalDistractions', 1);
      this._saveAnalyticsData();
      return { success: true };
    } catch (error) {
      this.logger.error('Error recording distraction:', error);
      return { success: false, error: error.message };
    }
  }

  _updateOverallStats(key, value) {
    if (!this.analyticsData.overall) {
      this.analyticsData.overall = {};
    }
    this.analyticsData.overall[key] = (this.analyticsData.overall[key] || 0) + value;
  }

  getDailyStats(date = new Date()) {
    const dayKey = this._getDayKey(date);
    return this.analyticsData.dailyStats[dayKey] || null;
  }

  getWeeklyStats(date = new Date()) {
    try {
      const weekStart = startOfWeek(date);
      const weekEnd = endOfWeek(date);
      const stats = [];

      Object.keys(this.analyticsData.dailyStats).forEach((dayKey) => {
        const dayDate = new Date(dayKey);
        if (dayDate >= weekStart && dayDate <= weekEnd) {
          stats.push(this.analyticsData.dailyStats[dayKey]);
        }
      });

      return this._aggregateStats(stats);
    } catch (error) {
      this.logger.error('Error getting weekly stats:', error);
      return null;
    }
  }

  getMonthlyStats(date = new Date()) {
    try {
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);
      const stats = [];

      Object.keys(this.analyticsData.dailyStats).forEach((dayKey) => {
        const dayDate = new Date(dayKey);
        if (dayDate >= monthStart && dayDate <= monthEnd) {
          stats.push(this.analyticsData.dailyStats[dayKey]);
        }
      });

      return this._aggregateStats(stats);
    } catch (error) {
      this.logger.error('Error getting monthly stats:', error);
      return null;
    }
  }

  _aggregateStats(statsArray) {
    if (!statsArray || statsArray.length === 0) {
      return {
        totalFocusSessions: 0,
        totalFocusMinutes: 0,
        totalTasksCompleted: 0,
        totalTabsTracked: 0,
        totalAppsUsed: 0,
        totalRemindersSent: 0,
        totalDistractions: 0,
        daysWithData: 0,
        averageFocusMinutesPerDay: 0,
      };
    }

    const aggregated = {
      totalFocusSessions: 0,
      totalFocusMinutes: 0,
      totalTasksCompleted: 0,
      totalTabsTracked: 0,
      totalAppsUsed: 0,
      totalRemindersSent: 0,
      totalDistractions: 0,
      daysWithData: statsArray.length,
      appUsageTotals: {},
      productiveHours: {},
    };

    statsArray.forEach((stat) => {
      aggregated.totalFocusSessions += stat.focusSessions || 0;
      aggregated.totalFocusMinutes += stat.totalFocusMinutes || 0;
      aggregated.totalTasksCompleted += stat.tasksCompleted || 0;
      aggregated.totalTabsTracked += stat.tabsTracked || 0;
      aggregated.totalAppsUsed += stat.appsUsed || 0;
      aggregated.totalRemindersSent += stat.remindersSent || 0;
      aggregated.totalDistractions += stat.distractions || 0;

      if (stat.appUsage) {
        Object.keys(stat.appUsage).forEach((app) => {
          aggregated.appUsageTotals[app] =
            (aggregated.appUsageTotals[app] || 0) + stat.appUsage[app];
        });
      }

      if (stat.productiveHours) {
        stat.productiveHours.forEach((hour) => {
          aggregated.productiveHours[hour] = (aggregated.productiveHours[hour] || 0) + 1;
        });
      }
    });

    aggregated.averageFocusMinutesPerDay = Math.round(
      aggregated.totalFocusMinutes / statsArray.length
    );
    aggregated.mostProductiveHour = this._findMostFrequentHour(aggregated.productiveHours);
    aggregated.mostUsedApps = this._getTopItems(aggregated.appUsageTotals, 5);

    return aggregated;
  }

  _findMostFrequentHour(hourCounts) {
    let maxHour = 9;
    let maxCount = 0;

    Object.keys(hourCounts).forEach((hour) => {
      if (hourCounts[hour] > maxCount) {
        maxCount = hourCounts[hour];
        maxHour = parseInt(hour);
      }
    });

    return maxHour;
  }

  _getTopItems(obj, limit = 5) {
    return Object.entries(obj)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([key, value]) => ({ name: key, value }));
  }

  getOverallStats() {
    return this.analyticsData.overall || {};
  }

  getProductivityReport(days = 30) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const periodStats = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayKey = this._getDayKey(d);
        if (this.analyticsData.dailyStats[dayKey]) {
          periodStats.push(this.analyticsData.dailyStats[dayKey]);
        }
      }

      const aggregated = this._aggregateStats(periodStats);
      const streak = this._calculateCurrentStreak();

      return {
        period: { days, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        summary: aggregated,
        currentStreak: streak,
        trend: this._calculateTrend(periodStats),
      };
    } catch (error) {
      this.logger.error('Error generating productivity report:', error);
      return null;
    }
  }

  _calculateCurrentStreak() {
    let streak = 0;
    let currentDate = new Date();

    while (true) {
      const dayKey = this._getDayKey(currentDate);
      const dayStats = this.analyticsData.dailyStats[dayKey];

      if (dayStats && (dayStats.focusSessions > 0 || dayStats.tasksCompleted > 0)) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  _calculateTrend(statsArray) {
    if (statsArray.length < 3) return 'stable';

    const recent = statsArray.slice(-7);
    const firstHalf = recent.slice(0, 3);
    const secondHalf = recent.slice(-3);

    const firstAvg =
      firstHalf.reduce((sum, s) => sum + (s.totalFocusMinutes || 0), 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, s) => sum + (s.totalFocusMinutes || 0), 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / (firstAvg || 1);
    if (change > 0.2) return 'improving';
    if (change < -0.2) return 'declining';
    return 'stable';
  }

  exportData(format = 'json') {
    try {
      if (format === 'json') {
        return JSON.stringify(this.analyticsData, null, 2);
      }
      return null;
    } catch (error) {
      this.logger.error('Error exporting analytics data:', error);
      return null;
    }
  }

  clearOldData(daysToKeep = 90) {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysToKeep);

      Object.keys(this.analyticsData.dailyStats).forEach((dayKey) => {
        const dayDate = new Date(dayKey);
        if (dayDate < cutoff) {
          delete this.analyticsData.dailyStats[dayKey];
        }
      });

      this._saveAnalyticsData();
      this.logger.info(`Cleared analytics data older than ${daysToKeep} days`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error clearing old data:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = {
  AnalyticsManager,
  ANALYTICS_METRICS,
};
