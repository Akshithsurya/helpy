const { getPersonalizedRecommendations, parseDomain } = require('../recommendations');

describe('Recommendations', () => {
  test('suggests setting a preferred name when missing', () => {
    const recommendations = getPersonalizedRecommendations({
      tasks: [],
      tabs: [],
      settings: {},
      connectionStatus: 'connected',
      now: new Date('2026-07-06T10:00:00.000Z'),
    });

    expect(recommendations[0].id).toBe('set-name');
  });

  test('prioritizes overdue work when overdue tasks exist', () => {
    const recommendations = getPersonalizedRecommendations({
      tasks: [
        {
          id: 1,
          title: 'Submit report',
          dueDate: '2026-07-04',
          completed: false,
          archived: false,
          priority: 'high',
        },
      ],
      tabs: [],
      settings: { displayName: 'Sam', recommendationStyle: 'direct' },
      connectionStatus: 'connected',
      now: new Date('2026-07-06T10:00:00.000Z'),
    });

    expect(recommendations.some((item) => item.id === 'overdue-tasks')).toBe(true);
  });

  test('suggests focus mode when distracting tabs compete with important work', () => {
    const recommendations = getPersonalizedRecommendations({
      tasks: [
        {
          id: 1,
          title: 'Finish project brief',
          dueDate: '2026-07-06',
          completed: false,
          archived: false,
          priority: 'high',
        },
      ],
      tabs: [{ title: 'Videos', url: 'https://www.youtube.com/watch?v=123' }],
      settings: { displayName: 'Sam', recommendationStyle: 'supportive' },
      connectionStatus: 'connected',
      now: new Date('2026-07-06T10:00:00.000Z'),
    });

    expect(recommendations.some((item) => item.id === 'focus-shift')).toBe(true);
  });

  test('normalizes domains from tracked tabs', () => {
    expect(parseDomain('https://www.reddit.com/r/javascript')).toBe('reddit.com');
    expect(parseDomain('not-a-url')).toBe('');
  });
});
