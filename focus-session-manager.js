'use strict';

const { getDataFilePath } = require('./shared/app-paths');
const { safeReadJson, writeJsonAtomic } = require('./shared/file-store');

const SESSION_FILE = getDataFilePath('focus-session-state.json');
const HISTORY_FILE = getDataFilePath('focus-session-history.json');

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function defaultState() {
  return {
    active: false,
    paused: false,
    phase: 'idle',
    endsAt: null,
    remainingMs: 0,
    workMinutes: 25,
    breakMinutes: 5,
    strict: false,
    lockoutUntil: null,
    startedAt: null,
    phaseStartedAt: null,
    interruptionNotes: [],
  };
}

class FocusSessionManager {
  constructor() {
    this.state = { ...defaultState(), ...safeReadJson(SESSION_FILE, {}) };
    this.history = safeReadJson(HISTORY_FILE, { sessions: [], blockedAttempts: [] });
    this.listeners = new Set();
    this._refresh();
  }

  _persist() {
    writeJsonAtomic(SESSION_FILE, this.state);
  }
  _persistHistory() {
    writeJsonAtomic(HISTORY_FILE, this.history);
  }
  _emit() {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
    return state;
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _refresh(now = Date.now()) {
    if (!this.state.active || this.state.paused || !this.state.endsAt) return this.state;
    if (now < this.state.endsAt) return this.state;
    if (this.state.phase === 'work') {
      this._recordCompletedWork(this.state.phaseStartedAt, this.state.endsAt);
      this._beginPhase('break', now);
    } else {
      this._beginPhase('work', now);
    }
    this._persist();
    this._emit();
    return this.state;
  }

  _beginPhase(phase, now = Date.now()) {
    const minutes = phase === 'work' ? this.state.workMinutes : this.state.breakMinutes;
    this.state.phase = phase;
    this.state.phaseStartedAt = new Date(now).toISOString();
    this.state.endsAt = now + minutes * 60 * 1000;
    this.state.remainingMs = minutes * 60 * 1000;
  }

  _recordCompletedWork(startedAt, endedAt) {
    if (!startedAt || !endedAt) return;
    this.history.sessions.push({
      startedAt,
      endedAt: new Date(endedAt).toISOString(),
      durationMs: Math.max(0, endedAt - new Date(startedAt).getTime()),
    });
    this.history.sessions = this.history.sessions.slice(-500);
    this._persistHistory();
  }

  getState() {
    this._refresh();
    const remainingMs =
      this.state.active && !this.state.paused && this.state.endsAt
        ? Math.max(0, this.state.endsAt - Date.now())
        : this.state.remainingMs;
    return {
      ...this.state,
      remainingMs,
      blockingActive: this.state.active && !this.state.paused && this.state.phase === 'work',
      editsLocked: this.isEditsLocked(),
    };
  }

  isEditsLocked(now = Date.now()) {
    this._refresh(now);
    return (
      Boolean(this.state.active && this.state.strict) ||
      Boolean(this.state.lockoutUntil && new Date(this.state.lockoutUntil).getTime() > now)
    );
  }

  start({ workMinutes = 25, breakMinutes = 5, strict = false, cooldownMinutes = 0 } = {}) {
    const work = Math.min(240, Math.max(1, Number(workMinutes) || 25));
    const rest = Math.min(120, Math.max(1, Number(breakMinutes) || 5));
    const now = Date.now();
    this.state = {
      ...defaultState(),
      active: true,
      phase: 'work',
      workMinutes: work,
      breakMinutes: rest,
      strict: Boolean(strict),
      lockoutUntil:
        cooldownMinutes > 0 ? new Date(now + Number(cooldownMinutes) * 60000).toISOString() : null,
      startedAt: new Date(now).toISOString(),
      interruptionNotes: [],
    };
    this._beginPhase('work', now);
    this._persist();
    return this._emit();
  }

  pause() {
    this._refresh();
    if (!this.state.active || this.state.paused) return this.getState();
    this.state.remainingMs = Math.max(0, this.state.endsAt - Date.now());
    this.state.endsAt = null;
    this.state.paused = true;
    this._persist();
    return this._emit();
  }
  resume() {
    if (!this.state.active || !this.state.paused) return this.getState();
    this.state.endsAt = Date.now() + this.state.remainingMs;
    this.state.paused = false;
    this._persist();
    return this._emit();
  }
  stop() {
    this._refresh();
    if (this.state.active && this.state.phase === 'work' && this.state.phaseStartedAt)
      this._recordCompletedWork(this.state.phaseStartedAt, Date.now());
    this.state = defaultState();
    this._persist();
    return this._emit();
  }
  addInterruptionNote(note) {
    if (!this.state.active || typeof note !== 'string' || !note.trim()) return this.getState();
    this.state.interruptionNotes = [...(this.state.interruptionNotes || []), note.trim().slice(0, 500)].slice(-20);
    this._persist();
    return this._emit();
  }
  reportBlockedAttempt(domain) {
    if (!domain) return;
    this.history.blockedAttempts.push({
      domain: String(domain).toLowerCase(),
      at: new Date().toISOString(),
    });
    this.history.blockedAttempts = this.history.blockedAttempts.slice(-2000);
    this._persistHistory();
  }
  getReport(now = new Date()) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(dayStart);
    weekStart.setDate(dayStart.getDate() - 6);
    const sessions = this.history.sessions || [];
    const sum = (from, to) =>
      sessions
        .filter((s) => new Date(s.startedAt) >= from && new Date(s.startedAt) < to)
        .reduce((total, s) => total + s.durationMs, 0);
    const trend = Array.from({ length: 7 }, (_, index) => {
      const start = new Date(weekStart);
      start.setDate(weekStart.getDate() + index);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      return { date: localDateKey(start), durationMs: sum(start, end) };
    });
    const counts = {};
    (this.history.blockedAttempts || [])
      .filter((a) => new Date(a.at) >= weekStart)
      .forEach((a) => {
        counts[a.domain] = (counts[a.domain] || 0) + 1;
      });
    let streak = 0;
    for (let offset = 0; offset < 365; offset += 1) {
      const start = new Date(dayStart);
      start.setDate(dayStart.getDate() - offset);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      if (sum(start, end) <= 0) break;
      streak += 1;
    }
    return {
      todayFocusedMs: sum(dayStart, new Date(dayStart.getTime() + 86400000)),
      weeklyTrend: trend,
      topBlockedAttempts: Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([domain, count]) => ({ domain, count })),
      streak,
    };
  }
}

module.exports = { FocusSessionManager };
