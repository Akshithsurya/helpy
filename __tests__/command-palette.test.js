const { CommandPaletteEngine } = require('../src/command-palette');

describe('CommandPaletteEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new CommandPaletteEngine();
  });

  test('registers default actions', () => {
    const actions = engine.search('');
    expect(actions.length).toBeGreaterThan(5);
  });

  test('filters actions based on search query', () => {
    const focusActions = engine.search('focus');
    expect(focusActions.some((a) => a.id === 'nav-focus')).toBe(true);
    expect(focusActions.some((a) => a.id === 'action-quick-pomodoro')).toBe(true);
  });

  test('allows registering custom actions', () => {
    engine.registerCustomAction({
      id: 'custom-1',
      title: 'Custom Action',
      category: 'Custom',
      action: jest.fn(),
    });

    const results = engine.search('Custom');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('custom-1');
  });

  test('executes action callback correctly', () => {
    const mockAction = jest.fn();
    engine.registerCustomAction({
      id: 'test-exec',
      title: 'Exec Test',
      category: 'Test',
      action: mockAction,
    });

    const success = engine.execute('test-exec');
    expect(success).toBe(true);
    expect(mockAction).toHaveBeenCalled();
  });
});
