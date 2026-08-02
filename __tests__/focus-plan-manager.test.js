const fs = require('fs');
const os = require('os');
const path = require('path');
const FocusPlanManager = require('../focus-plan-manager');

describe('FocusPlanManager', () => {
  let tempDir;
  let manager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpy-focus-plan-'));
    manager = new FocusPlanManager({
      dataDir: tempDir,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('should initialize empty history and templates from missing storage', () => {
    expect(manager.getHistory()).toEqual([]);
    expect(manager.getTemplates()).toEqual([]);
  });

  test('should parse presets and custom durations consistently', () => {
    expect(manager.parsePlanArguments('work')).toEqual(
      expect.objectContaining({
        title: 'Work Session',
        goal: 'Focus on work tasks',
        durationMinutes: 60,
        usedPreset: 'work',
      })
    );

    expect(manager.parsePlanArguments('focus session 45')).toEqual(
      expect.objectContaining({
        title: 'Deep Focus',
        goal: 'Deep focus session',
        durationMinutes: 45,
        usedPreset: 'focus session',
      })
    );

    expect(manager.parsePlanArguments('Finish report 300')).toEqual(
      expect.objectContaining({
        title: 'Finish report',
        goal: '',
        durationMinutes: 240,
        usedPreset: null,
      })
    );
  });

  test('should create plans and persist schema-compliant history entries', () => {
    const plan = manager.createPlan({
      title: 'Ship /plan fixes',
      goal: 'Stabilize focus workflow',
      durationMinutes: 35,
      source: 'ui',
      createdAt: '2026-07-09T12:00:00.000Z',
    });
    const historyEntry = manager.addToHistory(plan, {
      source: 'ui',
      taskId: 7,
      taskTitle: 'Ship /plan fixes',
      createdAt: '2026-07-09T12:00:00.000Z',
    });

    expect(plan).toEqual(
      expect.objectContaining({
        title: 'Ship /plan fixes',
        goal: 'Stabilize focus workflow',
        durationMinutes: 35,
        nextQueue: [],
        blockerPreset: 'soft',
        reminderIntensity: 'medium',
        source: 'ui',
        createdAt: '2026-07-09T12:00:00.000Z',
        tasks: expect.any(Array),
      })
    );
    expect(historyEntry.title).toBe('Ship /plan fixes');
    expect(historyEntry.status).toBe('in_progress');
    expect(historyEntry.taskId).toBe(7);
    expect(manager.getHistory(1)).toEqual([
      expect.objectContaining({
        title: 'Ship /plan fixes',
        status: 'in_progress',
        taskId: 7,
        taskTitle: 'Ship /plan fixes',
      }),
    ]);
  });

  test('should create, update, list, and delete templates with compatibility aliases', () => {
    const template = manager.createTemplate({
      name: 'Morning Planning',
      title: 'Morning Plan',
      goal: 'Decide the day priorities',
      durationMinutes: 30,
      tags: ['daily'],
    });

    expect(template.name).toBe('Morning Planning');
    expect(template.defaultTitle).toBe('Morning Plan');
    expect(template.title).toBe('Morning Plan');
    expect(template.goal).toBe('Decide the day priorities');
    expect(template.durationMinutes).toBe(30);

    const updated = manager.updateTemplate(template.id, {
      title: 'Updated Morning Plan',
      goal: 'Review blockers',
      durationMinutes: 40,
    });

    expect(updated.defaultTitle).toBe('Updated Morning Plan');
    expect(updated.title).toBe('Updated Morning Plan');
    expect(updated.goal).toBe('Review blockers');
    expect(updated.durationMinutes).toBe(40);
    expect(manager.getTemplates()).toHaveLength(1);
    expect(manager.deleteTemplate(template.id)).toBe(true);
    expect(manager.getTemplates()).toEqual([]);
  });

  test('should compute statistics from normalized history and clear history safely', () => {
    const firstPlan = manager.createPlan({
      title: 'Planning Sprint',
      durationMinutes: 25,
      source: 'omnibox',
      createdAt: '2026-07-08T08:00:00.000Z',
    });
    const secondPlan = manager.createPlan({
      title: 'Deep Work',
      durationMinutes: 55,
      source: 'ui',
      createdAt: '2026-07-09T09:00:00.000Z',
    });

    manager.addToHistory(firstPlan, { createdAt: '2026-07-08T08:00:00.000Z' });
    manager.addToHistory(secondPlan, { createdAt: '2026-07-09T09:00:00.000Z' });

    const stats = manager.getStatistics(30);
    expect(stats.totalPlans).toBe(2);
    expect(stats.totalMinutes).toBe(80);
    expect(stats.averageDuration).toBe(40);
    expect(Object.keys(stats.dailyStats)).toEqual(
      expect.arrayContaining(['2026-07-08', '2026-07-09'])
    );

    manager.clearHistory();
    expect(manager.getHistory()).toEqual([]);
  });
});
