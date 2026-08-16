function createChromeMock() {
  return {
    storage: {
      sync: {
        get: jest.fn((keys, callback) => {
          const data = { bridgeToken: 'bridge-token-123' };
          if (typeof callback === 'function') {
            callback(data);
          } else {
            return Promise.resolve(data);
          }
        }),
        set: jest.fn((value, callback) => {
          if (typeof callback === 'function') {
            callback();
          } else {
            return Promise.resolve();
          }
        }),
      },
      local: {
        get: jest.fn((keys, callback) => {
          const data = {};
          if (typeof callback === 'function') {
            callback(data);
          } else {
            return Promise.resolve(data);
          }
        }),
        set: jest.fn((value, callback) => {
          if (typeof callback === 'function') {
            callback();
          } else {
            return Promise.resolve();
          }
        }),
      },
      onChanged: {
        addListener: jest.fn(),
      },
    },
    tabs: {
      query: jest.fn((_queryInfo, callback) => {
        if (typeof callback === 'function') {
          callback([]);
          return;
        }
        return Promise.resolve([]);
      }),
      get: jest.fn((tabId, callback) => {
        const tab = { id: tabId, title: 'Example Tab', url: 'https://example.com', active: true };
        if (typeof callback === 'function') {
          callback(tab);
          return;
        }
        return Promise.resolve(tab);
      }),
      sendMessage: jest.fn((_tabId, _message, callback) => {
        const result = { success: true };
        if (typeof callback === 'function') {
          callback(result);
          return;
        }
        return Promise.resolve(result);
      }),
      onActivated: { addListener: jest.fn() },
      onUpdated: { addListener: jest.fn() },
      onCreated: { addListener: jest.fn() },
      onRemoved: { addListener: jest.fn() },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: { addListener: jest.fn() },
    },
    runtime: {
      id: 'test-extension-id',
      onMessage: { addListener: jest.fn() },
      onMessageExternal: { addListener: jest.fn() },
      onStartup: { addListener: jest.fn() },
      sendMessage: jest.fn(),
      lastError: null,
    },
    commands: {
      onCommand: { addListener: jest.fn() },
    },
    alarms: {
      create: jest.fn(),
      onAlarm: { addListener: jest.fn() },
    },
    notifications: {
      create: jest.fn(),
    },
  };
}

