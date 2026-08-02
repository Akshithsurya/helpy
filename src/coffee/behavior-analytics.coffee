### BehaviorAnalytics — lightweight, privacy-friendly event tracker with
persistence, trend analysis, and event emitter hooks.
###

# ── Helpers ──────────────────────────────────────────────────────────────────

_isString = (v) -> typeof v is 'string'
_isNumber = (v) -> typeof v is 'number' and Number.isFinite(v)
_isFunction = (v) -> typeof v is 'function'
_isPlainObject = (v) ->
  return false unless v? and typeof v is 'object'
  return false if Array.isArray v
  proto = Object.getPrototypeOf v
  proto is null or proto is Object.prototype

MS_PER_DAY  = 86400000
MS_PER_HOUR = 3600000

DEFAULT_MAX_EVENTS       = 1000
DEFAULT_SAVE_DEBOUNCE_MS = 500
DEFAULT_FLUSH_THRESHOLD  = 100
HOURS_PER_DAY            = 24
DEFAULT_LOOKBACK_DAYS    = 7
DEFAULT_DROP_WINDOW_DAYS = 3
DEFAULT_FOCUS_STATS_DAYS = 30
DEFAULT_PLAN_THRESHOLD   = 10
DEFAULT_COMPLETION_RATE  = 0.5
MAX_BEST_HOURS_DISPLAY   = 3

# ── Default event whitelist ──────────────────────────────────────────────────

BASE_EVENT_TYPES = [
  'plan_action', 'ui_interaction', 'focus_mode', 'focus_toggle',
  'task_create', 'task_complete', 'task_update', 'task_delete',
  'session_start', 'session_end', 'command_palette', 'slash_command',
  'notification_shown', 'notification_clicked',
  'habit_complete', 'reminder_triggered',
  'break_start', 'break_end',
  'window_tracking', 'tab_tracking', 'settings_change',
  'template_save', 'template_load',
  'error',
  'music_play', 'music_pause', 'music_next', 'music_previous',
  'music_seek', 'music_volume', 'music_repeat', 'music_shuffle',
  'music_track_end', 'music_preset_apply',
  'music_queue_add', 'music_queue_reorder', 'music_favorite_toggle',
  'music_library_scan', 'music_source_search',
  'music_playlist_create', 'music_playlist_update',
]

EXTENDED_EVENT_TYPES = [
  'focus_session_start', 'focus_session_pause', 'focus_session_resume', 'focus_session_end',
  'collab_comment', 'collab_file_share', 'collab_meeting_participate'
]

DEFAULT_EVENT_TYPES = Object.freeze BASE_EVENT_TYPES.concat(EXTENDED_EVENT_TYPES)

DEFAULT_I18N = Object.freeze
  bestTimeFmt:   (hoursStr) ->
    "You are typically most active around #{hoursStr}; try scheduling important tasks then."
  bestTimeOrFmt: ' or '
  smallerTasks:  'Consider breaking tasks into smaller chunks to improve completion rate.'

# ── Deep clone & sanitize (drops functions/symbols, handles cycles) ──────────

_sanitize = (value, seen = new WeakSet()) ->
  return value if value is null or typeof value isnt 'object'
  return '[Circular]' if seen.has value
  seen.add value
  try
    if Array.isArray value
      out = for item in value
        continue if typeof item is 'function'
        s = _sanitize item, seen
        s unless s is undefined
      seen.delete value
      return out
    if value instanceof Date
      seen.delete value
      return value.toISOString()
    if _isPlainObject value
      out = {}
      for k, v of value
        continue if typeof v is 'function' or typeof k is 'symbol'
        s = _sanitize v, seen
        out[k] = s unless s is undefined
      seen.delete value
      out
    else
      seen.delete value
      String value
  catch
    seen.delete value
    {}

# ── Deep freeze ──────────────────────────────────────────────────────────────

_deepFreeze = (obj) ->
  return obj unless obj? and typeof obj is 'object' and not Object.isFrozen(obj)
  if Array.isArray obj
    _deepFreeze v for v in obj
  else if _isPlainObject obj
    _deepFreeze v for own k, v of obj
  Object.freeze obj

# ── Safe JSON serialization (for export / CSV) ───────────────────────────────

_safeStringify = (obj) ->
  try
    return JSON.stringify obj
  catch
    seen = new WeakSet()
    try
      return JSON.stringify obj, (k, v) ->
        if typeof v is 'object' and v isnt null
          return '[Circular]' if seen.has v
          seen.add v
        v
    catch
      return '{}'

# ── CSV helper (RFC 4180) ───────────────────────────────────────────────────

