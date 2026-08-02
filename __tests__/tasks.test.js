const TaskManager = require('../tasks');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
}));

// Mock electron Notification
jest.mock('electron', () => ({
  Notification: jest.fn().mockImplementation(() => ({
    show: jest.fn(),
  })),
}));

describe('TaskManager', () => {
  let taskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
  });

  describe('Basic Task Operations', () => {
    test('should create task manager with empty tasks', () => {
      expect(taskManager.tasks.length).toBe(0);
    });

    test('should add a new task', () => {
      const tasks = taskManager.addTask({
        title: 'Test Task',
        description: 'Test description',
        priority: 'high',
      });
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe('Test Task');
      expect(tasks[0].priority).toBe('high');
    });

    test('should edit an existing task', () => {
      const tasks = taskManager.addTask({ title: 'Original' });
      const taskId = tasks[0].id;
      const updated = taskManager.editTask(taskId, { title: 'Updated' });
      expect(updated[0].title).toBe('Updated');
    });

    test('should delete a task', () => {
      const tasks = taskManager.addTask({ title: 'To Delete' });
      const taskId = tasks[0].id;
      const afterDelete = taskManager.deleteTask(taskId);
      expect(afterDelete.length).toBe(0);
    });

    test('should toggle task completion', () => {
      const tasks = taskManager.addTask({ title: 'Test' });
      const taskId = tasks[0].id;
      taskManager.toggleTaskCompletion(taskId);
      expect(taskManager.tasks[0].completed).toBe(true);
    });
  });

  describe('Tag Operations', () => {
    test('should have default tags', () => {
      expect(taskManager.tags.length).toBe(4);
    });

    test('should add a new tag', () => {
      const tags = taskManager.addTag({ name: 'New Tag', color: '#ff0000' });
      expect(tags.length).toBe(5);
    });
  });

  describe('Statistics', () => {
    test('should calculate correct statistics', () => {
      taskManager.addTask({ title: 'High Priority', priority: 'high' });
      taskManager.addTask({ title: 'Completed', priority: 'medium' });
      const tasks = taskManager.addTask({ title: 'Another', priority: 'low' });

      // Complete one task (the second one)
      taskManager.toggleTaskCompletion(tasks[1].id);

      const stats = taskManager.getStatistics();
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(2);
    });
  });

  describe('Search Tasks', () => {
    test('should find tasks by title', () => {
      taskManager.addTask({ title: 'Buy groceries', description: 'Milk, eggs, bread' });
      taskManager.addTask({ title: 'Walk the dog', description: 'Evening walk' });
      taskManager.addTask({ title: 'Finish report', description: 'Q4 sales report' });

      const results = taskManager.searchTasks('groceries');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Buy groceries');
    });

    test('should find tasks by description', () => {
      taskManager.addTask({ title: 'Buy groceries', description: 'Milk, eggs, bread' });
      taskManager.addTask({ title: 'Walk the dog', description: 'Evening walk' });
      taskManager.addTask({ title: 'Finish report', description: 'Q4 sales report' });

      const results = taskManager.searchTasks('sales');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Finish report');
    });

    test('should be case insensitive', () => {
      taskManager.addTask({ title: 'Buy groceries', description: 'Milk, eggs, bread' });

      const results1 = taskManager.searchTasks('GROCERIES');
      const results2 = taskManager.searchTasks('groceries');
      expect(results1.length).toBe(1);
      expect(results2.length).toBe(1);
    });

    test('should exclude archived tasks by default', () => {
      taskManager.addTask({ title: 'Archived task', description: 'This is archived' });
      const tasks = taskManager.getSortedTasks();
      taskManager.archiveTask(tasks[0].id);

      const results = taskManager.searchTasks('archived');
      expect(results.length).toBe(0);
    });

    test('should include archived tasks when requested', () => {
      taskManager.addTask({ title: 'Archived task', description: 'This is archived' });
      const tasks = taskManager.getSortedTasks();
      taskManager.archiveTask(tasks[0].id);

      const results = taskManager.searchTasks('archived', { includeArchived: true });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Archived task');
    });

    test('should exclude completed tasks when requested', () => {
      taskManager.addTask({ title: 'Completed task', description: 'This is done' });
      const tasks = taskManager.getSortedTasks();
      taskManager.toggleTaskCompletion(tasks[0].id);

      const results = taskManager.searchTasks('completed', { includeCompleted: false });
      expect(results.length).toBe(0);
    });
  });

  describe('Debounced Save', () => {
    test('should have saveTasksImmediate method', () => {
      expect(typeof taskManager.saveTasksImmediate).toBe('function');
    });

    test('should have cleanup method', () => {
      expect(typeof taskManager.cleanup).toBe('function');
    });

    test('cleanup should not throw', () => {
      expect(() => taskManager.cleanup()).not.toThrow();
    });
  });
});
