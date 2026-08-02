const {
  normalizeUserProfile,
  normalizePrivacySettings,
  getDefaultUserProfile,
  getDefaultPrivacySettings,
} = require('../shared/schemas');

describe('User Profile', () => {
  describe('Default Values', () => {
    test('should provide default user profile', () => {
      const defaultProfile = getDefaultUserProfile();
      expect(defaultProfile).toBeDefined();
      expect(typeof defaultProfile).toBe('object');
      expect(defaultProfile.displayName).toBe('');
      expect(defaultProfile.email).toBe('');
      expect(defaultProfile.bio).toBe('');
      expect(defaultProfile.privacySettings).toBeDefined();
    });

    test('should provide default privacy settings', () => {
      const defaultSettings = getDefaultPrivacySettings();
      expect(defaultSettings).toBeDefined();
      expect(defaultSettings.shareUsageData).toBe(false);
      expect(defaultSettings.collectAnalytics).toBe(true);
      expect(defaultSettings.allowPersonalization).toBe(true);
    });
  });

  describe('Normalization', () => {
    test('should normalize valid user profile', () => {
      const input = {
        displayName: '  John Doe  ',
        email: 'john@example.com',
        bio: 'A test bio',
        language: 'en',
        timezone: 'America/New_York',
      };

      const normalized = normalizeUserProfile(input);
      expect(normalized.displayName).toBe('John Doe');
      expect(normalized.email).toBe('john@example.com');
      expect(normalized.bio).toBe('A test bio');
      expect(normalized.language).toBe('en');
      expect(normalized.timezone).toBe('America/New_York');
      expect(normalized.updatedAt).toBeDefined();
    });

    test('should sanitize display name', () => {
      const input = {
        displayName: '  Very Long Name That Should Be Truncated  ',
      };

      const normalized = normalizeUserProfile(input);
      expect(normalized.displayName.length).toBeLessThanOrEqual(40);
    });

    test('should handle invalid input gracefully', () => {
      const normalized = normalizeUserProfile(null);
      expect(normalized).toBeDefined();
      expect(normalized.displayName).toBe('');
    });

    test('should normalize privacy settings', () => {
      const input = {
        shareUsageData: true,
        collectAnalytics: false,
        allowPersonalization: true,
      };

      const normalized = normalizePrivacySettings(input);
      expect(normalized.shareUsageData).toBe(true);
      expect(normalized.collectAnalytics).toBe(false);
      expect(normalized.allowPersonalization).toBe(true);
    });

    test('should use defaults for missing privacy settings', () => {
      const normalized = normalizePrivacySettings({});
      expect(normalized.shareUsageData).toBe(false);
      expect(normalized.collectAnalytics).toBe(true);
      expect(normalized.allowPersonalization).toBe(true);
    });
  });

  describe('Privacy Settings', () => {
    test('should respect disabled analytics', () => {
      const settings = normalizePrivacySettings({ collectAnalytics: false });
      expect(settings.collectAnalytics).toBe(false);
    });

    test('should respect disabled personalization', () => {
      const settings = normalizePrivacySettings({ allowPersonalization: false });
      expect(settings.allowPersonalization).toBe(false);
    });

    test('should convert non-boolean values', () => {
      const settings = normalizePrivacySettings({
        shareUsageData: 'true',
        collectAnalytics: 1,
        allowPersonalization: 'false',
      });
      expect(typeof settings.shareUsageData).toBe('boolean');
      expect(typeof settings.collectAnalytics).toBe('boolean');
      expect(typeof settings.allowPersonalization).toBe('boolean');
    });
  });

  describe('Data Validation', () => {
    test('should limit bio length', () => {
      const longBio = 'a'.repeat(1000);
      const normalized = normalizeUserProfile({ bio: longBio });
      expect(normalized.bio.length).toBeLessThanOrEqual(500);
    });

    test('should limit email length', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      const normalized = normalizeUserProfile({ email: longEmail });
      expect(normalized.email.length).toBeLessThanOrEqual(255);
    });

    test('should preserve valid timezone', () => {
      const timezone = 'Europe/London';
      const normalized = normalizeUserProfile({ timezone });
      expect(normalized.timezone).toBe(timezone);
    });

    test('should preserve valid language', () => {
      const language = 'fr';
      const normalized = normalizeUserProfile({ language });
      expect(normalized.language).toBe(language);
    });
  });
});
