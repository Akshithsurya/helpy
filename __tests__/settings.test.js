const {
  SettingsManager,
  DEFAULT_SETTINGS,
  sanitizeDisplayName,
  sanitizeTheme,
  sanitizeAccentColor,
  sanitizeBoolean,
  sanitizeNumber,
  sanitizeDefaultTab,
  sanitizeRecommendationStyle,
  sanitizeTtsVoice,
  sanitizeTtsRate,
  sanitizeTtsVolume,
} = require('../settings');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
}));

describe('Sanitization Functions', () => {
  describe('sanitizeDisplayName', () => {
    test('should trim whitespace and limit to 40 chars', () => {
      expect(sanitizeDisplayName('   John Doe   ')).toBe('John Doe');
      expect(sanitizeDisplayName('a'.repeat(50))).toBe('a'.repeat(40));
      expect(sanitizeDisplayName(123)).toBe('');
      expect(sanitizeDisplayName(null)).toBe('');
    });
  });

  describe('sanitizeTheme', () => {
    test('should return valid theme or default', () => {
      expect(sanitizeTheme('light')).toBe('light');
      expect(sanitizeTheme('dark')).toBe('dark');
      expect(sanitizeTheme('invalid')).toBe(DEFAULT_SETTINGS.theme);
    });
  });

  describe('sanitizeAccentColor', () => {
    test('should return valid accent color or default', () => {
      expect(sanitizeAccentColor('burgundy')).toBe('burgundy');
      expect(sanitizeAccentColor('sepia')).toBe('sepia');
      expect(sanitizeAccentColor('invalid')).toBe(DEFAULT_SETTINGS.accentColor);
    });
  });

  describe('sanitizeBoolean', () => {
    test('should return valid boolean or default', () => {
      expect(sanitizeBoolean(true, false)).toBe(true);
      expect(sanitizeBoolean(false, true)).toBe(false);
      expect(sanitizeBoolean('not a boolean', true)).toBe(true);
    });
  });

  describe('sanitizeNumber', () => {
    test('should return number clamped between min and max', () => {
      expect(sanitizeNumber(50, 100, 0, 200)).toBe(50);
      expect(sanitizeNumber(250, 100, 0, 200)).toBe(200);
      expect(sanitizeNumber(-10, 100, 0, 200)).toBe(0);
      expect(sanitizeNumber('not a number', 100, 0, 200)).toBe(100);
    });
  });

  describe('TTS sanitizers', () => {
    test('should sanitize TTS voice, rate, and volume', () => {
      expect(sanitizeTtsVoice('  Microsoft David Desktop  ')).toBe('Microsoft David Desktop');
      expect(sanitizeTtsVoice(99)).toBe(DEFAULT_SETTINGS.ttsVoice);
      expect(sanitizeTtsRate(1.35)).toBe(1.35);
      expect(sanitizeTtsRate(5)).toBe(2);
      expect(sanitizeTtsRate('bad')).toBe(DEFAULT_SETTINGS.ttsRate);
      expect(sanitizeTtsVolume(35)).toBe(35);
      expect(sanitizeTtsVolume(999)).toBe(100);
    });
  });

  describe('Personalized preference sanitizers', () => {
    test('should sanitize default tab and recommendation style', () => {
      expect(sanitizeDefaultTab('focus')).toBe('focus');
      expect(sanitizeDefaultTab('invalid')).toBe(DEFAULT_SETTINGS.defaultTab);
      expect(sanitizeRecommendationStyle('calm')).toBe('calm');
      expect(sanitizeRecommendationStyle('invalid')).toBe(DEFAULT_SETTINGS.recommendationStyle);
    });
  });
});

describe('SettingsManager', () => {
  test('should create with default settings', () => {
    const manager = new SettingsManager();
    const settings = manager.getSettings();
    // Check just some key properties instead of all
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.accentColor).toBe(DEFAULT_SETTINGS.accentColor);
  });

  test('should update settings', () => {
    const manager = new SettingsManager();
    const updated = manager.updateSettings({
      theme: 'dark',
      displayName: 'Test User',
      accentColor: 'sepia',
    });
    expect(updated.theme).toBe('dark');
    expect(updated.displayName).toBe('Test User');
    expect(updated.accentColor).toBe('sepia');
  });

  test('should sanitize settings during update', () => {
    const manager = new SettingsManager();
    const updated = manager.updateSettings({
      theme: 'invalid-theme',
      uiScale: 300,
      ttsRate: 5,
      ttsVolume: -10,
    });
    expect(updated.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(updated.uiScale).toBe(200);
    expect(updated.ttsRate).toBe(2);
    expect(updated.ttsVolume).toBe(0);
  });

  test('should persist valid TTS settings', () => {
    const manager = new SettingsManager();
    const updated = manager.updateSettings({
      ttsEnabled: true,
      ttsVoice: 'Microsoft Zira Desktop',
      ttsRate: 1.4,
      ttsVolume: 65,
    });

    expect(updated.ttsEnabled).toBe(true);
    expect(updated.ttsVoice).toBe('Microsoft Zira Desktop');
    expect(updated.ttsRate).toBe(1.4);
    expect(updated.ttsVolume).toBe(65);
  });

  test('should persist personalized preference settings', () => {
    const manager = new SettingsManager();
    const updated = manager.updateSettings({
      defaultTab: 'focus',
      recommendationStyle: 'direct',
      showRecommendations: false,
    });

    expect(updated.defaultTab).toBe('focus');
    expect(updated.recommendationStyle).toBe('direct');
    expect(updated.showRecommendations).toBe(false);
  });
});