_csvEscape = (str) ->
  s = if str is null or str is undefined then '' else String(str)
  if /["\n\r,]/.test s then '"' + s.replace(/"/g, '""') + '"' else s

# ── Music payload schema ────────────────────────────────────────────────────

MUSIC_PAYLOAD_SCHEMA =
  trackId:           'string'
  presetId:          'string'
  playlistId:        'string'
  planId:            'string'
  sourceType:        'string'
  repeatMode:        'string'
  volume:            'clamped01'
  shuffle:           'boolean'
  positionSec:       'floorInt'
  durationPlayedSec: 'floorInt'
  toIndex:           'floorInt'
  fromIndex:         'floorInt'
  totalTracks:       'floorInt'
  query:             'string256'

_coerceField = (value, rule) ->
  switch rule
    when 'string'     then if _isString(value) and value.length > 0 then value else undefined
    when 'string256'  then if _isString(value) then value.substring(0, 256) else undefined
    when 'clamped01'  then if _isNumber(value) then Math.max(0, Math.min(1, value)) else undefined
    when 'boolean'    then !!value
    when 'floorInt'
      if _isNumber(value) then Math.floor(value) else undefined
    else undefined

# ── BehaviorAnalytics ────────────────────────────────────────────────────────

class BehaviorAnalytics

  @VERSION       = '2.2.0'
  @MAX_EVENTS    = DEFAULT_MAX_EVENTS
  @SAVE_DEBOUNCE = DEFAULT_SAVE_DEBOUNCE_MS
  @DEFAULT_EVENT_TYPES = DEFAULT_EVENT_TYPES

  VALID_EMITTER_EVENTS = Object.freeze ['track', 'flush', 'clear', 'destroy']

  constructor: (@store = null, opts = {}) ->
    opts = {} unless _isPlainObject opts

    @_clock = if _isPlainObject(opts.clock) and _isFunction(opts.clock.now)
      opts.clock
    else
      { now: -> Date.now() }

    @_maxEvents      = if _isNumber(opts.maxEvents) and opts.maxEvents > 0 then Math.floor opts.maxEvents else DEFAULT_MAX_EVENTS
    @_saveDebounce   = if _isNumber(opts.saveDebounceMs) and opts.saveDebounceMs >= 0 then Math.floor opts.saveDebounceMs else DEFAULT_SAVE_DEBOUNCE_MS
    @_flushThreshold = if _isNumber(opts.flushThreshold) and opts.flushThreshold > 0 then Math.floor opts.flushThreshold else DEFAULT_FLUSH_THRESHOLD

    if @_flushThreshold > @_maxEvents
      @logger?.warn? "[BehaviorAnalytics] flushThreshold exceeds maxEvents; clamping to #{@_maxEvents}."
      @_flushThreshold = @_maxEvents

    @_allowUnknown   = opts.allowUnknownEvents isnt false
    @_freezeEvents   = opts.freezeEvents isnt false

    @logger          = @_resolveLogger opts.logger
    @i18n            = @_buildI18n opts
    @events          = []
    @_eventsSinceFlush = 0
    @currentSession  = @_uniqueId 'session'
    @_idCounter      = 0
    @_saveTimeout    = null
    @_destroyed      = false
    @_listeners      = {}
    @_handlers       = {}
    @_allowedEventTypes = new Set DEFAULT_EVENT_TYPES

    @_loadHistory()
    @_bindLifecycle()

  # ── Public accessors ──────────────────────────────────────────────────────

  isDestroyed: -> @_destroyed
  eventCount:  -> @events.length

  # ── Config helpers ────────────────────────────────────────────────────────

  _resolveLogger: (candidate) ->
    if _isPlainObject(candidate) and
       _isFunction(candidate.debug) and _isFunction(candidate.info) and
       _isFunction(candidate.warn) and _isFunction(candidate.error)
      candidate
    else
      console

  _buildI18n: (opts) ->
    base =
      bestTimeFmt:   DEFAULT_I18N.bestTimeFmt
      bestTimeOrFmt: DEFAULT_I18N.bestTimeOrFmt
      smallerTasks:  DEFAULT_I18N.smallerTasks
    if _isPlainObject opts
      base.bestTimeFmt   = opts.bestTimeMessageFmt  if _isFunction opts.bestTimeMessageFmt
      base.bestTimeOrFmt = opts.bestTimeOrFmt        if _isString  opts.bestTimeOrFmt
      base.smallerTasks  = opts.smallerTasksMessage  if _isString  opts.smallerTasksMessage
    Object.freeze base

  # ── Whitelist management ──────────────────────────────────────────────────

  registerEventType: (type) ->
    unless _isString(type) and type.length > 0
      @logger.warn '[BehaviorAnalytics] registerEventType: invalid type — ignored'
      return false
    return false if @_allowedEventTypes.has type
    @_allowedEventTypes.add type
    true

  listEventTypes: -> Array.from @_allowedEventTypes

  # ── Identity / time ───────────────────────────────────────────────────────

  _uniqueId: (prefix) ->
    @_idCounter++
    "#{prefix}_#{@_clock.now()}_#{@_idCounter}"

  _localHour: (d) -> d.getHours()

  _isoTimestamp: (d) ->
    p = (n, l = 2) -> String(n).padStart l, '0'
    "#{d.getUTCFullYear()}-#{p(d.getUTCMonth() + 1)}-#{p(d.getUTCDate())}" +
    "T#{p(d.getUTCHours())}:#{p(d.getUTCMinutes())}:#{p(d.getUTCSeconds())}" +
    ".#{p(d.getUTCMilliseconds(), 3)}Z"

  _localDayKey: (d) -> Date.UTC d.getFullYear(), d.getMonth(), d.getDate()

  # ── Persistence ───────────────────────────────────────────────────────────

  _loadHistory: ->
    return unless @store? and _isFunction @store.get
    try
      raw = @store.get 'behavioralEvents'
      unless Array.isArray raw then @events = []; return
      @events = raw.filter (e) ->
        _isPlainObject(e) and _isString(e.id) and _isString(e.type) and _isNumber(e.time)
      
      # Backfill `day` for older events loaded from storage
      for e in @events
        e.day ?= @_localDayKey new Date e.time
        
      @_trimEvents()
    catch err
      @logger.warn '[BehaviorAnalytics] Failed to load history.', err?.message
      @events = []

  _trimEvents: ->
    excess = @events.length - @_maxEvents
    @events.splice 0, excess if excess > 0

  flush: ->
    return if @_destroyed
    @_cancelSave()
    @_persist()
    @_eventsSinceFlush = 0
    @_emit 'flush', [ @events.length ]

  _persist: ->
    return unless @store? and _isFunction @store.set
    try
      @store.set 'behavioralEvents', @events
    catch err
      @logger.error '[BehaviorAnalytics] Persist failed.', err?.message

  _scheduleSave: ->
    return unless @store? and _isFunction @store.set
    @_cancelSave()
    @_saveTimeout = setTimeout (=> @_persist()), @_saveDebounce

  _cancelSave: ->
    return unless @_saveTimeout?
    clearTimeout @_saveTimeout
    @_saveTimeout = null

  # ── Emitter ───────────────────────────────────────────────────────────────

  on: (eventName, handler) ->
    unless eventName in VALID_EMITTER_EVENTS
      @logger.warn "[BehaviorAnalytics] on: unknown event '#{eventName}'"
      return ->
    unless _isFunction handler
      @logger.warn '[BehaviorAnalytics] on: handler must be a function'
      return ->
    (@_listeners[eventName] ?= []).push handler
    list    = @_listeners[eventName]
    removed = false
    =>
      return if removed
      removed = true
      idx = list.indexOf handler
      list.splice idx, 1 if idx >= 0

  _emit: (eventName, args = []) ->
    list = @_listeners[eventName]
    return unless list?.length > 0
    snapshot = list.slice()
    for fn in snapshot
      try fn args...
      catch err
        @logger.error "[BehaviorAnalytics] #{eventName} handler threw.", err?.message

  # ── Lifecycle ─────────────────────────────────────────────────────────────

  _bindLifecycle: ->
    @_handlers.flushFn = => @flush()

    if typeof document isnt 'undefined' and typeof window isnt 'undefined'
      @_handlers.onVis = =>
        @flush() if document.visibilityState is 'hidden'
      document.addEventListener 'visibilitychange', @_handlers.onVis
      window.addEventListener 'pagehide',     @_handlers.flushFn
      window.addEventListener 'beforeunload', @_handlers.flushFn
      @_handlers.browser = true

    if typeof process isnt 'undefined' and _isFunction(process.on)
      process.on 'SIGINT',  @_handlers.flushFn
      process.on 'SIGTERM', @_handlers.flushFn
      @_handlers.node = true

  destroy: ->
    return if @_destroyed
    @flush()
    @_emit 'destroy', []

    if @_handlers.browser
      document.removeEventListener 'visibilitychange', @_handlers.onVis
      window.removeEventListener 'pagehide',     @_handlers.flushFn
      window.removeEventListener 'beforeunload', @_handlers.flushFn

    if @_handlers.node
      process.removeListener 'SIGINT',  @_handlers.flushFn
      process.removeListener 'SIGTERM', @_handlers.flushFn

    @_cancelSave()
    @_listeners = {}
    @_handlers  = {}
    @_destroyed = true

  # ── Core tracking ─────────────────────────────────────────────────────────

  _buildEvent: (eventType, data) ->
    if @_destroyed
      @logger.debug '[BehaviorAnalytics] trackEvent after destroy — ignored'
      return null

    unless _isString(eventType) and eventType.length > 0
      @logger.warn '[BehaviorAnalytics] trackEvent: eventType must be a non-empty string'
      return null

    unless @_allowedEventTypes.has eventType
      if @_allowUnknown
        @logger.info "[BehaviorAnalytics] unknown event '#{eventType}' — register it to silence this warning"
      else
        @logger.warn "[BehaviorAnalytics] event '#{eventType}' not in whitelist — rejected"
        return null

    data = {} unless _isPlainObject data
    now  = @_clock.now()
    d    = new Date now

    event =
      id:        @_uniqueId 'evt'
      type:      eventType
      timestamp: @_isoTimestamp d
      time:      now
      hour:      @_localHour d
      day:       @_localDayKey d
      sessionId: @currentSession
      data:      _sanitize data

    _deepFreeze event if @_freezeEvents
    event

  _storeEvent: (event) ->
    @events.push event
    @_trimEvents()
    @_emit 'track', [ event ]
    return

  trackEvent: (eventType, data = {}) ->
    event = @_buildEvent eventType, data
    return null unless event?
    @_storeEvent event
    @_eventsSinceFlush++
    if @_eventsSinceFlush >= @_flushThreshold then @flush() else @_scheduleSave()
    event

  trackBatch: (eventPairs) ->
    return [] unless Array.isArray eventPairs
    results = []
    for pair in eventPairs when Array.isArray(pair) and pair.length > 0
      [type, data] = pair
      event = @_buildEvent type, data ? {}
      if event?
        @_storeEvent event
        results.push event
    if results.length > 0
      @_eventsSinceFlush += results.length
      if @_eventsSinceFlush >= @_flushThreshold then @flush() else @_scheduleSave()
    results

  # ── Domain convenience methods ────────────────────────────────────────────

  trackPlanAction: (action, planId, planData) ->
    unless _isString(action) and action.length > 0
      @logger.warn '[BehaviorAnalytics] trackPlanAction: invalid action'
      return null
    data = { action }
    data.planId   = planId   if _isString planId
    data.planData = planData if _isPlainObject planData
    @trackEvent 'plan_action', data

  trackUIInteraction: (element, action) ->
    data = {}
    data.element = element if _isString element
    data.action  = action  if _isString action
    @trackEvent 'ui_interaction', data

  trackError: (context, err) ->
    @trackEvent 'error',
      context: if _isString(context) then context else 'unknown'
      message: err?.message ? (if err? then String(err) else 'unknown')
      name:    err?.name ? null

  # ── Data management ───────────────────────────────────────────────────────

  clearEvents: ->
    return @ if @_destroyed
    @events = []
    @_eventsSinceFlush = 0
    @_emit 'clear', [ 0 ]
    @_scheduleSave()
    @

  # ── Analytics queries ─────────────────────────────────────────────────────

  getUsageStatistics: (days = DEFAULT_LOOKBACK_DAYS) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_LOOKBACK_DAYS
    cutoff     = @_clock.now() - windowDays * MS_PER_DAY
    sessions   = new Set()
    hourHist   = new Array(HOURS_PER_DAY).fill 0
    totalEvents = planActions = uiInteractions = 0

    for e in @events when e?.time? and e.time >= cutoff
      totalEvents++
      sessions.add e.sessionId if _isString e.sessionId
      hourHist[e.hour]++ if 0 <= e.hour < HOURS_PER_DAY
      switch e.type
        when 'plan_action'    then planActions++
        when 'ui_interaction' then uiInteractions++

    { totalEvents, planActions, uiInteractions, sessions: sessions.size, popularTimes: hourHist }

  getPersonalizedSuggestions: (opts = {}) ->
    suggestions = []
    return suggestions if @events.length is 0

    planThreshold  = if _isNumber(opts.planThreshold)  and opts.planThreshold  > 0 then opts.planThreshold  else DEFAULT_PLAN_THRESHOLD
    completionRate = if _isNumber(opts.completionRate) and 0 < opts.completionRate <= 1 then opts.completionRate else DEFAULT_COMPLETION_RATE

    hourCounts   = new Array(HOURS_PER_DAY).fill 0
    planTotal    = 0
    planComplete = 0

    for e in @events
      hourCounts[e.hour]++ if 0 <= e.hour < HOURS_PER_DAY
      if e.type is 'plan_action' and _isPlainObject(e.data) and _isString(e.data.action)
        planTotal++
        planComplete++ if e.data.action is 'complete'

    maxCount = Math.max ...hourCounts
    if maxCount > 0
      bestHours = (i for count, i in hourCounts when count is maxCount)
      fmtHour = (h) -> String(h).padStart(2, '0') + ':00'
      if bestHours.length > MAX_BEST_HOURS_DISPLAY
        hoursStr = "#{fmtHour bestHours[0]} – #{fmtHour bestHours[bestHours.length - 1]}"
      else
        hoursStr = bestHours.map(fmtHour).join(@i18n.bestTimeOrFmt)
      suggestions.push type: 'best_time', message: @i18n.bestTimeFmt hoursStr

    if planTotal > planThreshold and planComplete / planTotal < completionRate
      suggestions.push type: 'smaller_tasks', message: @i18n.smallerTasks

    suggestions

  getEventTrend: (days = DEFAULT_LOOKBACK_DAYS, eventType = null) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_LOOKBACK_DAYS
    todayMid   = @_localDayKey new Date @_clock.now()
    counts     = new Map()

    for offset in [0...windowDays]
      counts.set todayMid - offset * MS_PER_DAY, 0

    for e in @events when e?.day?
      continue unless counts.has e.day
      continue if eventType? and e.type isnt eventType
      counts.set e.day, counts.get(e.day) + 1

    fmt = (n) -> String(n).padStart 2, '0'
    Array.from(counts.entries())
      .sort (a, b) -> a[0] - b[0]
      .map ([ts, count]) ->
        d = new Date ts
        date: "#{d.getUTCFullYear()}-#{fmt d.getUTCMonth() + 1}-#{fmt d.getUTCDate()}"
        timestamp: ts
        count: count

  detectProductivityDrop: (windowDays = DEFAULT_DROP_WINDOW_DAYS) ->
    windowDays = if _isNumber(windowDays) and windowDays > 0 then Math.floor(windowDays) else DEFAULT_DROP_WINDOW_DAYS
    now       = @_clock.now()
    recentCut = now - windowDays * MS_PER_DAY
    prevCut   = now - 2 * windowDays * MS_PER_DAY
    recent    = previous = 0

    for e in @events when e?.time?
      if e.time >= recentCut    then recent++
      else if e.time >= prevCut then previous++

    baseline = Math.max previous, 1
    ratio    = recent / baseline
    isDrop   = previous > 0 and ratio < 0.5
    { isDrop, recentCount: recent, previousCount: previous, ratio }

  exportEvents: (format = 'json', days) ->
    list = if _isNumber(days) and days > 0
      cutoff = @_clock.now() - Math.floor(days) * MS_PER_DAY
      e for e in @events when e?.time? and e.time >= cutoff
    else
      @events.slice()

    if format is 'csv'
      headers = [ 'id', 'type', 'timestamp', 'time', 'hour', 'day', 'sessionId', 'dataJson' ]
      rows    = [ headers.join ',' ]
      for e in list
        rows.push [
          _csvEscape e.id
          _csvEscape e.type
          _csvEscape e.timestamp
          e.time
          e.hour
          e.day
          _csvEscape e.sessionId ? ''
          _csvEscape _safeStringify(e.data ? {})
        ].join ','
      rows.join '\n'
    else
      _safeStringify list


# ── MusicAnalytics ───────────────────────────────────────────────────────────

class MusicAnalytics

  constructor: (@analytics) ->
    unless @analytics instanceof BehaviorAnalytics
      throw new TypeError 'MusicAnalytics requires a BehaviorAnalytics instance'

  track: (eventKind, payload = null) ->
    unless _isString(eventKind) and eventKind.length > 0
      @analytics.logger.warn '[MusicAnalytics] track: invalid eventKind'
      return null

    eventType = if eventKind.startsWith 'music_' then eventKind else "music_#{eventKind}"
    data = {}

    if _isPlainObject payload
      for k, v of payload when k not in ['track', 'tracks']
        rule = MUSIC_PAYLOAD_SCHEMA[k]
        if rule
          coerced = _coerceField v, rule
          data[k] = coerced if coerced isnt undefined
        else if typeof v in ['string', 'number', 'boolean']
          data[k] = v

      if _isPlainObject payload.track
        trackData = {}
        trackData.id         = payload.track.id         if _isString payload.track.id
        trackData.sourceType = payload.track.sourceType if _isString payload.track.sourceType
        durationSec = _coerceField payload.track.durationSec, 'floorInt'
        trackData.durationSec = durationSec if durationSec?
        data.track = trackData if Object.keys(trackData).length > 0
      else if Array.isArray payload.tracks
        data.totalTracks ?= payload.tracks.length

    @analytics.trackEvent eventType, data

  autoTrack: (player) ->
    unless player? and _isFunction player.on
      @analytics.logger.warn '[MusicAnalytics] autoTrack: no player.on() — skipping'
      return []

    unsubs = []

    wire = (evt, kind, transform) =>
      unsub = player.on evt, (info) =>
        try
          payload = if _isFunction(transform) then transform(info) else null
          @track kind, payload if payload?
        catch err
          @analytics.logger.warn '[MusicAnalytics] handler failed', err?.message
      unsubs.push unsub if _isFunction unsub

    wire 'state', 'play', (s) ->
      if s?.state is 'playing'
        trackId: s.currentTrack?.id, planId: s.currentTrack?.planId, sourceType: s.currentTrack?.sourceType
      else null
    wire 'state', 'pause', (s) ->
      if s?.state is 'paused' then { trackId: s.currentTrack?.id, positionSec: s.positionSec } else null
    wire 'state', 'track_end', (s) ->
      if s?.state is 'ended'  then { trackId: s.currentTrack?.id, positionSec: s.positionSec } else null
    wire 'position', 'seek', (p) ->
      if p? then { positionSec: p.positionSec, durationSec: p.durationSec } else null
    wire 'volume', 'volume', (v) ->
      if v? then { volume: v.volume, isMuted: !!v.isMuted } else null
    wire 'repeat', 'repeat', (r) ->
      if r? then { repeatMode: r.mode } else null
    wire 'track', 'next', (t) ->
      if t? then { trackId: t.id, sourceType: t.sourceType, repeatMode: player.repeatMode } else null
    wire 'queue', 'queue_reorder', ->
      totalTracks: player.queue?.length ? 0

    unsubs


# ── FocusAnalytics ───────────────────────────────────────────────────────────

class FocusAnalytics

  constructor: (@analytics) ->
    unless @analytics instanceof BehaviorAnalytics
      throw new TypeError 'FocusAnalytics requires a BehaviorAnalytics instance'
    @_resetState()

  _resetState: ->
    @_currentSession = null
    @_sessionStart   = null
    @_pauseStart     = null
    @_totalPausedMs  = 0
    @_pauseCount     = 0

  startSession: (sessionType = 'work', plannedDuration = 25, metadata = {}) ->
    @endSession() if @_currentSession?
    return null if @analytics.isDestroyed()

    @_currentSession = sessionType
    @_sessionStart   = @analytics._clock.now()
    @_totalPausedMs  = 0
    @_pauseStart     = null
    @_pauseCount     = 0

    @analytics.trackEvent 'focus_session_start',
      sessionType:        sessionType
      plannedDurationMin: plannedDuration
      metadata:           metadata

  pauseSession: (reason = 'user_pause') ->
    return null unless @_currentSession? and not @_pauseStart?
    return null if @analytics.isDestroyed()

    @_pauseStart = @analytics._clock.now()
    @_pauseCount++

    @analytics.trackEvent 'focus_session_pause',
      sessionType: @_currentSession
      pauseReason: reason
      pauseTime:   @_pauseStart

  resumeSession: ->
    return null unless @_pauseStart?
    return null if @analytics.isDestroyed()

    pauseDuration = @analytics._clock.now() - @_pauseStart
    @_totalPausedMs += pauseDuration
    @_pauseStart = null

    @analytics.trackEvent 'focus_session_resume',
      sessionType:       @_currentSession
      pausedDurationMs:  pauseDuration

  endSession: ->
    return null unless @_currentSession?
    if @analytics.isDestroyed()
      @_resetState()
      return null

    if @_pauseStart?
      @_totalPausedMs += @analytics._clock.now() - @_pauseStart
      @_pauseStart = null

    totalDuration  = @analytics._clock.now() - @_sessionStart
    activeDuration = totalDuration - @_totalPausedMs

    data =
      sessionType:      @_currentSession
      totalDurationMs:  totalDuration
      activeDurationMs: activeDuration
      totalPausedMs:    @_totalPausedMs
      pauseCount:       @_pauseCount

    @analytics.trackEvent 'focus_session_end', data

    @_resetState()
    data

  getFocusStats: (days = DEFAULT_FOCUS_STATS_DAYS) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_FOCUS_STATS_DAYS
    windowMs = windowDays * MS_PER_DAY
    cutoff   = @analytics._clock.now() - windowMs
    sessions = []
    totalFocusTime = 0
    sessionsByType = {}

    for e in @analytics.events when e?.time >= cutoff and e.type is 'focus_session_end'
      duration = e.data?.activeDurationMs ? 0
      totalFocusTime += duration
      type = e.data?.sessionType ? 'unknown'
      sessionsByType[type] ?= 0
      sessionsByType[type] += duration
      sessions.push e

    averageSessionLength = if sessions.length > 0 then totalFocusTime / sessions.length else 0
    {
      totalSessions:         sessions.length
      totalFocusTimeMs:      totalFocusTime
      averageSessionLengthMs: averageSessionLength
      focusByType:           sessionsByType
    }


# ── CollaborationAnalytics ────────────────────────────────────────────────────

class CollaborationAnalytics

  constructor: (@analytics) ->
    unless @analytics instanceof BehaviorAnalytics
      throw new TypeError 'CollaborationAnalytics requires a BehaviorAnalytics instance'

  trackComment: (contentId, contentType, commentLength = 0, isThreadStart = false) ->
    unless _isString(contentId) and contentId.length > 0 and
           _isString(contentType) and contentType.length > 0
      @analytics.logger.warn '[CollaborationAnalytics] trackComment: invalid parameters'
      return null
    @analytics.trackEvent 'collab_comment',
      contentId:      contentId
      contentType:    contentType
      commentLength:  if _isNumber(commentLength) then commentLength else 0
      isThreadStart:  !!isThreadStart

  trackFileShare: (fileId, recipientCount = 0, shareMethod = 'link') ->
    unless _isString(fileId) and fileId.length > 0
      @analytics.logger.warn '[CollaborationAnalytics] trackFileShare: invalid fileId'
      return null
    @analytics.trackEvent 'collab_file_share',
      fileId:         fileId
      recipientCount: if _isNumber(recipientCount) then recipientCount else 0
      shareMethod:    if _isString(shareMethod)    then shareMethod    else 'link'

  trackMeetingParticipation: (meetingId, durationMin = 0, participantCount = 0, chatMessagesSent = 0) ->
    unless _isString(meetingId) and meetingId.length > 0
      @analytics.logger.warn '[CollaborationAnalytics] trackMeetingParticipation: invalid meetingId'
      return null
    @analytics.trackEvent 'collab_meeting_participate',
      meetingId:             meetingId
      attendanceDurationMin: if _isNumber(durationMin)        then durationMin        else 0
      totalParticipants:     if _isNumber(participantCount)   then participantCount   else 0
      chatMessages:          if _isNumber(chatMessagesSent)   then chatMessagesSent   else 0

  getCollaborationScore: (days = DEFAULT_LOOKBACK_DAYS) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_LOOKBACK_DAYS
    windowMs = windowDays * MS_PER_DAY
    cutoff   = @analytics._clock.now() - windowMs
    comments = filesShared = meetingMinutes = 0

    for e in @analytics.events when e?.time >= cutoff
      switch e.type
        when 'collab_comment'             then comments++
        when 'collab_file_share'          then filesShared++
        when 'collab_meeting_participate' then meetingMinutes += e.data?.attendanceDurationMin ? 0

    engagementScore = (comments * 10) + (filesShared * 5) + (meetingMinutes * 0.5)
    { comments, filesShared, totalMeetingMinutes: meetingMinutes, engagementScore }


# ── Exports ──────────────────────────────────────────────────────────────────

BehaviorAnalytics.MusicAnalytics         = MusicAnalytics
BehaviorAnalytics.FocusAnalytics         = FocusAnalytics
BehaviorAnalytics.CollaborationAnalytics = CollaborationAnalytics

if typeof module isnt 'undefined' and module?.exports
  module.exports = BehaviorAnalytics### BehaviorAnalytics — lightweight, privacy-friendly event tracker with
persistence, trend analysis, and event emitter hooks.
###

# ── Helpers ──────────────────────────────────────────────────────────────────

_isString = (v) -> typeof v is 'string'
_isNumber = (v) -> typeof v is 'number' and Number.isFinite(v)
_isFunction = (v) -> typeof v is 'function'
_isPlainObject = (v) ->
  return false unless v? and typeof v is 'object'
  return false if Array.isArray v
  proto = Object.getPrototypeOf v
  proto is null or proto is Object.prototype

MS_PER_DAY  = 86400000
MS_PER_HOUR = 3600000

DEFAULT_MAX_EVENTS       = 1000
DEFAULT_SAVE_DEBOUNCE_MS = 500
DEFAULT_FLUSH_THRESHOLD  = 100
HOURS_PER_DAY            = 24
DEFAULT_LOOKBACK_DAYS    = 7
DEFAULT_DROP_WINDOW_DAYS = 3
DEFAULT_FOCUS_STATS_DAYS = 30
DEFAULT_PLAN_THRESHOLD   = 10
DEFAULT_COMPLETION_RATE  = 0.5
MAX_BEST_HOURS_DISPLAY   = 3

# ── Default event whitelist ──────────────────────────────────────────────────

BASE_EVENT_TYPES = [
  'plan_action', 'ui_interaction', 'focus_mode', 'focus_toggle',
  'task_create', 'task_complete', 'task_update', 'task_delete',
  'session_start', 'session_end', 'command_palette', 'slash_command',
  'notification_shown', 'notification_clicked',
  'habit_complete', 'reminder_triggered',
  'break_start', 'break_end',
  'window_tracking', 'tab_tracking', 'settings_change',
  'template_save', 'template_load',
  'error',
  'music_play', 'music_pause', 'music_next', 'music_previous',
  'music_seek', 'music_volume', 'music_repeat', 'music_shuffle',
  'music_track_end', 'music_preset_apply',
  'music_queue_add', 'music_queue_reorder', 'music_favorite_toggle',
  'music_library_scan', 'music_source_search',
  'music_playlist_create', 'music_playlist_update',
]

EXTENDED_EVENT_TYPES = [
  'focus_session_start', 'focus_session_pause', 'focus_session_resume', 'focus_session_end',
  'collab_comment', 'collab_file_share', 'collab_meeting_participate'
]

DEFAULT_EVENT_TYPES = Object.freeze BASE_EVENT_TYPES.concat(EXTENDED_EVENT_TYPES)

DEFAULT_I18N = Object.freeze
  bestTimeFmt:   (hoursStr) ->
    "You are typically most active around #{hoursStr}; try scheduling important tasks then."
  bestTimeOrFmt: ' or '
  smallerTasks:  'Consider breaking tasks into smaller chunks to improve completion rate.'

# ── Deep clone & sanitize (drops functions/symbols, handles cycles) ──────────

_sanitize = (value, seen = new WeakSet()) ->
  return value if value is null or typeof value isnt 'object'
  return '[Circular]' if seen.has value
  seen.add value
  try
    if Array.isArray value
      out = for item in value
        continue if typeof item is 'function'
        s = _sanitize item, seen
        s unless s is undefined
      seen.delete value
      return out
    if value instanceof Date
      seen.delete value
      return value.toISOString()
    if _isPlainObject value
      out = {}
      for k, v of value
        continue if typeof v is 'function' or typeof k is 'symbol'
        s = _sanitize v, seen
        out[k] = s unless s is undefined
      seen.delete value
      out
    else
      seen.delete value
      String value
  catch
    seen.delete value
    {}

# ── Deep freeze ──────────────────────────────────────────────────────────────

_deepFreeze = (obj) ->
  return obj unless obj? and typeof obj is 'object' and not Object.isFrozen(obj)
  if Array.isArray obj
    _deepFreeze v for v in obj
  else if _isPlainObject obj
    _deepFreeze v for own k, v of obj
  Object.freeze obj

# ── Safe JSON serialization (for export / CSV) ───────────────────────────────

_safeStringify = (obj) ->
  try
    return JSON.stringify obj
  catch
    seen = new WeakSet()
    try
      return JSON.stringify obj, (k, v) ->
        if typeof v is 'object' and v isnt null
          return '[Circular]' if seen.has v
          seen.add v
        v
    catch
      return '{}'

# ── CSV helper (RFC 4180) ───────────────────────────────────────────────────

_csvEscape = (str) ->
  s = if str is null or str is undefined then '' else String(str)
  if /["\n\r,]/.test s then '"' + s.replace(/"/g, '""') + '"' else s

# ── Music payload schema ────────────────────────────────────────────────────

MUSIC_PAYLOAD_SCHEMA =
  trackId:           'string'
  presetId:          'string'
  playlistId:        'string'
  planId:            'string'
  sourceType:        'string'
  repeatMode:        'string'
  volume:            'clamped01'
  shuffle:           'boolean'
  positionSec:       'floorInt'
  durationPlayedSec: 'floorInt'
  toIndex:           'floorInt'
  fromIndex:         'floorInt'
  totalTracks:       'floorInt'
  query:             'string256'

_coerceField = (value, rule) ->
  switch rule
    when 'string'     then if _isString(value) and value.length > 0 then value else undefined
    when 'string256'  then if _isString(value) then value.substring(0, 256) else undefined
    when 'clamped01'  then if _isNumber(value) then Math.max(0, Math.min(1, value)) else undefined
    when 'boolean'    then !!value
    when 'floorInt'
      if _isNumber(value) then Math.floor(value) else undefined
    else undefined

# ── BehaviorAnalytics ────────────────────────────────────────────────────────

class BehaviorAnalytics

  @VERSION       = '2.2.0'
  @MAX_EVENTS    = DEFAULT_MAX_EVENTS
  @SAVE_DEBOUNCE = DEFAULT_SAVE_DEBOUNCE_MS
  @DEFAULT_EVENT_TYPES = DEFAULT_EVENT_TYPES

  VALID_EMITTER_EVENTS = Object.freeze ['track', 'flush', 'clear', 'destroy']

  constructor: (@store = null, opts = {}) ->
    opts = {} unless _isPlainObject opts

    @_clock = if _isPlainObject(opts.clock) and _isFunction(opts.clock.now)
      opts.clock
    else
      { now: -> Date.now() }

    @_maxEvents      = if _isNumber(opts.maxEvents) and opts.maxEvents > 0 then Math.floor opts.maxEvents else DEFAULT_MAX_EVENTS
    @_saveDebounce   = if _isNumber(opts.saveDebounceMs) and opts.saveDebounceMs >= 0 then Math.floor opts.saveDebounceMs else DEFAULT_SAVE_DEBOUNCE_MS
    @_flushThreshold = if _isNumber(opts.flushThreshold) and opts.flushThreshold > 0 then Math.floor opts.flushThreshold else DEFAULT_FLUSH_THRESHOLD

    if @_flushThreshold > @_maxEvents
      @logger?.warn? "[BehaviorAnalytics] flushThreshold exceeds maxEvents; clamping to #{@_maxEvents}."
      @_flushThreshold = @_maxEvents

    @_allowUnknown   = opts.allowUnknownEvents isnt false
    @_freezeEvents   = opts.freezeEvents isnt false

    @logger          = @_resolveLogger opts.logger
    @i18n            = @_buildI18n opts
    @events          = []
    @_eventsSinceFlush = 0
    @currentSession  = @_uniqueId 'session'
    @_idCounter      = 0
    @_saveTimeout    = null
    @_destroyed      = false
    @_listeners      = {}
    @_handlers       = {}
    @_allowedEventTypes = new Set DEFAULT_EVENT_TYPES

    @_loadHistory()
    @_bindLifecycle()

  # ── Public accessors ──────────────────────────────────────────────────────

  isDestroyed: -> @_destroyed
  eventCount:  -> @events.length

  # ── Config helpers ────────────────────────────────────────────────────────

  _resolveLogger: (candidate) ->
    if _isPlainObject(candidate) and
       _isFunction(candidate.debug) and _isFunction(candidate.info) and
       _isFunction(candidate.warn) and _isFunction(candidate.error)
      candidate
    else
      console

  _buildI18n: (opts) ->
    base =
      bestTimeFmt:   DEFAULT_I18N.bestTimeFmt
      bestTimeOrFmt: DEFAULT_I18N.bestTimeOrFmt
      smallerTasks:  DEFAULT_I18N.smallerTasks
    if _isPlainObject opts
      base.bestTimeFmt   = opts.bestTimeMessageFmt  if _isFunction opts.bestTimeMessageFmt
      base.bestTimeOrFmt = opts.bestTimeOrFmt        if _isString  opts.bestTimeOrFmt
      base.smallerTasks  = opts.smallerTasksMessage  if _isString  opts.smallerTasksMessage
    Object.freeze base

  # ── Whitelist management ──────────────────────────────────────────────────

  registerEventType: (type) ->
    unless _isString(type) and type.length > 0
      @logger.warn '[BehaviorAnalytics] registerEventType: invalid type — ignored'
      return false
    return false if @_allowedEventTypes.has type
    @_allowedEventTypes.add type
    true

  listEventTypes: -> Array.from @_allowedEventTypes

  # ── Identity / time ───────────────────────────────────────────────────────

  _uniqueId: (prefix) ->
    @_idCounter++
    "#{prefix}_#{@_clock.now()}_#{@_idCounter}"

  _localHour: (d) -> d.getHours()

  _isoTimestamp: (d) ->
    p = (n, l = 2) -> String(n).padStart l, '0'
    "#{d.getUTCFullYear()}-#{p(d.getUTCMonth() + 1)}-#{p(d.getUTCDate())}" +
    "T#{p(d.getUTCHours())}:#{p(d.getUTCMinutes())}:#{p(d.getUTCSeconds())}" +
    ".#{p(d.getUTCMilliseconds(), 3)}Z"

  _localDayKey: (d) -> Date.UTC d.getFullYear(), d.getMonth(), d.getDate()

  # ── Persistence ───────────────────────────────────────────────────────────

  _loadHistory: ->
    return unless @store? and _isFunction @store.get
    try
      raw = @store.get 'behavioralEvents'
      unless Array.isArray raw then @events = []; return
      @events = raw.filter (e) ->
        _isPlainObject(e) and _isString(e.id) and _isString(e.type) and _isNumber(e.time)
      
      # Backfill `day` for older events loaded from storage
      for e in @events
        e.day ?= @_localDayKey new Date e.time
        
      @_trimEvents()
    catch err
      @logger.warn '[BehaviorAnalytics] Failed to load history.', err?.message
      @events = []

  _trimEvents: ->
    excess = @events.length - @_maxEvents
    @events.splice 0, excess if excess > 0

  flush: ->
    return if @_destroyed
    @_cancelSave()
    @_persist()
    @_eventsSinceFlush = 0
    @_emit 'flush', [ @events.length ]

  _persist: ->
    return unless @store? and _isFunction @store.set
    try
      @store.set 'behavioralEvents', @events
    catch err
      @logger.error '[BehaviorAnalytics] Persist failed.', err?.message

  _scheduleSave: ->
    return unless @store? and _isFunction @store.set
    @_cancelSave()
    @_saveTimeout = setTimeout (=> @_persist()), @_saveDebounce

  _cancelSave: ->
    return unless @_saveTimeout?
    clearTimeout @_saveTimeout
    @_saveTimeout = null

  # ── Emitter ───────────────────────────────────────────────────────────────

  on: (eventName, handler) ->
    unless eventName in VALID_EMITTER_EVENTS
      @logger.warn "[BehaviorAnalytics] on: unknown event '#{eventName}'"
      return ->
    unless _isFunction handler
      @logger.warn '[BehaviorAnalytics] on: handler must be a function'
      return ->
    (@_listeners[eventName] ?= []).push handler
    list    = @_listeners[eventName]
    removed = false
    =>
      return if removed
      removed = true
      idx = list.indexOf handler
      list.splice idx, 1 if idx >= 0

  _emit: (eventName, args = []) ->
    list = @_listeners[eventName]
    return unless list?.length > 0
    snapshot = list.slice()
    for fn in snapshot
      try fn args...
      catch err
        @logger.error "[BehaviorAnalytics] #{eventName} handler threw.", err?.message

  # ── Lifecycle ─────────────────────────────────────────────────────────────

  _bindLifecycle: ->
    @_handlers.flushFn = => @flush()

    if typeof document isnt 'undefined' and typeof window isnt 'undefined'
      @_handlers.onVis = =>
        @flush() if document.visibilityState is 'hidden'
      document.addEventListener 'visibilitychange', @_handlers.onVis
      window.addEventListener 'pagehide',     @_handlers.flushFn
      window.addEventListener 'beforeunload', @_handlers.flushFn
      @_handlers.browser = true

    if typeof process isnt 'undefined' and _isFunction(process.on)
      process.on 'SIGINT',  @_handlers.flushFn
      process.on 'SIGTERM', @_handlers.flushFn
      @_handlers.node = true

  destroy: ->
    return if @_destroyed
    @flush()
    @_emit 'destroy', []

    if @_handlers.browser
      document.removeEventListener 'visibilitychange', @_handlers.onVis
      window.removeEventListener 'pagehide',     @_handlers.flushFn
      window.removeEventListener 'beforeunload', @_handlers.flushFn

    if @_handlers.node
      process.removeListener 'SIGINT',  @_handlers.flushFn
      process.removeListener 'SIGTERM', @_handlers.flushFn

    @_cancelSave()
    @_listeners = {}
    @_handlers  = {}
    @_destroyed = true

  # ── Core tracking ─────────────────────────────────────────────────────────

  _buildEvent: (eventType, data) ->
    if @_destroyed
      @logger.debug '[BehaviorAnalytics] trackEvent after destroy — ignored'
      return null

    unless _isString(eventType) and eventType.length > 0
      @logger.warn '[BehaviorAnalytics] trackEvent: eventType must be a non-empty string'
      return null

    unless @_allowedEventTypes.has eventType
      if @_allowUnknown
        @logger.info "[BehaviorAnalytics] unknown event '#{eventType}' — register it to silence this warning"
      else
        @logger.warn "[BehaviorAnalytics] event '#{eventType}' not in whitelist — rejected"
        return null

    data = {} unless _isPlainObject data
    now  = @_clock.now()
    d    = new Date now

    event =
      id:        @_uniqueId 'evt'
      type:      eventType
      timestamp: @_isoTimestamp d
      time:      now
      hour:      @_localHour d
      day:       @_localDayKey d
      sessionId: @currentSession
      data:      _sanitize data

    _deepFreeze event if @_freezeEvents
    event

  _storeEvent: (event) ->
    @events.push event
    @_trimEvents()
    @_emit 'track', [ event ]
    return

  trackEvent: (eventType, data = {}) ->
    event = @_buildEvent eventType, data
    return null unless event?
    @_storeEvent event
    @_eventsSinceFlush++
    if @_eventsSinceFlush >= @_flushThreshold then @flush() else @_scheduleSave()
    event

  trackBatch: (eventPairs) ->
    return [] unless Array.isArray eventPairs
    results = []
    for pair in eventPairs when Array.isArray(pair) and pair.length > 0
      [type, data] = pair
      event = @_buildEvent type, data ? {}
      if event?
        @_storeEvent event
        results.push event
    if results.length > 0
      @_eventsSinceFlush += results.length
      if @_eventsSinceFlush >= @_flushThreshold then @flush() else @_scheduleSave()
    results

  # ── Domain convenience methods ────────────────────────────────────────────

  trackPlanAction: (action, planId, planData) ->
    unless _isString(action) and action.length > 0
      @logger.warn '[BehaviorAnalytics] trackPlanAction: invalid action'
      return null
    data = { action }
    data.planId   = planId   if _isString planId
    data.planData = planData if _isPlainObject planData
    @trackEvent 'plan_action', data

  trackUIInteraction: (element, action) ->
    data = {}
    data.element = element if _isString element
    data.action  = action  if _isString action
    @trackEvent 'ui_interaction', data

  trackError: (context, err) ->
    @trackEvent 'error',
      context: if _isString(context) then context else 'unknown'
      message: err?.message ? (if err? then String(err) else 'unknown')
      name:    err?.name ? null

  # ── Data management ───────────────────────────────────────────────────────

  clearEvents: ->
    return @ if @_destroyed
    @events = []
    @_eventsSinceFlush = 0
    @_emit 'clear', [ 0 ]
    @_scheduleSave()
    @

  # ── Analytics queries ─────────────────────────────────────────────────────

  getUsageStatistics: (days = DEFAULT_LOOKBACK_DAYS) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_LOOKBACK_DAYS
    cutoff     = @_clock.now() - windowDays * MS_PER_DAY
    sessions   = new Set()
    hourHist   = new Array(HOURS_PER_DAY).fill 0
    totalEvents = planActions = uiInteractions = 0

    for e in @events when e?.time? and e.time >= cutoff
      totalEvents++
      sessions.add e.sessionId if _isString e.sessionId
      hourHist[e.hour]++ if 0 <= e.hour < HOURS_PER_DAY
      switch e.type
        when 'plan_action'    then planActions++
        when 'ui_interaction' then uiInteractions++

    { totalEvents, planActions, uiInteractions, sessions: sessions.size, popularTimes: hourHist }

  getPersonalizedSuggestions: (opts = {}) ->
    suggestions = []
    return suggestions if @events.length is 0

    planThreshold  = if _isNumber(opts.planThreshold)  and opts.planThreshold  > 0 then opts.planThreshold  else DEFAULT_PLAN_THRESHOLD
    completionRate = if _isNumber(opts.completionRate) and 0 < opts.completionRate <= 1 then opts.completionRate else DEFAULT_COMPLETION_RATE

    hourCounts   = new Array(HOURS_PER_DAY).fill 0
    planTotal    = 0
    planComplete = 0

    for e in @events
      hourCounts[e.hour]++ if 0 <= e.hour < HOURS_PER_DAY
      if e.type is 'plan_action' and _isPlainObject(e.data) and _isString(e.data.action)
        planTotal++
        planComplete++ if e.data.action is 'complete'

    maxCount = Math.max ...hourCounts
    if maxCount > 0
      bestHours = (i for count, i in hourCounts when count is maxCount)
      fmtHour = (h) -> String(h).padStart(2, '0') + ':00'
      if bestHours.length > MAX_BEST_HOURS_DISPLAY
        hoursStr = "#{fmtHour bestHours[0]} – #{fmtHour bestHours[bestHours.length - 1]}"
      else
        hoursStr = bestHours.map(fmtHour).join(@i18n.bestTimeOrFmt)
      suggestions.push type: 'best_time', message: @i18n.bestTimeFmt hoursStr

    if planTotal > planThreshold and planComplete / planTotal < completionRate
      suggestions.push type: 'smaller_tasks', message: @i18n.smallerTasks

    suggestions

  getEventTrend: (days = DEFAULT_LOOKBACK_DAYS, eventType = null) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_LOOKBACK_DAYS
    todayMid   = @_localDayKey new Date @_clock.now()
    counts     = new Map()

    for offset in [0...windowDays]
      counts.set todayMid - offset * MS_PER_DAY, 0

    for e in @events when e?.day?
      continue unless counts.has e.day
      continue if eventType? and e.type isnt eventType
      counts.set e.day, counts.get(e.day) + 1

    fmt = (n) -> String(n).padStart 2, '0'
    Array.from(counts.entries())
      .sort (a, b) -> a[0] - b[0]
      .map ([ts, count]) ->
        d = new Date ts
        date: "#{d.getUTCFullYear()}-#{fmt d.getUTCMonth() + 1}-#{fmt d.getUTCDate()}"
        timestamp: ts
        count: count

  detectProductivityDrop: (windowDays = DEFAULT_DROP_WINDOW_DAYS) ->
    windowDays = if _isNumber(windowDays) and windowDays > 0 then Math.floor(windowDays) else DEFAULT_DROP_WINDOW_DAYS
    now       = @_clock.now()
    recentCut = now - windowDays * MS_PER_DAY
    prevCut   = now - 2 * windowDays * MS_PER_DAY
    recent    = previous = 0

    for e in @events when e?.time?
      if e.time >= recentCut    then recent++
      else if e.time >= prevCut then previous++

    baseline = Math.max previous, 1
    ratio    = recent / baseline
    isDrop   = previous > 0 and ratio < 0.5
    { isDrop, recentCount: recent, previousCount: previous, ratio }

  exportEvents: (format = 'json', days) ->
    list = if _isNumber(days) and days > 0
      cutoff = @_clock.now() - Math.floor(days) * MS_PER_DAY
      e for e in @events when e?.time? and e.time >= cutoff
    else
      @events.slice()

    if format is 'csv'
      headers = [ 'id', 'type', 'timestamp', 'time', 'hour', 'day', 'sessionId', 'dataJson' ]
      rows    = [ headers.join ',' ]
      for e in list
        rows.push [
          _csvEscape e.id
          _csvEscape e.type
          _csvEscape e.timestamp
          e.time
          e.hour
          e.day
          _csvEscape e.sessionId ? ''
          _csvEscape _safeStringify(e.data ? {})
        ].join ','
      rows.join '\n'
    else
      _safeStringify list


# ── MusicAnalytics ───────────────────────────────────────────────────────────

class MusicAnalytics

  constructor: (@analytics) ->
    unless @analytics instanceof BehaviorAnalytics
      throw new TypeError 'MusicAnalytics requires a BehaviorAnalytics instance'

  track: (eventKind, payload = null) ->
    unless _isString(eventKind) and eventKind.length > 0
      @analytics.logger.warn '[MusicAnalytics] track: invalid eventKind'
      return null

    eventType = if eventKind.startsWith 'music_' then eventKind else "music_#{eventKind}"
    data = {}

    if _isPlainObject payload
      for k, v of payload when k not in ['track', 'tracks']
        rule = MUSIC_PAYLOAD_SCHEMA[k]
        if rule
          coerced = _coerceField v, rule
          data[k] = coerced if coerced isnt undefined
        else if typeof v in ['string', 'number', 'boolean']
          data[k] = v

      if _isPlainObject payload.track
        trackData = {}
        trackData.id         = payload.track.id         if _isString payload.track.id
        trackData.sourceType = payload.track.sourceType if _isString payload.track.sourceType
        durationSec = _coerceField payload.track.durationSec, 'floorInt'
        trackData.durationSec = durationSec if durationSec?
        data.track = trackData if Object.keys(trackData).length > 0
      else if Array.isArray payload.tracks
        data.totalTracks ?= payload.tracks.length

    @analytics.trackEvent eventType, data

  autoTrack: (player) ->
    unless player? and _isFunction player.on
      @analytics.logger.warn '[MusicAnalytics] autoTrack: no player.on() — skipping'
      return []

    unsubs = []

    wire = (evt, kind, transform) =>
      unsub = player.on evt, (info) =>
        try
          payload = if _isFunction(transform) then transform(info) else null
          @track kind, payload if payload?
        catch err
          @analytics.logger.warn '[MusicAnalytics] handler failed', err?.message
      unsubs.push unsub if _isFunction unsub

    wire 'state', 'play', (s) ->
      if s?.state is 'playing'
        trackId: s.currentTrack?.id, planId: s.currentTrack?.planId, sourceType: s.currentTrack?.sourceType
      else null
    wire 'state', 'pause', (s) ->
      if s?.state is 'paused' then { trackId: s.currentTrack?.id, positionSec: s.positionSec } else null
    wire 'state', 'track_end', (s) ->
      if s?.state is 'ended'  then { trackId: s.currentTrack?.id, positionSec: s.positionSec } else null
    wire 'position', 'seek', (p) ->
      if p? then { positionSec: p.positionSec, durationSec: p.durationSec } else null
    wire 'volume', 'volume', (v) ->
      if v? then { volume: v.volume, isMuted: !!v.isMuted } else null
    wire 'repeat', 'repeat', (r) ->
      if r? then { repeatMode: r.mode } else null
    wire 'track', 'next', (t) ->
      if t? then { trackId: t.id, sourceType: t.sourceType, repeatMode: player.repeatMode } else null
    wire 'queue', 'queue_reorder', ->
      totalTracks: player.queue?.length ? 0

    unsubs


# ── FocusAnalytics ───────────────────────────────────────────────────────────

class FocusAnalytics

  constructor: (@analytics) ->
    unless @analytics instanceof BehaviorAnalytics
      throw new TypeError 'FocusAnalytics requires a BehaviorAnalytics instance'
    @_resetState()

  _resetState: ->
    @_currentSession = null
    @_sessionStart   = null
    @_pauseStart     = null
    @_totalPausedMs  = 0
    @_pauseCount     = 0

  startSession: (sessionType = 'work', plannedDuration = 25, metadata = {}) ->
    @endSession() if @_currentSession?
    return null if @analytics.isDestroyed()

    @_currentSession = sessionType
    @_sessionStart   = @analytics._clock.now()
    @_totalPausedMs  = 0
    @_pauseStart     = null
    @_pauseCount     = 0

    @analytics.trackEvent 'focus_session_start',
      sessionType:        sessionType
      plannedDurationMin: plannedDuration
      metadata:           metadata

  pauseSession: (reason = 'user_pause') ->
    return null unless @_currentSession? and not @_pauseStart?
    return null if @analytics.isDestroyed()

    @_pauseStart = @analytics._clock.now()
    @_pauseCount++

    @analytics.trackEvent 'focus_session_pause',
      sessionType: @_currentSession
      pauseReason: reason
      pauseTime:   @_pauseStart

  resumeSession: ->
    return null unless @_pauseStart?
    return null if @analytics.isDestroyed()

    pauseDuration = @analytics._clock.now() - @_pauseStart
    @_totalPausedMs += pauseDuration
    @_pauseStart = null

    @analytics.trackEvent 'focus_session_resume',
      sessionType:       @_currentSession
      pausedDurationMs:  pauseDuration

  endSession: ->
    return null unless @_currentSession?
    if @analytics.isDestroyed()
      @_resetState()
      return null

    if @_pauseStart?
      @_totalPausedMs += @analytics._clock.now() - @_pauseStart
      @_pauseStart = null

    totalDuration  = @analytics._clock.now() - @_sessionStart
    activeDuration = totalDuration - @_totalPausedMs

    data =
      sessionType:      @_currentSession
      totalDurationMs:  totalDuration
      activeDurationMs: activeDuration
      totalPausedMs:    @_totalPausedMs
      pauseCount:       @_pauseCount

    @analytics.trackEvent 'focus_session_end', data

    @_resetState()
    data

  getFocusStats: (days = DEFAULT_FOCUS_STATS_DAYS) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_FOCUS_STATS_DAYS
    windowMs = windowDays * MS_PER_DAY
    cutoff   = @analytics._clock.now() - windowMs
    sessions = []
    totalFocusTime = 0
    sessionsByType = {}

    for e in @analytics.events when e?.time >= cutoff and e.type is 'focus_session_end'
      duration = e.data?.activeDurationMs ? 0
      totalFocusTime += duration
      type = e.data?.sessionType ? 'unknown'
      sessionsByType[type] ?= 0
      sessionsByType[type] += duration
      sessions.push e

    averageSessionLength = if sessions.length > 0 then totalFocusTime / sessions.length else 0
    {
      totalSessions:         sessions.length
      totalFocusTimeMs:      totalFocusTime
      averageSessionLengthMs: averageSessionLength
      focusByType:           sessionsByType
    }


# ── CollaborationAnalytics ────────────────────────────────────────────────────

class CollaborationAnalytics

  constructor: (@analytics) ->
    unless @analytics instanceof BehaviorAnalytics
      throw new TypeError 'CollaborationAnalytics requires a BehaviorAnalytics instance'

  trackComment: (contentId, contentType, commentLength = 0, isThreadStart = false) ->
    unless _isString(contentId) and contentId.length > 0 and
           _isString(contentType) and contentType.length > 0
      @analytics.logger.warn '[CollaborationAnalytics] trackComment: invalid parameters'
      return null
    @analytics.trackEvent 'collab_comment',
      contentId:      contentId
      contentType:    contentType
      commentLength:  if _isNumber(commentLength) then commentLength else 0
      isThreadStart:  !!isThreadStart

  trackFileShare: (fileId, recipientCount = 0, shareMethod = 'link') ->
    unless _isString(fileId) and fileId.length > 0
      @analytics.logger.warn '[CollaborationAnalytics] trackFileShare: invalid fileId'
      return null
    @analytics.trackEvent 'collab_file_share',
      fileId:         fileId
      recipientCount: if _isNumber(recipientCount) then recipientCount else 0
      shareMethod:    if _isString(shareMethod)    then shareMethod    else 'link'

  trackMeetingParticipation: (meetingId, durationMin = 0, participantCount = 0, chatMessagesSent = 0) ->
    unless _isString(meetingId) and meetingId.length > 0
      @analytics.logger.warn '[CollaborationAnalytics] trackMeetingParticipation: invalid meetingId'
      return null
    @analytics.trackEvent 'collab_meeting_participate',
      meetingId:             meetingId
      attendanceDurationMin: if _isNumber(durationMin)        then durationMin        else 0
      totalParticipants:     if _isNumber(participantCount)   then participantCount   else 0
      chatMessages:          if _isNumber(chatMessagesSent)   then chatMessagesSent   else 0

  getCollaborationScore: (days = DEFAULT_LOOKBACK_DAYS) ->
    windowDays = if _isNumber(days) and days > 0 then Math.floor(days) else DEFAULT_LOOKBACK_DAYS
    windowMs = windowDays * MS_PER_DAY
    cutoff   = @analytics._clock.now() - windowMs
    comments = filesShared = meetingMinutes = 0

    for e in @analytics.events when e?.time >= cutoff
      switch e.type
        when 'collab_comment'             then comments++
        when 'collab_file_share'          then filesShared++
        when 'collab_meeting_participate' then meetingMinutes += e.data?.attendanceDurationMin ? 0

    engagementScore = (comments * 10) + (filesShared * 5) + (meetingMinutes * 0.5)
    { comments, filesShared, totalMeetingMinutes: meetingMinutes, engagementScore }


# ── Exports ──────────────────────────────────────────────────────────────────

BehaviorAnalytics.MusicAnalytics         = MusicAnalytics
BehaviorAnalytics.FocusAnalytics         = FocusAnalytics
BehaviorAnalytics.CollaborationAnalytics = CollaborationAnalytics

if typeof module isnt 'undefined' and module?.exports
  module.exports = BehaviorAnalytics
