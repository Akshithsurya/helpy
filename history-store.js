const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');
const {
  normalizeActiveFocusSession,
  normalizeAppHistoryArray,
  normalizeHistoryArray,
  normalizeFocusHistoryArray,
} = require('./shared/schemas');

const MAX_HISTORY_ENTRIES = 2000;
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function createHistoryStore(fileName, normalizeArray) {
  const filePath = getDataFilePath(fileName);

  return {
    filePath,
    load() {
      const entries = safeReadJson(filePath, [], normalizeArray);
      return pruneHistory(entries);
    },
    save(entries) {
      const pruned = pruneHistory(entries);
      writeJsonAtomic(filePath, pruned);
      return pruned;
    },
    append(entries, nextEntries) {
      return this.save([...(Array.isArray(entries) ? entries : []), ...nextEntries]);
    },
  };
}

function createSingleEntryStore(fileName, normalizeValue) {
  const filePath = getDataFilePath(fileName);

  return {
    filePath,
    load() {
      return safeReadJson(filePath, null, normalizeValue);
    },
    save(value) {
      const normalized = normalizeValue(value);
      writeJsonAtomic(filePath, normalized);
      return normalized;
    },
    clear() {
      writeJsonAtomic(filePath, null);
      return null;
    },
  };
}

function pruneHistory(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const cutoff = Date.now() - HISTORY_RETENTION_MS;

  return entries
    .filter((entry) => entry && Number(entry.startTime) > cutoff)
    .slice(-MAX_HISTORY_ENTRIES);
}

const tabHistoryStore = createHistoryStore('tab-history.json', normalizeHistoryArray);
const appHistoryStore = createHistoryStore('app-history.json', normalizeAppHistoryArray);
const focusHistoryStore = createHistoryStore('focus-history.json', normalizeFocusHistoryArray);
const activeFocusSessionStore = createSingleEntryStore(
  'active-focus-session.json',
  normalizeActiveFocusSession
);

module.exports = {
  MAX_HISTORY_ENTRIES,
  activeFocusSessionStore,
  appHistoryStore,
  focusHistoryStore,
  pruneHistory,
  tabHistoryStore,
};
