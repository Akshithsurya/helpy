const fs = require('fs');
const path = require('path');
const { BotCompanion, FACTS_CATALOG, MOTIVATION_CATALOG } = require('../bot-companion');

describe('BotCompanion Module', () => {
  const testMemoryFile = path.join(__dirname, 'test-bot-memory.json');

  afterEach(() => {
    if (fs.existsSync(testMemoryFile)) {
      try {
        fs.unlinkSync(testMemoryFile);
      } catch (_) {}
    }
  });

  test('should initialize with empty default memory when file does not exist', () => {
    const bot = new BotCompanion({ memoryFile: testMemoryFile });
    const memory = bot.getMemorySummary();
    expect(memory.totalActions).toBe(0);
    expect(memory.summary).toContain("haven't recorded any actions yet");
  });

  test('should log actions and update memory totals & counts', async () => {
    const bot = new BotCompanion({ memoryFile: testMemoryFile });
    await bot.logAction('task_completed', 'Finished coding unit tests');
    await bot.logAction('focus_started', 'Pomodoro 25m');

    const memory = bot.getMemorySummary();
    expect(memory.totalActions).toBe(2);
    expect(memory.actionCounts.task_completed).toBe(1);
    expect(memory.actionCounts.focus_started).toBe(1);
    expect(memory.summary).toContain('finished 1 task');
    expect(memory.recentActions.length).toBe(2);
  });

  test('should return random productivity or tech fact from facts catalog', () => {
    const bot = new BotCompanion({ memoryFile: testMemoryFile });
    const factRes = bot.getRandomFact();
    expect(factRes.success).toBe(true);
    expect(FACTS_CATALOG).toContain(factRes.fact);
  });

  test('should return appropriate motivation based on action levels', async () => {
    const bot = new BotCompanion({ memoryFile: testMemoryFile });

    // Low activity level
    const lowMot = bot.getMotivation();
    expect(MOTIVATION_CATALOG.low).toContain(lowMot.motivation);

    // Increase actions to medium
    await bot.logAction('task_completed', 'Task 1');
    await bot.logAction('task_completed', 'Task 2');
    await bot.logAction('task_completed', 'Task 3');

    const medMot = bot.getMotivation();
    expect(MOTIVATION_CATALOG.medium).toContain(medMot.motivation);
  });

  test('should process user queries intelligently', async () => {
    const bot = new BotCompanion({ memoryFile: testMemoryFile });
    await bot.logAction('task_completed', 'Deploy server');

    const factAnswer = await bot.processQuery('tell me a cool fact');
    expect(factAnswer).toContain('Did you know?');

    const motAnswer = await bot.processQuery('give me motivation');
    expect(motAnswer).toContain('Bot Motivation:');

    const memAnswer = await bot.processQuery('what do you remember?');
    expect(memAnswer).toContain('What I Remember About You');

    const greetingAnswer = await bot.processQuery('hello bot');
    expect(greetingAnswer).toContain('Helpy Companion Bot');
  });

  test('falls back promptly when the Ruby API does not respond', async () => {
    const neverResponds = () => new Promise(() => {});
    const bot = new BotCompanion({
      memoryFile: testMemoryFile,
      fetchImpl: neverResponds,
      requestTimeoutMs: 20,
    });

    await expect(bot.processQuery('give me motivation')).resolves.toContain('Bot Motivation:');
  });

  test('answers task planning immediately without an available API', async () => {
    const bot = new BotCompanion({ memoryFile: testMemoryFile, fetchImpl: () => new Promise(() => {}) });
    const answer = await bot.processQuery('plan my next task', {
      tasks: [{ title: 'Write the project brief', completed: false }],
    });
    expect(answer).toContain('Write the project brief');
  });
});
