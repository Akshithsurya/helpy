const CommandHandler = require('../chrome-extension/commands');

describe('CommandHandler', () => {
  let commandHandler;
  let mockBackground;

  beforeEach(() => {
    global.chrome = {
      storage: {
        sync: {
          get: jest.fn().mockResolvedValue({ bridgeToken: 'bridge-token-123' }),
        },
      },
      runtime: {
        openOptionsPage: jest.fn(),
      },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        plan: {
          title: 'Work Session',
          durationMinutes: 60,
        },
      }),
    });

    mockBackground = {
      dataTrackingManager: {
        record: jest.fn(),
      },
    };
    commandHandler = new CommandHandler(mockBackground);
  });

  afterEach(() => {
    delete global.chrome;
    delete global.fetch;
  });

  describe('Command Registration', () => {
    test('should register commands', () => {
      expect(commandHandler.commands).toBeDefined();
      expect(commandHandler.commands.plan).toBeDefined();
      expect(commandHandler.commands.help).toBeDefined();
      expect(commandHandler.commands.track).toBeDefined();
      expect(commandHandler.commands.settings).toBeDefined();
    });

    test('should have correct command descriptions', () => {
      expect(commandHandler.commands.plan.description).toBe('Plan your tasks and goals');
      expect(commandHandler.commands.help.description).toBe('Show available commands');
    });
  });

  describe('Suggestions', () => {
    test('should get suggestions for empty query', () => {
      const suggestions = commandHandler.getSuggestions('');
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);
    });

    test('should get suggestions matching query', () => {
      const suggestions = commandHandler.getSuggestions('plan');
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('Help Command', () => {
    test('should handle help command', async () => {
      const result = await commandHandler.handleHelpCommand('');
      expect(result).toBeDefined();
      expect(result.action).toBe('showNotification');
    });
  });

  describe('Track Command', () => {
    test('should handle track command', async () => {
      const result = await commandHandler.handleTrackCommand('work');
      expect(result).toBeDefined();
      expect(result.action).toBe('showNotification');
    });
  });

  describe('Plan Command', () => {
    test('should parse preset and multi-word preset arguments', () => {
      expect(commandHandler.parsePlanArguments('work')).toEqual(
        expect.objectContaining({
          title: 'Work Session',
          goal: 'Focus on work tasks',
          durationMinutes: 60,
          usedPreset: 'work',
        })
      );

      expect(commandHandler.parsePlanArguments('focus session 45')).toEqual(
        expect.objectContaining({
          title: 'Deep Focus',
          goal: 'Deep focus session',
          durationMinutes: 45,
          usedPreset: 'focus session',
        })
      );
    });

    test('should send the bridge token header to the protected api', async () => {
      const result = await commandHandler.handlePlanCommand('work');

      expect(result.action).toBe('showNotification');
      expect(result.syncStatus).toBe('synced');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3456/api/focus-plan',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Helpy-Bridge-Token': 'bridge-token-123',
          }),
        })
      );
      expect(mockBackground.dataTrackingManager.record).toHaveBeenCalledWith(
        'task_completion',
        1,
        expect.objectContaining({ action: 'plan_created', type: 'work' })
      );
    });

    test('should fall back to the local plan payload when the api fails', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const result = await commandHandler.handlePlanCommand('Finish report 45');

      expect(result.action).toBe('showNotification');
      expect(result.title).toBe('Plan Sync Failed');
      expect(result.syncStatus).toBe('auth-error');
      expect(result.planConfig).toEqual(
        expect.objectContaining({
          title: 'Finish report',
          durationMinutes: 45,
          source: 'omnibox',
        })
      );
    });
  });
});