describe('Background Script', () => {
  let background;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.useFakeTimers();

    global.chrome = createChromeMock();
    let currentRegisteredExtensionId = null;
    global.fetch = jest.fn(async (url, options) => {
      if (String(url).includes('/api/extension/register')) {
        const body = JSON.parse(options.body);
        currentRegisteredExtensionId = body.extensionId;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            bridgeToken: 'bridge-token-123',
            bridge: {
              registeredExtensionId: currentRegisteredExtensionId,
            },
          }),
        };
      }

      if (String(url).includes('/api/settings')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            extensionSettings: {
              displayName: 'Jamie',
              bridgeToken: 'bridge-token-123',
              registeredExtensionId: currentRegisteredExtensionId,
            },
            bridge: {
              registeredExtensionId: currentRegisteredExtensionId,
            },
          }),
        };
      }

      if (String(url).includes('/api/focus-plan')) {
        const planInput = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            plan: planInput,
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });

    background = require('../chrome-extension/background.js');
    // Initialize for tests
    await background.__testing.init();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    delete global.chrome;
    delete global.fetch;
  });

  test('should sanitize display names', () => {
    expect(background.sanitizeDisplayName('   Taylor   ')).toBe('Taylor');
    expect(background.sanitizeDisplayName('')).toBe('');
  });

  test('should update tab activity state', () => {
    background.updateTabActivity(42);
    const state = background.__testing.getState();
    expect(state.tabActivity[42]).toBeDefined();
  });

  test('keeps the portion of a session that overlaps the weekly report and includes active tabs', () => {
    const now = new Date('2026-07-29T12:00:00.000Z').getTime();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

    background.tabTracker.tabHistory = [
      {
        domain: 'before-and-during.example',
        startTime: now - 8 * 86400000,
        endTime: now - 6 * 86400000,
        duration: 2 * 86400000,
      },
      {
        domain: 'within-week.example',
        startTime: now - 6 * 86400000,
        endTime: now - 5.5 * 86400000,
        duration: 0.5 * 86400000,
      },
    ];
    background.tabTracker.tabSessions = {
      9: {
        domain: 'within-week.example',
        startTime: now - 60 * 60 * 1000,
      },
    };

    const report = background.tabTracker.getTimeReport(7);

    expect(report.totalTime).toBe(37 * 60 * 60 * 1000);
    expect(report.switchCount).toBe(3);
    expect(report.domainStats).toEqual([
      expect.objectContaining({ domain: 'before-and-during.example', totalTime: 24 * 60 * 60 * 1000 }),
      expect.objectContaining({ domain: 'within-week.example', totalTime: 13 * 60 * 60 * 1000 }),
    ]);
    dateSpy.mockRestore();
  });

  test('should personalize inactive notification titles', () => {
    background.__testing.setDisplayName('Jordan');
    const notification = background.createInactiveNotificationMessage({
      title: 'Quarterly Review',
    });

    expect(notification.title).toBe('Time to refocus, Jordan');
    expect(notification.body).toContain('Quarterly Review');
  });

  test('should sync display name and bridge token from the app', async () => {
    await background.syncDisplayNameFromApp(true);
    const state = background.__testing.getState();

    expect(state.displayName).toBe('Jamie');
    expect(state.bridgeToken).toBe('bridge-token-123');
    expect(state.appConnected).toBe(true);
  });

  test('should register with the app using the synced bridge token', async () => {
    // Clear fetch mocks so we only capture calls from this test
    global.fetch.mockClear();

    // Explicitly ensure bridge connection, which will call registerWithApp
    await background.ensureBridgeConnection(true);

    const registerCall = global.fetch.mock.calls.find(([url]) =>
      String(url).includes('/api/extension/register')
    );

    expect(registerCall).toBeDefined();
  });

  test('should handle plan command with preset "work"', async () => {
    const commandHandler = new background.CommandHandler({
      dataTrackingManager: background.dataTrackingManager,
    });
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch.mockClear();
    const result = await commandHandler.handlePlanCommand('work');

    expect(result.title).toBe('Plan Created!');
    expect(result.message).toContain('Work Session');
    expect(result.planConfig.durationMinutes).toBe(60);
    expect(result.syncStatus).toBe('synced');

    const planCall = global.fetch.mock.calls.find(([url]) =>
      String(url).includes('/api/focus-plan')
    );

    expect(planCall).toBeDefined();
    expect(planCall[1].headers['X-Helpy-Bridge-Token']).toBe('bridge-token-123');
  });

  test('should handle plan command with custom title and duration', async () => {
    const commandHandler = new background.CommandHandler({
      dataTrackingManager: background.dataTrackingManager,
    });
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch.mockClear();
    const result = await commandHandler.handlePlanCommand('Finish report 45');

    expect(result.title).toBe('Plan Created!');
    expect(result.message).toContain('Finish report');
    expect(result.syncStatus).toBe('synced');

    const planCall = global.fetch.mock.calls.find(([url]) =>
      String(url).includes('/api/focus-plan')
    );

    expect(planCall).toBeDefined();
    const planInput = JSON.parse(planCall[1].body);
    expect(planInput.title).toBe('Finish report');
    expect(planInput.durationMinutes).toBe(45);
    expect(planCall[1].headers['X-Helpy-Bridge-Token']).toBe('bridge-token-123');
  });

  test('should handle plan command with no arguments', async () => {
    const commandHandler = new background.CommandHandler({
      dataTrackingManager: background.dataTrackingManager,
    });
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch.mockClear();
    const result = await commandHandler.handlePlanCommand('');

    expect(result.title).toBe('Plan Created!');
    expect(result.message).toContain('Planned session');
    expect(result.planConfig.durationMinutes).toBe(30);
    expect(result.syncStatus).toBe('synced');
  });

  test('should parse multi-word focus session presets consistently', async () => {
    const commandHandler = new background.CommandHandler({
      dataTrackingManager: background.dataTrackingManager,
    });
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch.mockClear();
    const result = await commandHandler.handlePlanCommand('focus session 45');

    expect(result.message).toContain('Deep Focus');
    expect(result.planConfig.durationMinutes).toBe(45);
    expect(result.syncStatus).toBe('synced');
  });

  test('should retry plan sync after a 401 and restore connected bridge status', async () => {
    const commandHandler = new background.CommandHandler({
      dataTrackingManager: background.dataTrackingManager,
      sendPlanToApp: (planConfig) => background.sendPlanToApp(planConfig),
    });
    await new Promise((resolve) => setImmediate(resolve));

    let focusPlanAttempts = 0;
    let currentRegisteredExtensionId = 'test-extension-id';
    global.fetch.mockImplementation(async (url, options) => {
      if (String(url).includes('/api/extension/register')) {
        const body = JSON.parse(options.body);
        currentRegisteredExtensionId = body.extensionId;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            bridgeToken: 'bridge-token-123',
            bridge: {
              registeredExtensionId: currentRegisteredExtensionId,
            },
          }),
        };
      }

      if (String(url).includes('/api/settings')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            extensionSettings: {
              displayName: 'Jamie',
              bridgeToken: 'bridge-token-123',
              registeredExtensionId: currentRegisteredExtensionId,
            },
            bridge: {
              registeredExtensionId: currentRegisteredExtensionId,
            },
          }),
        };
      }

      if (String(url).includes('/api/focus-plan')) {
        focusPlanAttempts += 1;
        if (focusPlanAttempts === 1) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ success: false }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            plan: JSON.parse(options.body),
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });
    global.fetch.mockClear();

    const result = await commandHandler.handlePlanCommand('work');
    const state = background.__testing.getState();

    expect(result.title).toBe('Plan Created!');
    expect(result.syncStatus).toBe('synced');
    expect(focusPlanAttempts).toBe(2);
    expect(state.bridgeStatus).toBe('connected');
    expect(state.appConnected).toBe(true);
  });

  test('should report local-only plan creation when the app is unavailable', async () => {
    const commandHandler = new background.CommandHandler({
      dataTrackingManager: background.dataTrackingManager,
    });
    await new Promise((resolve) => setImmediate(resolve));

    let currentRegisteredExtensionId = 'test-extension-id';
    global.fetch.mockImplementation(async (url, options) => {
      if (String(url).includes('/api/extension/register')) {
        const body = JSON.parse(options.body);
        currentRegisteredExtensionId = body.extensionId;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            bridgeToken: 'bridge-token-123',
            bridge: {
              registeredExtensionId: currentRegisteredExtensionId,
            },
          }),
        };
      }

      if (String(url).includes('/api/settings')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            extensionSettings: {
              displayName: 'Jamie',
              bridgeToken: 'bridge-token-123',
              registeredExtensionId: currentRegisteredExtensionId,
            },
            bridge: {
              registeredExtensionId: currentRegisteredExtensionId,
            },
          }),
        };
      }

      if (String(url).includes('/api/focus-plan')) {
        throw new Error('Failed to fetch');
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      };
    });
    global.fetch.mockClear();

    const result = await commandHandler.handlePlanCommand('Finish report 45');

    expect(result.title).toBe('Plan Saved Locally');
    expect(result.message).toContain('Helpy app is unavailable');
    expect(result.syncStatus).toBe('local-only');
    expect(result.planConfig).toEqual(
      expect.objectContaining({
        title: 'Finish report',
        durationMinutes: 45,
        source: 'omnibox',
      })
    );
  });
});
