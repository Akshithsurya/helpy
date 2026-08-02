const { HabitManager, HABIT_FREQUENCY } = require('../habits');

// Mock file store
jest.mock('../shared/file-store', () => ({
  safeReadJson: jest.fn(() => ({ habits: [], completions: {} })),
  writeJsonAtomic: jest.fn(),
}));

// Mock app paths
jest.mock('../shared/app-paths', () => ({
  getDataFilePath: jest.fn(() => 'test-path'),
}));

describe('HabitManager', () => {
  let habitManager;

  beforeEach(() => {
    habitManager = new HabitManager();
  });

  describe('Basic Habit Operations', () => {
    test('should create habit manager with empty habits', () => {
      const habits = habitManager.getAllHabits();
      expect(habits.length).toBe(0);
    });

    test('should add a new habit', () => {
      const result = habitManager.createHabit({
        name: 'Exercise',
        description: 'Daily exercise',
        frequency: HABIT_FREQUENCY.DAILY,
      });
      expect(result.success).toBe(true);
      expect(result.habit.name).toBe('Exercise');
    });

    test('should get a habit by ID', () => {
      const createResult = habitManager.createHabit({ name: 'Read' });
      const habit = habitManager.getHabit(createResult.habit.id);
      expect(habit).toBeDefined();
      expect(habit.name).toBe('Read');
    });

    test('should update an existing habit', () => {
      const createResult = habitManager.createHabit({ name: 'Original' });
      const updateResult = habitManager.updateHabit(createResult.habit.id, {
        name: 'Updated',
      });
      expect(updateResult.success).toBe(true);
    });

    test('should delete a habit', () => {
      const createResult = habitManager.createHabit({ name: 'To Delete' });
      const deleteResult = habitManager.deleteHabit(createResult.habit.id);
      expect(deleteResult.success).toBe(true);
    });
  });

  describe('Habit Completion', () => {
    test('should complete a habit', () => {
      const createResult = habitManager.createHabit({ name: 'Test Habit' });
      const completeResult = habitManager.completeHabit(createResult.habit.id);
      expect(completeResult.success).toBe(true);
    });

    test('should uncomplete a habit', () => {
      const createResult = habitManager.createHabit({ name: 'Test Habit' });
      habitManager.completeHabit(createResult.habit.id);
      const uncompleteResult = habitManager.uncompleteHabit(createResult.habit.id);
      expect(uncompleteResult.success).toBe(true);
    });

    test('should check if habit is completed', () => {
      const createResult = habitManager.createHabit({ name: 'Test Habit' });
      habitManager.completeHabit(createResult.habit.id);
      const isCompleted = habitManager.isHabitCompleted(createResult.habit.id);
      expect(isCompleted).toBe(true);
    });
  });

  describe('Habit Status', () => {
    test('should archive a habit', () => {
      const createResult = habitManager.createHabit({ name: 'To Archive' });
      const archiveResult = habitManager.archiveHabit(createResult.habit.id);
      expect(archiveResult.success).toBe(true);
    });

    test('should pause a habit', () => {
      const createResult = habitManager.createHabit({ name: 'To Pause' });
      const pauseResult = habitManager.pauseHabit(createResult.habit.id);
      expect(pauseResult.success).toBe(true);
    });

    test('should resume a habit', () => {
      const createResult = habitManager.createHabit({ name: 'To Resume' });
      habitManager.pauseHabit(createResult.habit.id);
      const resumeResult = habitManager.resumeHabit(createResult.habit.id);
      expect(resumeResult.success).toBe(true);
    });
  });

  describe('Habit Progress', () => {
    test('should get habit progress', () => {
      const createResult = habitManager.createHabit({ name: 'Progress Test' });
      const progress = habitManager.getHabitProgress(createResult.habit.id);
      expect(progress.success).toBe(true);
    });

    test('should get habits summary', () => {
      const summary = habitManager.getHabitsSummary();
      expect(summary.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent habit gracefully', () => {
      const habit = habitManager.getHabit('non-existent-id');
      expect(habit).toBeNull();
    });

    test('should return error when updating non-existent habit', () => {
      const result = habitManager.updateHabit('non-existent-id', { name: 'Test' });
      expect(result.success).toBe(false);
    });
  });
});
