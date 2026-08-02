/**
 * Sanitizes a display name by trimming whitespace and limiting length
 * @param {*} value - Value to sanitize
 * @returns {string} Sanitized display name
 */
function sanitizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * Gets the display name from settings
 * @param {Object} [settings={}] - Settings object
 * @returns {string} Display name
 */
function getDisplayName(settings = {}) {
  return sanitizeDisplayName(settings.displayName);
}

/**
 * Gets an address name (fallback to 'there')
 * @param {Object} [settings={}] - Settings object
 * @param {string} [fallback='there'] - Fallback value
 * @returns {string} Address name
 */
function getAddressName(settings = {}, fallback = 'there') {
  return getDisplayName(settings) || fallback;
}

/**
 * Gets user initials from display name
 * @param {Object} [settings={}] - Settings object
 * @returns {string} User initials
 */
function getUserInitials(settings = {}) {
  const name = getDisplayName(settings);
  if (!name) return '';

  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  if (words.length === 1) {
    return words[0][0].toUpperCase();
  }

  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Gets a time-of-day greeting
 * @returns {string} Greeting based on current time
 */
function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Creates a personalized greeting
 * @param {Object} [settings={}] - Settings object
 * @returns {string} Personalized greeting
 */
function createGreeting(settings = {}) {
  const name = getDisplayName(settings);
  const timeGreeting = getTimeOfDayGreeting();
  return name ? `${timeGreeting}, ${name}!` : `${timeGreeting}!`;
}

/**
 * Personalizes a label with the user's name
 * @param {string} baseLabel - Base label to personalize
 * @param {Object} [settings={}] - Settings object
 * @returns {string} Personalized label
 */
function personalizeLabel(baseLabel, settings = {}) {
  const name = getDisplayName(settings);
  return name ? `${baseLabel}, ${name}` : baseLabel;
}

/**
 * Creates the primary app subtitle based on personalization state
 * @param {Object} [settings={}] - Settings object
 * @returns {string} Subtitle copy
 */
function createAppSubtitle(settings = {}) {
  const name = getDisplayName(settings);
  return name
    ? `Helpy keeps your tasks, timers, tabs, and reminders lined up for you, ${name}.`
    : 'Helpy keeps your tasks, timers, tabs, and reminders lined up in one calm workspace.';
}

/**
 * Personalizes a sentence while preserving a readable fallback
 * @param {string} baseText - Base copy to personalize
 * @param {Object} [settings={}] - Settings object
 * @param {string} [fallback=''] - Fallback text when no name is available
 * @returns {string} Personalized or fallback copy
 */
function createNamedSentence(baseText, settings = {}, fallback = '') {
  const name = getDisplayName(settings);
  if (!name) {
    return fallback || baseText;
  }

  return `${baseText}, ${name}.`;
}

/**
 * Creates a personalized focus session greeting
 * @param {Object} [settings={}] - Settings object
 * @returns {string} Focus greeting
 */
function createFocusGreeting(settings = {}) {
  const name = getDisplayName(settings);
  return name ? `Let's focus, ${name}!` : "Let's focus!";
}

/**
 * Creates a personalized task completion message
 * @param {Object} [settings={}] - Settings object
 * @param {string} [taskTitle=''] - Title of the completed task
 * @returns {string} Completion message
 */
function createCompletionMessage(settings = {}, taskTitle = '') {
  const name = getDisplayName(settings);
  const taskPart = taskTitle ? ` "${taskTitle}" is done.` : ' Task complete.';
  return name ? `Great work, ${name}!${taskPart}` : `Great work!${taskPart}`;
}

/**
 * Creates a personalized daily summary header
 * @param {Object} [settings={}] - Settings object
 * @param {string} [dateLabel='today'] - Human-readable date label
 * @returns {string} Daily summary header
 */
function createDailySummaryHeader(settings = {}, dateLabel = 'today') {
  const name = getDisplayName(settings);
  return name ? `Here's your ${dateLabel} summary, ${name}.` : `Here's your ${dateLabel} summary.`;
}

module.exports = {
  sanitizeDisplayName,
  getDisplayName,
  getAddressName,
  getUserInitials,
  getTimeOfDayGreeting,
  createGreeting,
  personalizeLabel,
  createAppSubtitle,
  createNamedSentence,
  createFocusGreeting,
  createCompletionMessage,
  createDailySummaryHeader,
};
