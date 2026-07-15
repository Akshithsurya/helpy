const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');

const TASKS_DATA_PATH = 'tasks-data.json';
const TAGS_DATA_PATH = 'tags-data.json';

const DEFAULT_TAGS = [
  { id: 'tag-1', name: 'Work', color: '#3B82F6' },
  { id: 'tag-2', name: 'Personal', color: '#10B981' },
  { id: 'tag-3', name: 'Urgent', color: '#EF4444' },
  { id: 'tag-4', name: 'Important', color: '#F59E0B' },
];

class TaskManager {
  constructor(store, logger) {
    this.logger = logger || console;
    this.store = store;
    this.tasksData = this._loadTasksData();
    this.tagsData = this._loadTagsData();
    this.saveTimeout = null;
  }

  _loadTasksData() {
    try {
      const filePath = getDataFilePath(TASKS_DATA_PATH);
      return safeReadJson(filePath, { tasks: [] });
    } catch (error) {
      this.logger.error('Error loading tasks data:', error);
      return { tasks: [] };
    }
  }

  _loadTagsData() {
    try {
      const filePath = getDataFilePath(TAGS_DATA_PATH);
      const data = safeReadJson(filePath, { tags: DEFAULT_TAGS });
      if (!data.tags || data.tags.length === 0) {
        data.tags = DEFAULT_TAGS;
      }
      return data;
    } catch (error) {
      this.logger.error('Error loading tags data:', error);
      return { tags: DEFAULT_TAGS };
    }
  }

  _saveTasksData() {
    try {
      const filePath = getDataFilePath(TASKS_DATA_PATH);
      writeJsonAtomic(filePath, this.tasksData);
    } catch (error) {
      this.logger.error('Error saving tasks data:', error);
    }
  }

  _saveTagsData() {
    try {
      const filePath = getDataFilePath(TAGS_DATA_PATH);
      writeJsonAtomic(filePath, this.tagsData);
    } catch (error) {
      this.logger.error('Error saving tags data:', error);
    }
  }

  saveTasksDebounced() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this._saveTasksData();
    }, 300);
  }

  saveTasksImmediate() {
    this._saveTasksData();
  }

  cleanup() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  }

  get tasks() {
    return this.tasksData.tasks;
  }

  get tags() {
    return this.tagsData.tags;
  }

  getTasks() {
    return this.tasks;
  }

  addTask(taskData) {
    try {
      const id = `task-${Date.now()}`;
      const task = {
        id,
        title: taskData.title || 'New Task',
        description: taskData.description || '',
        priority: taskData.priority || 'medium',
        deadline: taskData.deadline || null,
        completed: false,
        archived: false,
        tags: taskData.tags || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.tasksData.tasks.push(task);
      this.saveTasksDebounced();
      this.logger.info(`Created task: ${task.title}`);
      return this.tasks;
    } catch (error) {
      this.logger.error('Error adding task:', error);
      return this.tasks;
    }
  }

  editTask(id, updates) {
    try {
      const index = this.tasksData.tasks.findIndex((t) => t.id === id);
      if (index === -1) {
        return this.tasks;
      }

      this.tasksData.tasks[index] = {
        ...this.tasksData.tasks[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      this.saveTasksDebounced();
      return this.tasks;
    } catch (error) {
      this.logger.error('Error editing task:', error);
      return this.tasks;
    }
  }

  updateTask(id, updates) {
    return this.editTask(id, updates);
  }

  deleteTask(id) {
    try {
      this.tasksData.tasks = this.tasksData.tasks.filter((t) => t.id !== id);
      this.saveTasksDebounced();
      this.logger.info(`Deleted task: ${id}`);
      return this.tasks;
    } catch (error) {
      this.logger.error('Error deleting task:', error);
      return this.tasks;
    }
  }

  toggleTaskCompletion(id) {
    try {
      const index = this.tasksData.tasks.findIndex((t) => t.id === id);
      if (index === -1) {
        return this.tasks;
      }

      this.tasksData.tasks[index] = {
        ...this.tasksData.tasks[index],
        completed: !this.tasksData.tasks[index].completed,
        updatedAt: new Date().toISOString(),
      };
      this.saveTasksDebounced();
      return this.tasks;
    } catch (error) {
      this.logger.error('Error toggling task completion:', error);
      return this.tasks;
    }
  }

  archiveTask(id) {
    try {
      const index = this.tasksData.tasks.findIndex((t) => t.id === id);
      if (index === -1) {
        return this.tasks;
      }

      this.tasksData.tasks[index] = {
        ...this.tasksData.tasks[index],
        archived: true,
        updatedAt: new Date().toISOString(),
      };
      this.saveTasksDebounced();
      return this.tasks;
    } catch (error) {
      this.logger.error('Error archiving task:', error);
      return this.tasks;
    }
  }

  getSortedTasks() {
    return [...this.tasks].sort((a, b) => {
      if (a.priority !== b.priority) {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (a.deadline && b.deadline) {
        return new Date(a.deadline) - new Date(b.deadline);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  searchTasks(query, options = {}) {
    const { includeArchived = false, includeCompleted = true } = options;
    const lowerQuery = query.toLowerCase();
    return this.tasks.filter((task) => {
      if (!includeArchived && task.archived) return false;
      if (!includeCompleted && task.completed) return false;

      return (
        task.title.toLowerCase().includes(lowerQuery) ||
        task.description.toLowerCase().includes(lowerQuery)
      );
    });
  }

  getStatistics() {
    const total = this.tasks.filter((t) => !t.archived).length;
    const completed = this.tasks.filter((t) => !t.archived && t.completed).length;
    const pending = total - completed;
    return { total, completed, pending };
  }

  addTag(tagData) {
    try {
      const id = `tag-${Date.now()}`;
      const tag = {
        id,
        name: tagData.name || 'New Tag',
        color: tagData.color || '#6366F1',
      };

      this.tagsData.tags.push(tag);
      this._saveTagsData();
      this.logger.info(`Created tag: ${tag.name}`);
      return this.tags;
    } catch (error) {
      this.logger.error('Error adding tag:', error);
      return this.tags;
    }
  }
}

module.exports = TaskManager;
