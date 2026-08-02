const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');
const { format, isSameDay, addDays, differenceInDays, startOfDay } = require('date-fns');

const HABITS_DATA_PATH = 'habits-data.json';

const HABIT_FREQUENCY = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  CUSTOM: 'custom',
};

const HABIT_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
};

class HabitManager {
  constructor(logger) {
    this.logger = logger || console;
    this.habitsData = this._loadHabitsData();
  }

  _loadHabitsData() {
    try {
      const filePath = getDataFilePath(HABITS_DATA_PATH);
      return safeReadJson(filePath, { habits: [], completions: {} });
    } catch (error) {
      this.logger.error('Error loading habits data:', error);
      return { habits: [], completions: {} };
    }
  }

  _saveHabitsData() {
    try {
      const filePath = getDataFilePath(HABITS_DATA_PATH);
      writeJsonAtomic(filePath, this.habitsData);
    } catch (error) {
      this.logger.error('Error saving habits data:', error);
    }
  }

  _getDayKey(date = new Date()) {
    return format(date, 'yyyy-MM-dd');
  }

  createHabit(habitData) {
    try {
      const id = `habit-${Date.now()}`;
      const habit = {
        id,
        name: habitData.name || 'New Habit',
        description: habitData.description || '',
        frequency: habitData.frequency || HABIT_FREQUENCY.DAILY,
        targetDays: habitData.targetDays || [0, 1, 2, 3, 4, 5, 6],
        targetCount: habitData.targetCount || 1,
        color: habitData.color || '#6366f1',
        icon: habitData.icon || 'star',
        reminderTime: habitData.reminderTime || null,
        reminderEnabled: habitData.reminderEnabled || false,
        streak: 0,
        bestStreak: 0,
        totalCompletions: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: HABIT_STATUS.ACTIVE,
        tags: habitData.tags || [],
        notes: habitData.notes || '',
      };

      this.habitsData.habits.push(habit);
      this._saveHabitsData();

      this.logger.info(`Created habit: ${habit.name}`);
      return { success: true, habit };
    } catch (error) {
      this.logger.error('Error creating habit:', error);
      return { success: false, error: error.message };
    }
  }

  getHabit(id) {
    return this.habitsData.habits.find((h) => h.id === id) || null;
  }

  getAllHabits(status = HABIT_STATUS.ACTIVE) {
    return this.habitsData.habits.filter((h) => h.status === status);
  }

  updateHabit(id, updates) {
    try {
      const habitIndex = this.habitsData.habits.findIndex((h) => h.id === id);
      if (habitIndex === -1) {
        return { success: false, error: 'Habit not found' };
      }

      this.habitsData.habits[habitIndex] = {
        ...this.habitsData.habits[habitIndex],
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      this._saveHabitsData();
      this.logger.info(`Updated habit: ${id}`);
      return { success: true, habit: this.habitsData.habits[habitIndex] };
    } catch (error) {
      this.logger.error('Error updating habit:', error);
      return { success: false, error: error.message };
    }
  }

  deleteHabit(id) {
    try {
      this.habitsData.habits = this.habitsData.habits.filter((h) => h.id !== id);
      delete this.habitsData.completions[id];
      this._saveHabitsData();
      this.logger.info(`Deleted habit: ${id}`);
      return { success: true };
    } catch (error) {
      this.logger.error('Error deleting habit:', error);
      return { success: false, error: error.message };
    }
  }

  completeHabit(id, date = new Date(), count = 1) {
    try {
      const habit = this.getHabit(id);
      if (!habit) {
        return { success: false, error: 'Habit not found' };
      }

      const dayKey = this._getDayKey(date);

      if (!this.habitsData.completions[id]) {
        this.habitsData.completions[id] = {};
      }

      if (!this.habitsData.completions[id][dayKey]) {
        this.habitsData.completions[id][dayKey] = {
          count: 0,
          completedAt: [],
        };
      }

      this.habitsData.completions[id][dayKey].count += count;
      this.habitsData.completions[id][dayKey].completedAt.push(new Date().toISOString());

      this._updateHabitStats(id);
      this._saveHabitsData();

      this.logger.info(`Completed habit: ${habit.name}`);
      return { success: true, habit: this.getHabit(id) };
    } catch (error) {
      this.logger.error('Error completing habit:', error);
      return { success: false, error: error.message };
    }
  }

  uncompleteHabit(id, date = new Date()) {
    try {
      const habit = this.getHabit(id);
      if (!habit) {
        return { success: false, error: 'Habit not found' };
      }

      const dayKey = this._getDayKey(date);

      if (this.habitsData.completions[id] && this.habitsData.completions[id][dayKey]) {
        delete this.habitsData.completions[id][dayKey];
        this._updateHabitStats(id);
        this._saveHabitsData();
      }

      this.logger.info(`Uncompleted habit: ${habit.name}`);
      return { success: true, habit: this.getHabit(id) };
    } catch (error) {
      this.logger.error('Error uncompleting habit:', error);
      return { success: false, error: error.message };
    }
  }

  isHabitCompleted(id, date = new Date()) {
    const dayKey = this._getDayKey(date);
    const completions = this.habitsData.completions[id]?.[dayKey];
    const habit = this.getHabit(id);

    if (!habit || !completions) return false;
    return completions.count >= habit.targetCount;
  }

  getHabitCompletionCount(id, date = new Date()) {
    const dayKey = this._getDayKey(date);
    return this.habitsData.completions[id]?.[dayKey]?.count || 0;
  }

  _updateHabitStats(id) {
    const habitIndex = this.habitsData.habits.findIndex((h) => h.id === id);
    if (habitIndex === -1) return;

    const habit = this.habitsData.habits[habitIndex];
    const completions = this.habitsData.completions[id] || {};

    let totalCompletions = 0;
    Object.values(completions).forEach((day) => {
      totalCompletions += day.count;
    });

    const streak = this._calculateCurrentStreak(id);
    const bestStreak = this._calculateBestStreak(id);

    this.habitsData.habits[habitIndex] = {
      ...habit,
      totalCompletions,
      streak,
      bestStreak: Math.max(habit.bestStreak, bestStreak),
    };
  }

  _calculateCurrentStreak(id) {
    let streak = 0;
    let currentDate = startOfDay(new Date());

    while (true) {
      if (this.isHabitCompleted(id, currentDate)) {
        streak++;
        currentDate = addDays(currentDate, -1);
      } else if (isSameDay(currentDate, new Date())) {
        currentDate = addDays(currentDate, -1);
      } else {
        break;
      }
    }

    return streak;
  }

  _calculateBestStreak(id) {
    const completions = this.habitsData.completions[id] || {};
    const sortedDates = Object.keys(completions).sort();

    if (sortedDates.length === 0) return 0;

    let bestStreak = 0;
    let currentStreak = 0;
    let previousDate = null;

    sortedDates.forEach((dateStr) => {
      const currentDate = new Date(dateStr);
      if (previousDate) {
        const daysDiff = differenceInDays(currentDate, previousDate);
        if (daysDiff === 1) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }
      } else {
        currentStreak = 1;
      }

      bestStreak = Math.max(bestStreak, currentStreak);
      previousDate = currentDate;
    });

    return bestStreak;
  }

