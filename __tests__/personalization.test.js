const {
  getAddressName,
  personalizeLabel,
  getDisplayName,
  getUserInitials,
  getTimeOfDayGreeting,
  createGreeting,
  sanitizeDisplayName,
  createAppSubtitle,
  createNamedSentence,
} = require('../personalization');

describe('Personalization Functions', () => {
  describe('sanitizeDisplayName', () => {
    test('should trim and limit display name', () => {
      expect(sanitizeDisplayName('   John Doe   ')).toBe('John Doe');
      expect(sanitizeDisplayName('a'.repeat(50))).toBe('a'.repeat(40));
    });
  });

  describe('getDisplayName', () => {
    test('should return sanitized display name', () => {
      expect(getDisplayName({ displayName: '   Jane   ' })).toBe('Jane');
    });
  });

  describe('getAddressName', () => {
    test('should return display name if provided', () => {
      expect(getAddressName({ displayName: 'John' })).toBe('John');
    });

    test('should return default if no display name', () => {
      expect(getAddressName({})).toBe('there');
    });
  });

  describe('getUserInitials', () => {
    test('should return initials for display name', () => {
      expect(getUserInitials({ displayName: 'John Doe' })).toBe('JD');
      expect(getUserInitials({ displayName: 'Alice' })).toBe('A');
    });
  });

  describe('getTimeOfDayGreeting', () => {
    test('should return a greeting string', () => {
      const greeting = getTimeOfDayGreeting();
      expect(typeof greeting).toBe('string');
      expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(greeting);
    });
  });

  describe('createGreeting', () => {
    test('should create personalized greeting', () => {
      const greeting = createGreeting({ displayName: 'Test' });
      expect(typeof greeting).toBe('string');
      expect(greeting).toContain('Test');
    });
  });

  describe('personalizeLabel', () => {
    test('should return personalized label', () => {
      expect(personalizeLabel('Helpy reminder', {})).toBe('Helpy reminder');
      expect(personalizeLabel('Helpy reminder', { displayName: 'John' })).toBe(
        'Helpy reminder, John'
      );
    });
  });

  describe('createAppSubtitle', () => {
    test('should create a personalized or fallback subtitle', () => {
      expect(createAppSubtitle({ displayName: 'Jamie' })).toContain('Jamie');
      expect(createAppSubtitle({})).toContain('calm workspace');
    });
  });

  describe('createNamedSentence', () => {
    test('should create a named sentence with fallback text', () => {
      expect(createNamedSentence('Tracking is paused', { displayName: 'Chris' })).toBe(
        'Tracking is paused, Chris.'
      );
      expect(createNamedSentence('Tracking is paused', {}, 'Tracking is paused.')).toBe(
        'Tracking is paused.'
      );
    });
  });
});
