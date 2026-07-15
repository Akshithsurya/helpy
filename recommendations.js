const { getAddressName } = require('./personalization');

const DISTRACTING_DOMAINS = [
  'youtube.com',
  'reddit.com',
  'x.com',
  'twitter.com',
  'instagram.com',
  'facebook.com',
  'twitch.tv',
  'netflix.com',
];

const PRIORITY_WEIGHT = {
  high: 3,
  medium: 2,
  low: 1,
};

function isValidDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function isTaskOverdue(task, now) {
  if (!task || task.completed || !isValidDate(task.dueDate)) {
    return false;
  }

  const dueDate = new Date(task.dueDate);
  dueDate.setHours(23, 59, 59, 999);
  return dueDate < now;
}

function isTaskDueToday(task, now) {
  if (!task || task.completed || !isValidDate(task.dueDate)) {
    return false;
  }

  const dueDate = new Date(task.dueDate);
  return dueDate.toDateString() === now.toDateString();
}

function parseDomain(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function findTopPriorityTask(tasks = []) {
  return [...tasks].sort((left, right) => {
    const priorityDelta =
      (PRIORITY_WEIGHT[right.priority] || 0) - (PRIORITY_WEIGHT[left.priority] || 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const leftTime = isValidDate(left.dueDate)
      ? new Date(left.dueDate).getTime()
      : Number.MAX_SAFE_INTEGER;
    const rightTime = isValidDate(right.dueDate)
      ? new Date(right.dueDate).getTime()
      : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  })[0];
}

function buildToneCopy(style, variants) {
  return variants[style] || variants.supportive || variants.direct;
}

function createRecommendation(id, title, detail, action) {
  return {
    id,
    title,
    detail,
    action,
  };
}

function getPersonalizedRecommendations({
  tasks = [],
  tabs = [],
  settings = {},
  connectionStatus = 'disconnected',
  now = new Date(),
} = {}) {
  const recommendationStyle = settings.recommendationStyle || 'supportive';
  const addressName = getAddressName(settings);
  const pendingTasks = tasks.filter((task) => task && !task.completed && !task.archived);
  const overdueTasks = pendingTasks.filter((task) => isTaskOverdue(task, now));
  const dueTodayTasks = pendingTasks.filter((task) => isTaskDueToday(task, now));
  const topPriorityTask = findTopPriorityTask(pendingTasks);
  const distractingTabs = tabs.filter((tab) =>
    DISTRACTING_DOMAINS.some((domain) => parseDomain(tab?.url).includes(domain))
  );

  const recommendations = [];

  if (!settings.displayName) {
    recommendations.push(
      createRecommendation(
        'set-name',
        'Personalize your reminders',
        buildToneCopy(recommendationStyle, {
          supportive:
            'Add your preferred name so Helpy can greet you naturally across reminders and summaries.',
          calm: 'Save a preferred name to make greetings and summaries feel more personal.',
          direct: 'Set a preferred name to enable personalized greetings and reminder copy.',
        }),
        {
          label: 'Open settings',
          tab: 'settings',
          focusId: 'displayNameInput',
        }
      )
    );
  }

  if (overdueTasks.length > 0) {
    recommendations.push(
      createRecommendation(
        'overdue-tasks',
        `${overdueTasks.length} overdue task${overdueTasks.length > 1 ? 's' : ''} need attention`,
        buildToneCopy(recommendationStyle, {
          supportive: `A quick catch-up pass can get you back in control, ${addressName}. Start with "${overdueTasks[0].title}".`,
          calm: `Your oldest overdue task is "${overdueTasks[0].title}". Clearing one overdue item will reduce pressure.`,
          direct: `Review overdue tasks now. Start with "${overdueTasks[0].title}".`,
        }),
        {
          label: 'Review tasks',
          tab: 'tasks',
          focusId: 'tasksContainer',
        }
      )
    );
  } else if (dueTodayTasks.length > 0) {
    recommendations.push(
      createRecommendation(
        'due-today',
        `${dueTodayTasks.length} task${dueTodayTasks.length > 1 ? 's are' : ' is'} due today`,
        buildToneCopy(recommendationStyle, {
          supportive: `You are close to the finish line. "${dueTodayTasks[0].title}" is a good next step.`,
          calm: `Today's nearest deadline is "${dueTodayTasks[0].title}". A short session now keeps the day steady.`,
          direct: `Handle today's due tasks next, starting with "${dueTodayTasks[0].title}".`,
        }),
        {
          label: 'Open tasks',
          tab: 'tasks',
          focusId: 'tasksContainer',
        }
      )
    );
  }

  if (distractingTabs.length > 0 && topPriorityTask) {
    recommendations.push(
      createRecommendation(
        'focus-shift',
        'Switch from browsing to focused work',
        buildToneCopy(recommendationStyle, {
          supportive: `You have ${distractingTabs.length} likely-distraction tab${distractingTabs.length > 1 ? 's' : ''} open. Start a focus session for "${topPriorityTask.title}".`,
          calm: `Current tab activity suggests a context switch may help. Queue a focus session for "${topPriorityTask.title}".`,
          direct: `Close distractions and start Focus Mode for "${topPriorityTask.title}".`,
        }),
        {
          label: 'Start focus mode',
          tab: 'focus',
          focusId: 'startFocus',
        }
      )
    );
  }

  if (connectionStatus !== 'connected') {
    recommendations.push(
      createRecommendation(
        'reconnect-extension',
        'Reconnect live tab tracking',
        buildToneCopy(recommendationStyle, {
          supportive:
            'Open the extension once so Helpy can resume live browser context and richer reminders.',
          calm: 'Live browser context is unavailable until the extension reconnects.',
          direct: 'Reconnect the extension to restore live tab tracking.',
        }),
        {
          label: 'Open tabs view',
          tab: 'tabs',
          focusId: 'refreshTabsBtn',
          refreshTabs: true,
        }
      )
    );
  }

  if (recommendations.length < 3 && topPriorityTask) {
    recommendations.push(
      createRecommendation(
        'next-best-task',
        'Suggested next task',
        buildToneCopy(recommendationStyle, {
          supportive: `"${topPriorityTask.title}" looks like the best next move based on priority and due date.`,
          calm: `The clearest next step is "${topPriorityTask.title}".`,
          direct: `Work on "${topPriorityTask.title}" next.`,
        }),
        {
          label: 'Go to tasks',
          tab: 'tasks',
          focusId: 'tasksContainer',
        }
      )
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      createRecommendation(
        'steady-state',
        'You are in a good place',
        buildToneCopy(recommendationStyle, {
          supportive: `Nice work, ${addressName}. Use this time to plan a fresh task or start a focus session.`,
          calm: 'No urgent actions are competing for attention right now.',
          direct: 'No urgent recommendations right now.',
        }),
        {
          label: 'Add a task',
          tab: 'tasks',
          focusId: 'taskTitle',
        }
      )
    );
  }

  return recommendations.slice(0, 3);
}

module.exports = {
  DISTRACTING_DOMAINS,
  getPersonalizedRecommendations,
  isTaskDueToday,
  isTaskOverdue,
  parseDomain,
};
