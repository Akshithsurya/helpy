const {
  parsePlanArguments,
  breakDownIntoTasks,
  createPlanConfig,
  createPlanConfigOptimized,
  normalizeBoundedInt,
  normalizeChunkSizeMinutes,
  DEFAULT_PRESETS,
  loadPresets,
  listPresets,
  validateInput,
  validatePlanInput,
  recordPerformance,
  getPerformanceMetrics,
  getAverageResponseTime,
  getErrorRate,
  exportPlan,
  exportPlanEnhanced,
  calculateSessionStats,
  createBreakSchedule,
  applyBreakSchedule,
  startPlan,
  completePlan,
  cancelPlan,
  completeTask,
  findPresetByName,
  generateId,
  // New functions for testing
  getAutocompleteSuggestions,
  addToPlanHistory,
  getPlanHistory,
  // Newly added features
  getSmartSuggestions,
  comparePlans,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  createBatchPlans,
  SimpleCache,
  ADHDPlanSupport,
} = require('../chrome-extension/shared/plan-command');

describe('plan-command module', () => {
  describe('normalizeBoundedInt', () => {
    test('should clamp values within min/max', () => {
      expect(normalizeBoundedInt(5, 30, 5, 240)).toBe(5);
      expect(normalizeBoundedInt(240, 30, 5, 240)).toBe(240);
      expect(normalizeBoundedInt(100, 30, 5, 240)).toBe(100);
    });

    test('should use fallback for invalid values', () => {
      expect(normalizeBoundedInt(null, 30)).toBe(30);
      expect(normalizeBoundedInt(undefined, 30)).toBe(30);
      expect(normalizeBoundedInt('invalid', 30)).toBe(30);
      expect(normalizeBoundedInt(NaN, 30)).toBe(30);
    });

    test('should use default min/max when not provided', () => {
      expect(normalizeBoundedInt(1000, 30)).toBe(240);
      expect(normalizeBoundedInt(0, 30)).toBe(5);
    });
  });

  describe('normalizeChunkSizeMinutes', () => {
    test('should clamp chunk size to reasonable values', () => {
      expect(normalizeChunkSizeMinutes(1)).toBe(5);
      expect(normalizeChunkSizeMinutes(100)).toBe(60);
      expect(normalizeChunkSizeMinutes(30)).toBe(30);
    });

    test('should use fallback for invalid values', () => {
      expect(normalizeChunkSizeMinutes(null)).toBe(15);
      expect(normalizeChunkSizeMinutes(undefined)).toBe(15);
    });
  });

  describe('validateInput', () => {
    test('should sanitize input and remove dangerous characters', () => {
      expect(validateInput('<script>alert(1)</script>', 100)).toBe('scriptalert(1)/script');
      expect(validateInput('   test   ', 100)).toBe('test');
    });

    test('should truncate long inputs', () => {
      const longStr = 'a'.repeat(200);
      expect(validateInput(longStr, 50).length).toBe(50);
    });

    test('should handle empty and non-string inputs', () => {
      expect(validateInput('', 100)).toBe('');
      expect(validateInput(null, 100)).toBe('');
      expect(validateInput(undefined, 100)).toBe('');
    });
  });

  describe('validatePlanInput', () => {
    test('should return valid for good inputs', () => {
      const result = validatePlanInput('My Plan', 'My Goal');
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('should return errors for invalid inputs', () => {
      const longTitle = 'a'.repeat(200);
      const longGoal = 'b'.repeat(1000);
      const result = validatePlanInput(longTitle, longGoal);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should include warnings when appropriate', () => {
      const result = validatePlanInput('', 'Goal');
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe('parsePlanArguments', () => {
    test('should parse preset arguments', () => {
      expect(parsePlanArguments('work').title).toBe('Work Session');
      expect(parsePlanArguments('study').title).toBe('Study Session');
    });

    test('should parse custom duration and title', () => {
      const result = parsePlanArguments('My Custom Plan 90');
      expect(result.title).toBe('My Custom Plan');
      expect(result.durationMinutes).toBe(90);
    });

    test('should parse durations with units (m, min, minutes, h, hours)', () => {
      expect(parsePlanArguments('Test 30m').durationMinutes).toBe(30);
      expect(parsePlanArguments('Test 45 minutes').durationMinutes).toBe(45);
      expect(parsePlanArguments('Test 1h').durationMinutes).toBe(60);
      expect(parsePlanArguments('Test 1h30m').durationMinutes).toBe(90);
    });

    test('should clamp duration to valid range', () => {
      expect(parsePlanArguments('Short Plan 1').durationMinutes).toBe(5);
      expect(parsePlanArguments('Long Plan 500').durationMinutes).toBe(240);
    });

    test('should handle empty arguments', () => {
      const result = parsePlanArguments('');
      expect(result.title).toBe('Planned session');
      expect(result.durationMinutes).toBe(30);
    });

    test('should parse --goal, --chunk, --break and --tags flags', () => {
      const result = parsePlanArguments(
        'work --goal "Finish report" --chunk 20 --break 5 --tags work,urgent'
      );
      expect(result.goal).toBe('Finish report');
      expect(result.chunkSizeMinutes).toBe(20);
      expect(result.breakMinutes).toBe(5);
      expect(result.tags).toEqual(['work', 'urgent']);
    });
  });

  describe('breakDownIntoTasks', () => {
    test('should split plan into tasks based on chunk size', () => {
      const tasks = breakDownIntoTasks({ title: 'Test Plan', durationMinutes: 60 }, 15);
      const focusTasks = tasks.filter((t) => !t.isBreak);
      expect(focusTasks.length).toBe(4);
    });

    test('should include break tasks when includeBreaks is true', () => {
      const tasks = breakDownIntoTasks({ title: 'Test Plan', durationMinutes: 60 }, 15, 5, true);
      const breakTasks = tasks.filter((t) => t.isBreak);
      expect(breakTasks.length).toBe(3);
    });

    test('should handle indivisible durations', () => {
      const tasks = breakDownIntoTasks({ title: 'Test Plan', durationMinutes: 50 }, 15);
      const focusTasks = tasks.filter((t) => !t.isBreak);
      expect(focusTasks.length).toBe(4);
    });

    test('should create single task if duration matches chunk size', () => {
      const tasks = breakDownIntoTasks({ title: 'Test Plan', durationMinutes: 30 }, 30);
      const focusTasks = tasks.filter((t) => !t.isBreak);
      expect(focusTasks.length).toBe(1);
    });
  });

  describe('createPlanConfig', () => {
    test('should create plan config from command args', () => {
      const config = createPlanConfig('work');
      expect(config.title).toBe('Work Session');
      expect(config.tasks).toBeDefined();
      expect(Array.isArray(config.tasks)).toBe(true);
      expect(config.status).toBe('pending');
      expect(config.id).toBeDefined();
    });

    test('should accept custom options', () => {
      const customDate = '2026-01-01T00:00:00.000Z';
      const config = createPlanConfig('', {
        title: 'Custom Plan',
        goal: 'Custom goal',
        durationMinutes: 120,
        chunkSizeMinutes: 20,
        breakMinutes: 10,
        source: 'test',
        createdAt: customDate,
        tags: ['custom', 'test'],
        theme: 'dark',
        icon: 'target',
      });
      expect(config.title).toBe('Custom Plan');
      expect(config.goal).toBe('Custom goal');
      expect(config.durationMinutes).toBe(120);
      expect(config.tags).toEqual(['custom', 'test']);
      expect(config.theme).toBe('dark');
      expect(config.icon).toBe('target');
    });

    test('should override preset with custom options', () => {
      const config = createPlanConfig('work', {
        title: 'Overridden Title',
        durationMinutes: 90,
      });
      expect(config.title).toBe('Overridden Title');
      expect(config.durationMinutes).toBe(90);
    });
  });

  describe('DEFAULT_PRESETS', () => {
    test('should contain all expected presets', () => {
      expect(Object.keys(DEFAULT_PRESETS)).toContain('work');
      expect(Object.keys(DEFAULT_PRESETS)).toContain('study');
      expect(Object.keys(DEFAULT_PRESETS)).toContain('focus');
    });
  });

  describe('loadPresets and listPresets', () => {
    test('should return a list of presets', () => {
      const presets = loadPresets();
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);

      const listedPresets = listPresets();
      expect(listedPresets).toEqual(presets);
    });
  });

  describe('findPresetByName', () => {
    test('should find preset by name (case insensitive)', () => {
      const preset = findPresetByName('work');
      expect(preset).toBeDefined();
      expect(preset.name).toBe('work');

      const preset2 = findPresetByName('WORK');
      expect(preset2).toBeDefined();
    });

    test('should return undefined for non-existent preset', () => {
      expect(findPresetByName('nonexistent')).toBeUndefined();
    });
  });

  describe('generateId', () => {
    test('should generate unique ids', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });
  });

  describe('Plan Lifecycle Management', () => {
    test('should start a plan', () => {
      const plan = createPlanConfig('work');
      const started = startPlan(plan);
      expect(started.status).toBe('in_progress');
    });

    test('should complete a plan', () => {
      const plan = createPlanConfig('work');
      const completed = completePlan(plan);
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
      completed.tasks.forEach((task) => {
        expect(task.completed).toBe(true);
      });
    });

    test('should cancel a plan', () => {
      const plan = createPlanConfig('work');
      const cancelled = cancelPlan(plan);
      expect(cancelled.status).toBe('cancelled');
    });

    test('should complete individual tasks', () => {
      const plan = createPlanConfig('work');
      const taskId = plan.tasks[0].id;
      const updated = completeTask(plan, taskId);
      expect(updated.tasks.find((t) => t.id === taskId).completed).toBe(true);
    });
  });

  describe('exportPlan', () => {
    const testPlan = createPlanConfig('work');

    test('should export plan to JSON', () => {
      const json = exportPlan(testPlan, { format: 'json' });
      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.title).toBe(testPlan.title);
    });

    test('should export plan to Markdown', () => {
      const md = exportPlan(testPlan, { format: 'markdown' });
      expect(typeof md).toBe('string');
      expect(md).toContain(`# ${testPlan.title}`);
    });

    test('should export plan to text', () => {
      const text = exportPlan(testPlan, { format: 'text' });
      expect(typeof text).toBe('string');
      expect(text).toContain(testPlan.title);
    });

    test('should respect includeTasks and includeMetadata options', () => {
      const json1 = JSON.parse(exportPlan(testPlan, { format: 'json', includeTasks: false }));
      expect(json1.tasks).toBeUndefined();

      const json2 = JSON.parse(exportPlan(testPlan, { format: 'json', includeMetadata: false }));
      expect(json2.createdAt).toBeUndefined();
    });
  });

  describe('calculateSessionStats', () => {
    test('should calculate session statistics', () => {
      const plan = createPlanConfig('work');
      const stats = calculateSessionStats(plan);
      expect(stats.totalFocusMinutes).toBeGreaterThan(0);
      expect(stats.totalTasks).toBeGreaterThan(0);
      expect(typeof stats.tasksCompleted).toBe('number');
    });

    test('should count completed tasks correctly', () => {
      let plan = createPlanConfig('work');
      plan = completeTask(plan, plan.tasks[0].id);
      const stats = calculateSessionStats(plan);
      expect(stats.tasksCompleted).toBe(1);
    });
  });

  describe('Break Schedule Management', () => {
    test('should create a break schedule', () => {
      const schedule = createBreakSchedule(true, 5, 15, 4);
      expect(schedule.enabled).toBe(true);
      expect(schedule.breakMinutes).toBe(5);
      expect(schedule.longBreakMinutes).toBe(15);
      expect(schedule.longBreakInterval).toBe(4);
    });

    test('should apply break schedule to plan', () => {
      const plan = createPlanConfig('work 60', { includeBreaks: false });
      const schedule = createBreakSchedule(true, 5, 15, 2);
      const scheduled = applyBreakSchedule(plan, schedule);
      const breakTasks = scheduled.tasks.filter((t) => t.isBreak);
      expect(breakTasks.length).toBeGreaterThan(0);
    });

    test('should handle disabled schedule', () => {
      const plan = createPlanConfig('work');
      const schedule = createBreakSchedule(false);
      const scheduled = applyBreakSchedule(plan, schedule);
      expect(scheduled).toEqual(plan);
    });
  });

  describe('Performance Monitoring', () => {
    test('should record performance metrics', () => {
      const beforeCount = getPerformanceMetrics().length;
      recordPerformance('test', Date.now(), true);
      const afterCount = getPerformanceMetrics().length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });

    test('should calculate average response time', () => {
      recordPerformance('test1', Date.now(), true);
      recordPerformance('test2', Date.now(), true);
      const avg = getAverageResponseTime();
      expect(typeof avg).toBe('number');
    });

    test('should calculate error rate', () => {
      const rate = getErrorRate();
      expect(typeof rate).toBe('number');
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    });

    test('should return performance metrics array', () => {
      const metrics = getPerformanceMetrics();
      expect(Array.isArray(metrics)).toBe(true);
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0].commandName).toBeDefined();
      expect(metrics[0].durationMs).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    test('should work together: create, export, calculate stats', () => {
      const plan = createPlanConfig('work');
      const started = startPlan(plan);
      const withTask = completeTask(started, started.tasks[0].id);
      const completed = completePlan(withTask);
      const stats = calculateSessionStats(completed);
      const exported = exportPlan(completed, { format: 'json' });

      expect(stats.tasksCompleted).toBeGreaterThan(0);
      expect(exported).toContain('completed');
    });

    test('should handle edge cases gracefully', () => {
      expect(() => createPlanConfig(null)).not.toThrow();
      expect(() => createPlanConfig(undefined)).not.toThrow();
      expect(() => parsePlanArguments(null)).not.toThrow();
      expect(() => parsePlanArguments(undefined)).not.toThrow();
    });
  });

  // New tests for enhanced features
  describe('Autocomplete Suggestions', () => {
    test('should return autocomplete suggestions', () => {
      const suggestions = getAutocompleteSuggestions('');
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    test('should filter suggestions based on input', () => {
      const suggestions = getAutocompleteSuggestions('work');
      expect(suggestions.some((s) => s.content.toLowerCase().includes('work'))).toBe(true);
    });
  });

  describe('Plan History', () => {
    test('should add and retrieve plan history', () => {
      const plan = createPlanConfig('focus 25');
      addToPlanHistory(plan);

      const history = getPlanHistory();
      expect(history.some((h) => h.id === plan.id)).toBe(true);
    });
  });

  // Tests for newly added features
  describe('Smart Suggestions (getSmartSuggestions)', () => {
    test('should return smart suggestions with all required fields', () => {
      const suggestions = getSmartSuggestions();
      expect(suggestions.recommendedDuration).toBeDefined();
      expect(suggestions.recommendedChunkSize).toBeDefined();
      expect(suggestions.recommendedBreakMinutes).toBeDefined();
      expect(suggestions.bestTimeOfDay).toBeDefined();
      expect(suggestions.productivityPrediction).toBeDefined();
      expect(Array.isArray(suggestions.tips)).toBe(true);
    });

    test('should accept custom hour of day', () => {
      const morningSuggestions = getSmartSuggestions({ hourOfDay: 10 });
      const nightSuggestions = getSmartSuggestions({ hourOfDay: 22 });
      expect(morningSuggestions.productivityPrediction).toBe('high');
      expect(nightSuggestions.productivityPrediction).toBe('low');
    });
  });

  describe('Plan Comparison (comparePlans)', () => {
    test('should compare two plans and return stats', () => {
      const plan1 = createPlanConfig('work 60');
      const plan2 = createPlanConfig('study 90');
      const comparison = comparePlans(plan1, plan2);

      expect(comparison.plan1Stats).toBeDefined();
      expect(comparison.plan2Stats).toBeDefined();
      expect(comparison.differences.durationDiff).toBeDefined();
      expect(comparison.differences.taskCountDiff).toBeDefined();
      expect(comparison.differences.focusTimeDiff).toBeDefined();
      expect(comparison.recommendation).toBeDefined();
    });
  });

  describe('Template Management', () => {
    test('should save and load a template', () => {
      const plan = createPlanConfig('work 60');
      const saved = saveTemplate('myWorkTemplate', plan);
      expect(saved.name).toBe('myWorkTemplate');
      expect(saved.id).toBeDefined();

      const loaded = loadTemplate('myWorkTemplate');
      expect(loaded).not.toBeNull();
      expect(loaded.name).toBe('myWorkTemplate');
    });

    test('should list all saved templates', () => {
      const plan = createPlanConfig('study 45');
      saveTemplate('myStudyTemplate', plan);

      const templates = listTemplates();
      expect(templates.length).toBeGreaterThan(0);
    });

    test('should delete a template', () => {
      const plan = createPlanConfig('focus 25');
      saveTemplate('toBeDeleted', plan);

      const deleteResult = deleteTemplate('toBeDeleted');
      expect(deleteResult).toBe(true);

      const loaded = loadTemplate('toBeDeleted');
      expect(loaded).toBeNull();
    });

    test('should return false when deleting non-existent template', () => {
      const result = deleteTemplate('nonExistent');
      expect(result).toBe(false);
    });
  });

  describe('Batch Plan Creation', () => {
    test('should create multiple plans from task list', () => {
      const plans = createBatchPlans({
        tasks: [
          { title: 'Task 1', durationMinutes: 30 },
          { title: 'Task 2', durationMinutes: 45 },
          { title: 'Task 3' },
        ],
        defaultDuration: 60,
      });

      expect(Array.isArray(plans)).toBe(true);
      expect(plans.length).toBe(3);
      expect(plans[0].durationMinutes).toBe(30);
      expect(plans[1].durationMinutes).toBe(45);
      expect(plans[2].durationMinutes).toBe(60);
    });
  });

  describe('Enhanced Export (exportPlanEnhanced)', () => {
    const testPlan = createPlanConfig('work');

    test('should export to JSON', () => {
      const json = exportPlanEnhanced(testPlan, 'json');
      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    test('should export to Markdown', () => {
      const md = exportPlanEnhanced(testPlan, 'markdown');
      expect(typeof md).toBe('string');
    });

    test('should export to CSV', () => {
      const csv = exportPlanEnhanced(testPlan, 'csv');
      expect(typeof csv).toBe('string');
      expect(csv).toContain('Task ID,Title,Duration');
    });
  });

  describe('Cache System (SimpleCache)', () => {
    test('should set and get cache items', () => {
      const cache = new SimpleCache();
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    test('should return null for non-existent keys', () => {
      const cache = new SimpleCache();
      expect(cache.get('nonExistent')).toBeNull();
    });

    test('should expire items after expiry time', async () => {
      const cache = new SimpleCache();
      cache.set('shortLived', 'expiresSoon', 1); // 1ms expiry

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(cache.get('shortLived')).toBeNull();
    });

    test('should clear all cache items', () => {
      const cache = new SimpleCache();
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.clear();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    test('should respect max cache size', () => {
      const cache = new SimpleCache(3);
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4');

      expect(cache.get('key4')).toBe('value4');
    });
  });

  describe('Optimized Functions', () => {
    test('createPlanConfigOptimized should work like createPlanConfig', () => {
      const config1 = createPlanConfig('work 60');
      const config2 = createPlanConfigOptimized('work 60');

      expect(config1.title).toEqual(config2.title);
      expect(config1.durationMinutes).toEqual(config2.durationMinutes);
    });

    test('should be faster with repeated calls (due to caching)', () => {
      const start1 = Date.now();
      for (let i = 0; i < 100; i++) {
        createPlanConfig('work 60');
      }
      const duration1 = Date.now() - start1;

      const start2 = Date.now();
      for (let i = 0; i < 100; i++) {
        createPlanConfigOptimized('work 60');
      }
      const duration2 = Date.now() - start2;

      console.log(`Regular: ${duration1}ms, Optimized: ${duration2}ms`);
    });
  });

  // ==================== ADHD Support Tests ====================
  describe('ADHD Support Features', () => {
    test('ADHDPlanSupport should create focus timer config', () => {
      const timer = ADHDPlanSupport.createFocusTimer({ durationMinutes: 30 });
      expect(timer.durationMinutes).toBe(30);
      expect(timer.distractionPromptsEnabled).toBe(true);
      expect(timer.customPrompts.length).toBeGreaterThan(0);
    });

    test('ADHDPlanSupport should decompose task to micro tasks', () => {
      const microTasks = ADHDPlanSupport.decomposeToMicroTasks({
        title: 'Write Report',
        durationMinutes: 20,
      });
      expect(microTasks.length).toBe(4); // 20 minutes / 5 min per micro task
      expect(microTasks[0].completed).toBe(false);
      expect(microTasks[0].estimatedMinutes).toBe(5);
    });

    test('ADHDPlanSupport should get sensory reminders', () => {
      const reminders = ADHDPlanSupport.getSensoryReminders();
      expect(reminders.length).toBeGreaterThan(0);
      expect(reminders[0].type).toBeDefined();
      expect(reminders[0].enabled).toBe(true);
    });

    test('ADHDPlanSupport should create transition checklist', () => {
      const checklist = ADHDPlanSupport.createTransitionChecklist('Task A', 'Task B');
      expect(checklist.items.length).toBe(4);
      expect(checklist.name).toContain('Task A');
      expect(checklist.name).toContain('Task B');
    });

    test('ADHDPlanSupport should get visual task tracking data', () => {
      const tasks = [
        { id: '1', completed: true },
        { id: '2', completed: false },
        { id: '3', completed: false },
      ];
      const trackingData = ADHDPlanSupport.getVisualTaskTrackingData(tasks);
      expect(trackingData.completionPercentage).toBe(33);
      expect(trackingData.completedTasks).toBe(1);
    });
  });
});
