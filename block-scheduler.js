/**
 * block-scheduler.js
 * Manages BlockRule objects and evaluates which domains are currently blocked.
 *
 * BlockRule schema:
 * {
 *   id:        string  — UUID
 *   name:      string  — human label e.g. "Work hours"
 *   domains:   string[] — ["reddit.com", "youtube.com"]
 *   schedule:  { days: number[], startTime: "HH:MM", endTime: "HH:MM" } | null
 *              null → always active
 *   enabled:   boolean
 *   createdAt: string  — ISO timestamp
 * }
 */

'use strict';

const crypto = require('crypto');
const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');

const RULES_FILE = getDataFilePath('block-rules.json');

/** @returns {string} current HH:MM in local time */
function localHHMM(now = new Date()) {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Returns true if timeStr is between startTime and endTime (inclusive, 24-h "HH:MM").
 * Handles overnight spans (e.g. 22:00–06:00).
 * @param {string} timeStr - current time "HH:MM"
 * @param {string} startTime - "HH:MM"
 * @param {string} endTime   - "HH:MM"
 */
function isTimeInRange(timeStr, startTime, endTime) {
  if (!startTime || !endTime) return true;
  if (startTime === endTime) return true;
  if (startTime < endTime) {
    return timeStr >= startTime && timeStr <= endTime;
  }
  // Overnight wrap: e.g. 22:00 → 06:00
  return timeStr >= startTime || timeStr <= endTime;
}

/**
 * Normalizes a domain string: lowercases, strips leading "www.".
 * @param {string} d
 * @returns {string|null}
 */
function normalizeDomain(d) {
  if (typeof d !== 'string') return null;
  const cleaned = d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  if (!cleaned || cleaned.length > 253) return null;
  return cleaned;
}

/**
 * Sanitizes a raw rule object into a validated BlockRule.
 * @param {object} raw
 * @returns {import('./block-scheduler').BlockRule}
 */
function sanitizeRule(raw = {}) {
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 100)
      : 'Unnamed rule';
  const domains = Array.isArray(raw.domains)
    ? raw.domains.map(normalizeDomain).filter(Boolean)
    : [];
  const enabled = raw.enabled !== false; // default true

  let schedule = null;
  if (raw.schedule && typeof raw.schedule === 'object') {
    const rawDays = Array.isArray(raw.schedule.days) ? raw.schedule.days : [];
    const days = rawDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const startTime =
      typeof raw.schedule.startTime === 'string'
        ? raw.schedule.startTime.trim().slice(0, 5)
        : '00:00';
    const endTime =
      typeof raw.schedule.endTime === 'string' ? raw.schedule.endTime.trim().slice(0, 5) : '23:59';
    schedule = { days, startTime, endTime };
  }

  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString();

  return { id, name, domains, schedule, enabled, createdAt };
}

class BlockScheduler {
  constructor() {
    /** @type {import('./block-scheduler').BlockRule[]} */
    this._rules = [];
    this._loaded = false;
  }

  /** Load rules from disk (lazy, called on first access). */
  _ensureLoaded() {
    if (this._loaded) return;
    const data = safeReadJson(RULES_FILE, { rules: [] });
    this._rules = Array.isArray(data.rules) ? data.rules.map(sanitizeRule) : [];
    this._loaded = true;
  }

  _persist() {
    writeJsonAtomic(RULES_FILE, { rules: this._rules });
  }

  /** @returns {import('./block-scheduler').BlockRule[]} */
  getRules() {
    this._ensureLoaded();
    return this._rules.map((r) => ({ ...r, domains: [...r.domains] }));
  }

  /**
   * @param {object} data - partial BlockRule (id ignored/auto-generated)
   * @returns {import('./block-scheduler').BlockRule}
   */
  createRule(data = {}) {
    this._ensureLoaded();
    const rule = sanitizeRule({
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    if (rule.domains.length === 0) {
      throw new Error('A block rule must have at least one domain.');
    }
    this._rules.push(rule);
    this._persist();
    return { ...rule };
  }

  /**
   * @param {string} id
   * @param {object} updates
   * @returns {import('./block-scheduler').BlockRule|null}
   */
  updateRule(id, updates = {}) {
    this._ensureLoaded();
    const idx = this._rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const merged = sanitizeRule({
      ...this._rules[idx],
      ...updates,
      id,
      createdAt: this._rules[idx].createdAt,
    });
    if (merged.domains.length === 0) {
      throw new Error('A block rule must have at least one domain.');
    }
    this._rules[idx] = merged;
    this._persist();
    return { ...merged };
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  deleteRule(id) {
    this._ensureLoaded();
    const before = this._rules.length;
    this._rules = this._rules.filter((r) => r.id !== id);
    if (this._rules.length < before) {
      this._persist();
      return true;
    }
    return false;
  }

  /**
   * Returns the set of domains that are currently blocked, given the current time.
   * Merges all enabled, schedule-matching rules.
   *
   * @param {Date} [now] - override for testing
   * @returns {{ active: boolean, blockedDomains: string[], activeRules: string[] }}
   */
  getBlockState(now = new Date()) {
    this._ensureLoaded();
    const currentDay = now.getDay(); // 0=Sun
    const currentTime = localHHMM(now);

    const blockedSet = new Set();
    const activeRuleNames = [];

    for (const rule of this._rules) {
      if (!rule.enabled) continue;
      if (rule.domains.length === 0) continue;

      let ruleActive = false;
      if (rule.schedule === null) {
        // Always-on rule
        ruleActive = true;
      } else {
        const dayMatch = rule.schedule.days.length === 0 || rule.schedule.days.includes(currentDay);
        const timeMatch = isTimeInRange(
          currentTime,
          rule.schedule.startTime,
          rule.schedule.endTime
        );
        ruleActive = dayMatch && timeMatch;
      }

      if (ruleActive) {
        activeRuleNames.push(rule.name);
        for (const d of rule.domains) {
          blockedSet.add(d);
        }
      }
    }

    const blockedDomains = Array.from(blockedSet).sort();
    return {
      active: blockedDomains.length > 0,
      blockedDomains,
      activeRules: activeRuleNames,
    };
  }
}

// Export a singleton instance
const blockScheduler = new BlockScheduler();

module.exports = blockScheduler;
