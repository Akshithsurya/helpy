class FocusSession {
  constructor(state = {}) {
    this.mode = state.mode === 'break' ? 'break' : 'focus';
    this.status = state.status || 'idle';
    this.durationMs = Number(state.durationMs) || 25 * 60 * 1000;
    this.startedAt = state.startedAt || null;
    this.endAt = state.endAt || null;
    this.pausedAt = state.pausedAt || null;
    this.remainingMs = Number(state.remainingMs) || this.durationMs;
    this.totalPausedMs = Number(state.totalPausedMs) || 0;
    this.sessionCount = Number(state.sessionCount) || 0;
    this.taskId = state.taskId ?? null;
    this.taskTitle = state.taskTitle || '';
    this.goal = state.goal || '';
    this.blockerState = state.blockerState || { level: 'off', active: false, bypassUntil: null };
    this.interruptionNotes = Array.isArray(state.interruptionNotes)
      ? [...state.interruptionNotes]
      : [];
    this.updatedAt = state.updatedAt || new Date().toISOString();
  }

  getRemainingMs(now = Date.now()) {
    if (this.status === 'paused') {
      return this.remainingMs;
    }

    if (this.status !== 'running' || !this.endAt) {
      return Math.max(0, this.remainingMs);
    }

    return Math.max(0, this.endAt - now);
  }

  toJSON(now = Date.now()) {
    return {
      mode: this.mode,
      status: this.status,
      durationMs: this.durationMs,
      startedAt: this.startedAt,
      endAt: this.endAt,
      pausedAt: this.pausedAt,
      remainingMs: this.getRemainingMs(now),
      totalPausedMs: this.totalPausedMs,
      sessionCount: this.sessionCount,
      taskId: this.taskId,
      taskTitle: this.taskTitle,
      goal: this.goal,
      blockerState: { ...this.blockerState },
      interruptionNotes: [...this.interruptionNotes],
      updatedAt: new Date(now).toISOString(),
    };
  }
}

class FocusManager {
  constructor(settingsManager = null, options = {}) {
    this.settingsManager = settingsManager;
    this.sessionStore = options.sessionStore || null;
    this.onTick = typeof options.onTick === 'function' ? options.onTick : null;
    this.onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
    this.onSessionComplete =
      typeof options.onSessionComplete === 'function' ? options.onSessionComplete : null;
    this.currentSession = null;
    this.tickTimer = null;
    this.sessionCount = 0;
    this.isBreak = false;
    this.loadState();
  }

  loadState() {
    const persisted = this.sessionStore?.load?.();
    if (!persisted) {
      return;
    }

    this.currentSession = new FocusSession(persisted);
    this.sessionCount = this.currentSession.sessionCount || 0;
    this.isBreak = this.currentSession.mode === 'break';

    if (this.currentSession.status === 'running') {
      if (this.currentSession.getRemainingMs() <= 0) {
        this.completeSession('recovered-timeout');
        return;
      }
      this._ensureTicking();
    }

    this._emitState();
  }

  destroy() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  _getSettings() {
    return this.settingsManager?.getSettings?.() || {};
  }

  getDurationMs(mode = 'focus') {
    const settings = this._getSettings();
    if (mode === 'break') {
      const useLongBreak =
        this.sessionCount > 0 &&
        this.sessionCount % Math.max(1, Number(settings.sessionsBeforeLongBreak || 4)) === 0;
      const minutes = useLongBreak
        ? Number(settings.longBreakDuration || 15)
        : Number(settings.breakDuration || 5);
      return Math.max(1, minutes) * 60 * 1000;
    }

    return Math.max(5, Number(settings.focusSessionDuration || 25)) * 60 * 1000;
  }

  getDefaultBlockerState() {
    const settings = this._getSettings();
    return {
      level: settings.distractionBlockLevel || 'off',
      active: Boolean(settings.distractionBlockLevel && settings.distractionBlockLevel !== 'off'),
      bypassUntil: null,
    };
  }

  startSession(options = {}) {
    const mode = options.mode === 'break' || options.isBreak ? 'break' : 'focus';
    const durationMs = Number(options.durationMs) || this.getDurationMs(mode);

    this.destroy();
    this.currentSession = new FocusSession({
      mode,
      status: 'running',
      durationMs,
      startedAt: Date.now(),
      endAt: Date.now() + durationMs,
      pausedAt: null,
      remainingMs: durationMs,
      totalPausedMs: 0,
      sessionCount: this.sessionCount,
      taskId: options.taskId ?? null,
      taskTitle: options.taskTitle || '',
      goal: options.goal || '',
      blockerState: options.blockerState || this.getDefaultBlockerState(),
      interruptionNotes: [],
    });
    this.isBreak = mode === 'break';
    this._persist();
    this._ensureTicking();
    this._emitState();
    return this.getState();
  }