  getHabitProgress(id, days = 30) {
    try {
      const habit = this.getHabit(id);
      if (!habit) {
        return { success: false, error: 'Habit not found' };
      }

      const endDate = new Date();
      const startDate = addDays(endDate, -days);
      const progress = [];

      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayKey = this._getDayKey(d);
        const completed = this.isHabitCompleted(id, d);
        const count = this.getHabitCompletionCount(id, d);

        progress.push({
          date: dayKey,
          completed,
          count,
          targetMet: count >= habit.targetCount,
        });
      }

      return {
        success: true,
        progress,
        habit,
        summary: {
          totalCompleted: progress.filter((p) => p.completed).length,
          completionRate: Math.round(
            (progress.filter((p) => p.completed).length / progress.length) * 100
          ),
        },
      };
    } catch (error) {
      this.logger.error('Error getting habit progress:', error);
      return { success: false, error: error.message };
    }
  }

  getHabitsSummary() {
    try {
      const activeHabits = this.getAllHabits(HABIT_STATUS.ACTIVE);
      const today = new Date();

      let completedToday = 0;
      let totalStreak = 0;
      let bestStreak = 0;

      activeHabits.forEach((habit) => {
        if (this.isHabitCompleted(habit.id, today)) {
          completedToday++;
        }
        totalStreak += habit.streak || 0;
        bestStreak = Math.max(bestStreak, habit.bestStreak || 0);
      });

      return {
        success: true,
        summary: {
          totalActiveHabits: activeHabits.length,
          completedToday,
          completionRateToday:
            activeHabits.length > 0 ? Math.round((completedToday / activeHabits.length) * 100) : 0,
          averageStreak:
            activeHabits.length > 0 ? Math.round(totalStreak / activeHabits.length) : 0,
          bestStreak,
        },
      };
    } catch (error) {
      this.logger.error('Error getting habits summary:', error);
      return { success: false, error: error.message };
    }
  }

  archiveHabit(id) {
    return this.updateHabit(id, { status: HABIT_STATUS.ARCHIVED });
  }

  pauseHabit(id) {
    return this.updateHabit(id, { status: HABIT_STATUS.PAUSED });
  }

  resumeHabit(id) {
    return this.updateHabit(id, { status: HABIT_STATUS.ACTIVE });
  }

  exportHabitsData() {
    try {
      return JSON.stringify(this.habitsData, null, 2);
    } catch (error) {
      this.logger.error('Error exporting habits data:', error);
      return null;
    }
  }
}

module.exports = {
  HabitManager,
  HABIT_FREQUENCY,
  HABIT_STATUS,
};