  pauseSession() {
    if (!this.currentSession || this.currentSession.status !== 'running') {
      return this.getState();
    }

    this.currentSession.remainingMs = this.currentSession.getRemainingMs();
    this.currentSession.status = 'paused';
    this.currentSession.pausedAt = Date.now();
    this.currentSession.endAt = null;
    this.destroy();
    this._persist();
    this._emitState();
    return this.getState();
  }

  resumeSession() {
    if (!this.currentSession || this.currentSession.status !== 'paused') {
      return this.getState();
    }

    const resumedAt = Date.now();
    const pausedDuration = this.currentSession.pausedAt
      ? resumedAt - this.currentSession.pausedAt
      : 0;
    this.currentSession.totalPausedMs += Math.max(0, pausedDuration);
    this.currentSession.status = 'running';
    this.currentSession.pausedAt = null;
    this.currentSession.startedAt = this.currentSession.startedAt || resumedAt;
    this.currentSession.endAt = resumedAt + this.currentSession.remainingMs;
    this._persist();
    this._ensureTicking();
    this._emitState();
    return this.getState();
  }

  resetSession() {
    this.destroy();
    this.currentSession = null;
    this._persist();
    this._emitState();
    return this.getState();
  }

  skipSession() {
    return this.completeSession('skipped');
  }

  completeSession(reason = 'completed') {
    if (!this.currentSession) {
      return null;
    }

    const now = Date.now();
    const sessionSnapshot = this.currentSession.toJSON(now);
    const completedEntry = {
      startTime: sessionSnapshot.startedAt || now,
      endTime: now,
      duration: Math.max(0, sessionSnapshot.durationMs - sessionSnapshot.remainingMs),
      isBreak: sessionSnapshot.mode === 'break',
      goal: sessionSnapshot.goal,
      taskId: sessionSnapshot.taskId,
      taskTitle: sessionSnapshot.taskTitle,
      reason,
    };

    if (!sessionSnapshot.isBreak && sessionSnapshot.mode !== 'break') {
      this.sessionCount += 1;
    }

    this.isBreak = !sessionSnapshot.isBreak && sessionSnapshot.mode !== 'break';
    this.destroy();
    this.currentSession = null;
    this._persist();
    this._emitState();

    if (this.onSessionComplete) {
      this.onSessionComplete(completedEntry, this.getState());
    }

    return completedEntry;
  }

  updateTaskContext({ taskId = null, taskTitle = '', goal = '' } = {}) {
    if (!this.currentSession) {
      return this.getState();
    }

    this.currentSession.taskId = taskId;
    this.currentSession.taskTitle = taskTitle || '';
    this.currentSession.goal = goal || this.currentSession.goal;
    this._persist();
    this._emitState();
    return this.getState();
  }

  updateBlockerState(blockerState = {}) {
    if (!this.currentSession) {
      return this.getState();
    }

    this.currentSession.blockerState = {
      ...this.currentSession.blockerState,
      ...blockerState,
    };
    this._persist();
    this._emitState();
    return this.getState();
  }

  addInterruptionNote(note) {
    if (!this.currentSession || typeof note !== 'string' || !note.trim()) {
      return this.getState();
    }

    this.currentSession.interruptionNotes = [
      ...this.currentSession.interruptionNotes,
      note.trim().slice(0, 500),
    ].slice(-20);
    this._persist();
    this._emitState();
    return this.getState();
  }

  _ensureTicking() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }

    this.tickTimer = setInterval(() => {
      if (!this.currentSession || this.currentSession.status !== 'running') {
        this.destroy();
        return;
      }

      const remainingMs = this.currentSession.getRemainingMs();
      if (remainingMs <= 0) {
        this.completeSession('completed');
        return;
      }

      this._persist();
      this._emitState();
    }, 1000);
  }

  _persist() {
    if (!this.sessionStore) {
      return;
    }

    if (!this.currentSession) {
      this.sessionStore.clear?.();
      return;
    }

    this.sessionStore.save?.(this.currentSession.toJSON());
  }

  _emitState() {
    const state = this.getState();
    if (this.onTick) {
      this.onTick(state);
    }
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  getState() {
    if (!this.currentSession) {
      return {
        status: 'idle',
        isRunning: false,
        isPaused: false,
        isBreak: this.isBreak,
        remainingMs: 0,
        durationMs: this.getDurationMs(this.isBreak ? 'break' : 'focus'),
        sessionCount: this.sessionCount,
        taskId: null,
        taskTitle: '',
        goal: '',
        blockerState: this.getDefaultBlockerState(),
        interruptionNotes: [],
      };
    }

    const snapshot = this.currentSession.toJSON();
    return {
      ...snapshot,
      isRunning: snapshot.status === 'running',
      isPaused: snapshot.status === 'paused',
      isBreak: snapshot.mode === 'break',
    };
  }
}

module.exports = { FocusSession, FocusManager };
