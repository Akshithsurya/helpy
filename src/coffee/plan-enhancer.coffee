###
# PlanEnhancer — plan optimization, task decomposition, efficiency scoring,
# and ADHD-friendly productivity helpers.
###

CONST = require './plan-enhancer-constants'
{
  SimpleCache, DEFAULT_MESSAGES, DEFAULTS, WASM_TARGETS, EFFICIENCY_WEIGHTS
  TIP_THRESHOLDS, PRESETS, DEFAULT_FOCUS_PROMPTS, MS_PER_DAY
  MUSIC_PRESETS, MUSIC_GENRES, MUSIC_SOURCE_TYPES, MUSIC_SLASH_FLAGS
  _isNumber, _isPositiveInt, _isPlainObject
} = CONST

# ── Module-level constants (previously magic numbers) ─────────────────
MODULE_CONSTANTS = Object.freeze
  MEMO_MAX_SIZE:    500
  MEMO_EVICT_COUNT: 100
  STREAK_MAX_DAYS:  366
  MICRO_FIRST_MIN:  2   # prioritize-first cap for first micro-task
  CACHE_DEFAULT_MAX_SIZE: 500
  CACHE_DEFAULT_TTL_MS: 300000
  WASM_TIMEOUT_MS:    50
  WASM_COOLDOWN_MS:   30000

# ── Module-level regexes (compiled once) ──────────────────────────────
MODULE_REGEXES = Object.freeze
  EMOJI:      /[\u{1F000}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu
  WHITESPACE: /\s+/g

# ── Module-level preset lookups (built once on load) ──────────────────
PRESET_LOOKUPS = do ->
  # Sort presets by name length descending for matching priority
  sortedPresets = PRESETS.slice().sort (a, b) -> b.name.length - a.name.length
  
  namesSorted = Object.freeze sortedPresets.map (p) -> p.name
  nameLookup  = Object.freeze sortedPresets.reduce ((acc, p) -> acc[p.name] = p; acc), {}
  byDurationBreak = Object.freeze PRESETS.reduce ((acc, p) -> acc["#{p.duration}|#{p.break}"] = p; acc), {})
  regexes = Object.freeze PRESETS.reduce ((acc, p) ->
    acc[p.name] = new RegExp("(^|[^a-z0-9])#{p.name.replace(/_/g, '[_\\s-]?')}([^a-z0-9]|$)", 'i')
    acc
  ), {})

  { namesSorted, nameLookup, byDurationBreak, regexes }

MUSIC_LOOKUPS = do ->
  sortedMusic = MUSIC_PRESETS.slice().sort (a, b) -> b.id.length - a.id.length
  idsSorted   = Object.freeze sortedMusic.map (p) -> p.id
  idLookup    = Object.freeze MUSIC_PRESETS.reduce ((acc, p) -> acc[p.id] = p; acc), {})
  { idsSorted, idLookup }

# ── Shared LRU-bounded map factory (eliminates duplicated cache+evict pairs) ──
createLruMap = (maxSize = MODULE_CONSTANTS.MEMO_MAX_SIZE, evictCount = MODULE_CONSTANTS.MEMO_EVICT_COUNT) ->
  map = new Map()
  {
    get: (key) ->
      return unless map.has(key)
      # Re-insert to mark as recently used (True LRU behavior)
      val = map.get(key)
      map.delete(key)
      map.set(key, val)
      val

    set: (key, val) ->
      map.delete(key) if map.has(key) # Prevent duplicate keys growing the map
      map.set key, val
      if map.size > maxSize
        # Evict oldest entries
        for k in Array.from(map.keys()).slice(0, evictCount)
          map.delete k
      val

    has:   (key)      -> map.has key
    size:             -> map.size
    clear:            -> map.clear(); return
  }

_memoCache  = createLruMap()
_matchCache = createLruMap()

# ── Module-level Wasm circuit breaker ─────────────────────────────────
_wasmState =
  available:      true
  availableUntil: 0

# ── Module-level helpers (reduce repetition across methods) ───────────
StringUtils =
  str: (v, fallback = '') ->
    if typeof v is 'string' and v.length > 0 then v else fallback

  safeStringify: (obj) ->
    try JSON.stringify(obj) catch then String(obj ? '')

TypeUtils =
  optInt: (opts, key, fallback) ->
    if _isPlainObject(opts) and _isPositiveInt(opts[key]) then opts[key] else fallback

  safeOpts: (opts) ->
    if _isPlainObject(opts) then opts else {}

PlanUtils =
  tasksOf: (plan) ->
    if plan?.tasks? and Array.isArray(plan.tasks) then plan.tasks else []

  taskDur: (t) ->
    # Unified duration extractor — checks both `durationMinutes` and `duration`,
    # normalising the inconsistent field naming across the codebase.
    if _isPositiveInt(t?.durationMinutes) then t.durationMinutes
    else if _isPositiveInt(t?.duration) then t.duration
    else 0

  dayKey: (date) ->
    # Reusable day-key formatter for streak calculation.
    "#{date.getUTCFullYear()}-#{String(date.getUTCMonth()).padStart(2, '0')}-#{String(date.getUTCDate()).padStart(2, '0')}"

# Sensory reminder defaults — frozen once, shared across all instances.
SENSORY_DEFAULTS = Object.freeze [
  { id: 'breathing-1',  type: 'breathing',    message: 'Take 3 deep breaths',                      intervalMinutes: 30, enabled: true }
  { id: 'stretch-1',    type: 'stretch',       message: 'Stretch your arms and shoulders',           intervalMinutes: 60, enabled: true }
  { id: 'hydration-1',  type: 'hydration',     message: 'Drink some water',                          intervalMinutes: 90, enabled: true }
  { id: 'sensory-1',    type: 'sensory-break', message: 'Look 20 ft away for 20 seconds (20-20-20)', intervalMinutes: 40, enabled: true }
]

REQUIRED_LOGGER_METHODS = Object.freeze ['debug', 'warn', 'error', 'info']

# ── Main class ────────────────────────────────────────────────────────
class PlanEnhancer

  ### cyrb53: fast deterministic 53-bit string hash (cache keys, checksums). ###
  @cyrb53: (str, seed = 0) ->
    str = if typeof str is 'string' then str else String(str ? '')
    h1 = 0xdeadbeef ^ seed
    h2 = 0x41c6ce57 ^ seed
    for i in [0...str.length]
      ch = str.charCodeAt i
      h1 = Math.imul h1 ^ ch, 2654435761
      h2 = Math.imul h2 ^ ch, 1597334677
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0

  constructor: (@wasmModule = null, opts = {}) ->
    opts = TypeUtils.safeOpts opts
    @_configureLogger opts.logger
    @messages = @_mergeMessages opts.messages
    @cache = new SimpleCache (opts.cacheMaxSize ? MODULE_CONSTANTS.CACHE_DEFAULT_MAX_SIZE), (opts.defaultCacheTtlMs ? MODULE_CONSTANTS.CACHE_DEFAULT_TTL_MS)
    @_activeWasmCalls = 0

  # ── Private setup ─────────────────────────────────────────────────
  _configureLogger: (custom) ->
    if custom? and typeof custom is 'object' and
       REQUIRED_LOGGER_METHODS.every (m) -> typeof custom[m] is 'function'
      @logger = custom
    else
      try
        @logger = require '../../utils/logger'
      catch
        @logger = Object.assign {}, console, {
          debug: -> console.debug?.apply(console, arguments)
          warn:  -> console.warn?.apply(console, arguments)
          error: -> console.error?.apply(console, arguments)
          info:  -> console.info?.apply(console, arguments)
        }

  _mergeMessages: (overrides) ->
    base =
      taskPartFmt:         DEFAULT_MESSAGES.taskPartFmt
      microStepFmt:        DEFAULT_MESSAGES.microStepFmt
      presets:             Object.assign {}, DEFAULT_MESSAGES.presets
      tips:                Object.assign {}, DEFAULT_MESSAGES.tips
      transitionChecklist: Object.assign {}, DEFAULT_MESSAGES.transitionChecklist
      transitionNameFmt:   DEFAULT_MESSAGES.transitionNameFmt
      motivationalQuotes:
        low:    DEFAULT_MESSAGES.motivationalQuotes.low.slice()
        medium: DEFAULT_MESSAGES.motivationalQuotes.medium.slice()
        high:   DEFAULT_MESSAGES.motivationalQuotes.high.slice()

    if _isPlainObject overrides
      base.taskPartFmt       = overrides.taskPartFmt       if typeof overrides.taskPartFmt is 'function'
      base.microStepFmt      = overrides.microStepFmt      if typeof overrides.microStepFmt is 'function'
      base.transitionNameFmt = overrides.transitionNameFmt if typeof overrides.transitionNameFmt is 'function'
      Object.assign base.presets,             overrides.presets             if _isPlainObject overrides.presets
      Object.assign base.tips,                overrides.tips                if _isPlainObject overrides.tips
      Object.assign base.transitionChecklist, overrides.transitionChecklist if _isPlainObject overrides.transitionChecklist
      if _isPlainObject overrides.motivationalQuotes
        for level in ['low', 'medium', 'high'] when Array.isArray overrides.motivationalQuotes[level]
          base.motivationalQuotes[level] = overrides.motivationalQuotes[level].slice()

    Object.freeze base

  # ── Cache helpers ─────────────────────────────────────────────────
  getCacheStats: -> @cache.stats()
  clearCache:   -> @cache.clear(); return

  _cacheAndReturn: (key, value) -> @cache.set(key, value); value

  _cachedOr: (key, fn) ->
    return cached if (cached = @cache.get key)?
    result = fn()
    @cache.set key, result
    result

  # ── Text utilities ────────────────────────────────────────────────
  removeEmojis: (text) ->
    return '' unless typeof text is 'string' and text.length > 0
    cacheKey = "emoji:#{PlanEnhancer.cyrb53 text}"
    @_cachedOr cacheKey, -> text.replace(MODULE_REGEXES.EMOJI, '').replace(MODULE_REGEXES.WHITESPACE, ' ').trim()

  # ── Confidence / plan computation ─────────────────────────────────
  _computeConfidence: (duration, usedWasm, cs, bd) ->
    mk = "conf:#{duration}:#{usedWasm}:#{cs}:#{bd}"
    return cached if (cached = _memoCache.get mk)?
    base = if usedWasm then 0.9 else 0.6
    dF = Math.min 1, duration / 120
    pm = PRESETS.some (p) -> Math.abs(p.duration - cs) <= 5 and Math.abs(p.break - bd) <= 3
    result = Math.min 1, (base + if pm then 0.05 else 0) * (0.7 + 0.3 * dF)
    _memoCache.set mk, result

  _fallbackPlanWith: (cs, bd, reason, confidence) ->
    { chunkSize: cs, breakDuration: bd, optimized: false, reason, confidence }

  generateOptimizedPlan: async (duration, opts = {}) ->
    unless _isPositiveInt duration
      @logger.warn '[PlanEnhancer.generateOptimizedPlan] invalid duration'
      return @_fallbackPlanWith DEFAULTS.chunkSize, DEFAULTS.breakDuration,
        'Invalid duration; using defaults.', 0.3

    opts = TypeUtils.safeOpts opts
    cs = TypeUtils.optInt opts, 'chunkSize',     DEFAULTS.chunkSize
    bd = TypeUtils.optInt opts, 'breakDuration', DEFAULTS.breakDuration

    cacheKey = "plan:#{duration}:#{cs}:#{bd}"

    return cached if (cached = @cache.get cacheKey)?

    now = Date.now()
    if not _wasmState.available and now < _wasmState.availableUntil
      return @_cacheAndReturn cacheKey, @_fallbackPlanWith cs, bd,
        'Wasm cooldown; using pure-JS preset.',
        @_computeConfidence duration, false, cs, bd

    unless @wasmModule? and typeof @wasmModule is 'object'
      return @_cacheAndReturn cacheKey, @_fallbackPlanWith cs, bd,
        'Wasm unavailable; using pure-JS preset.',
        @_computeConfidence duration, false, cs, bd

    try
      { chunkSize: wc, breakDuration: wb } = await @_callWasm duration, cs, bd
      fc = if _isPositiveInt(wc) then wc else cs
      fb = if _isPositiveInt(wb) then wb else bd

      @_cacheAndReturn cacheKey,
        chunkSize: fc, breakDuration: fb, optimized: true,
        reason: 'Computed via Wasm optimizer.',
        confidence: @_computeConfidence duration, true, fc, fb

    catch err
      _wasmState.available = false
      _wasmState.availableUntil = Date.now() + MODULE_CONSTANTS.WASM_COOLDOWN_MS
      @logger.warn '[PlanEnhancer.generateOptimizedPlan] Wasm failed/timeout; fallback + 30s cooldown.', err?.message
      @_cacheAndReturn cacheKey, @_fallbackPlanWith cs, bd,
        'Wasm raised an error or timed out; pure-JS fallback.',
        @_computeConfidence duration, false, cs, bd

  ### Isolated Wasm call with timeout — keeps generateOptimizedPlan clean.
      Uses Promise.race to enforce timeout cleanly without manual timer cleanup. ###
  _callWasm: (duration, cs, bd) ->
    timeoutPromise = new Promise (resolve, reject) ->
      setTimeout (-> reject new Error('Wasm execution timeout')), MODULE_CONSTANTS.WASM_TIMEOUT_MS

    execPromise = new Promise (resolve, reject) =>
      try
        wc = if typeof @wasmModule.optimizeChunkSize is 'function'
          @wasmModule.optimizeChunkSize duration, cs, WASM_TARGETS.focus
        else cs
        wb = if typeof @wasmModule.optimizeBreakDuration is 'function'
          @wasmModule.optimizeBreakDuration wc, WASM_TARGETS.break
        else bd
        resolve { chunkSize: wc, breakDuration: wb }
      catch err
        reject err

    Promise.race [execPromise, timeoutPromise]

  fallbackPlan: (opts = {}) ->
    cs = TypeUtils.optInt opts, 'chunkSize',     DEFAULTS.chunkSize
    bd = TypeUtils.optInt opts, 'breakDuration', DEFAULTS.breakDuration
    { chunkSize: cs, breakDuration: bd, optimized: false }

  # ── Presets ───────────────────────────────────────────────────────
  recommendPreset: (userBehaviorData) ->
    avg = if userBehaviorData? and _isNumber(userBehaviorData.averageSession)
      userBehaviorData.averageSession
    else Infinity
    mk = "rp:#{avg}"
    return cached if (cached = _matchCache.get mk)?

    matched = null
    for name in PRESET_LOOKUPS.namesSorted
      p = PRESET_LOOKUPS.nameLookup[name]
      if avg < p.maxAvg
        matched = p
        break
    result = matched ? PRESET_LOOKUPS.nameLookup[PRESET_LOOKUPS.namesSorted[1]]
    _matchCache.set mk, result

  listPresets: ->
    PRESETS.map (p) ->
      desc = p.description ? @messages.presets[p.name] ? p.name
      Object.assign {}, p, description: desc

  # ── Task decomposition ────────────────────────────────────────────
  decomposeTask: (task, chunkSize = DEFAULTS.chunkSize) ->
    return [] unless _isPlainObject(task) and _isPositiveInt(task.duration)
    cs = if _isPositiveInt(chunkSize) then chunkSize else DEFAULTS.chunkSize
    
    # Safe stringify prevents crashes on circular references
    cacheKey = "decompose:#{PlanEnhancer.cyrb53 StringUtils.safeStringify(task)}:#{cs}"

    @_cachedOr cacheKey, =>
      total = task.duration
      title = StringUtils.str(task.title, 'Task')
      n     = Math.ceil total / cs
      rem   = total % cs

      for i in [0...n]
        d = if i is n - 1 and rem > 0 then rem else cs
        id:       "chunk_#{PlanEnhancer.cyrb53(title + i, Date.now()).toString(36)}_#{i}"
        title:    @messages.taskPartFmt title, i
        duration: d
        completed: false

  # ── Efficiency scoring ────────────────────────────────────────────
  calculateEfficiencyScore: (plan) ->
    tasks = PlanUtils.tasksOf plan
    return 0 unless tasks.length
    completed = tasks.filter (t) -> t?.completed is true
    return 0 unless completed.length

    cr = completed.length / tasks.length
    ot = completed.filter((t) -> t?.completedOnTime is true).length / completed.length
    Math.round (cr * EFFICIENCY_WEIGHTS.completion + ot * EFFICIENCY_WEIGHTS.timeliness) * 100

  generateImprovementTips: (planHistory) ->
    return [] unless Array.isArray(planHistory) and planHistory.length > 0
    total = planHistory.reduce ((acc, p) => acc + @calculateEfficiencyScore p), 0
    avg   = total / (planHistory.length * 100)

    switch
      when avg < TIP_THRESHOLDS.struggling then [@messages.tips.struggling]
      when avg > TIP_THRESHOLDS.excelling  then [@messages.tips.excelling]
      else []

  # ── Progress estimation ───────────────────────────────────────────
  estimatePlanProgress: (plan, elapsedMs) ->
    tasks = PlanUtils.tasksOf plan
    return 0 unless _isNumber(elapsedMs) and elapsedMs >= 0

    totalMs      = tasks.reduce ((sum, t) -> sum + PlanUtils.taskDur(t) * 60000), 0
    return 0 unless totalMs > 0

    completedMs  = tasks.reduce ((sum, t) -> sum + if t?.completed then PlanUtils.taskDur(t) * 60000 else 0), 0
    remainingMs  = totalMs - completedMs
    unaccounted  = Math.max(0, elapsedMs - completedMs)
    progressMs   = completedMs + Math.min(remainingMs, unaccounted)
    Math.min 100, Math.round (progressMs / totalMs) * 100

  # ── Conflict detection ────────────────────────────────────────────
  detectTaskConflicts: (tasks, opts = {}) ->
    tasks = [] unless Array.isArray tasks
    opts  = TypeUtils.safeOpts opts

    total = tasks.reduce ((sum, t) -> sum + PlanUtils.taskDur(t)), 0

    dated = tasks
      .map (t, i) ->
        startTime = new Date(t?.scheduledStart).getTime()
        { t, i, startTime }
      .filter ({startTime}) -> not isNaN(startTime)
      .sort (a, b) -> a.startTime - b.startTime

    overlaps = []
    for i in [0...dated.length]
      { t: a, i: idxA, startTime: aStart } = dated[i]
      aEnd = if a.scheduledEnd?
        new Date(a.scheduledEnd).getTime()
      else
        aStart + PlanUtils.taskDur(a) * 60000

      for j in [(i + 1)...dated.length]
        { startTime: bStart } = dated[j]
        break if bStart >= aEnd
        overlaps.push [idxA, dated[j].i]

    db = TypeUtils.optInt opts, 'dailyBudgetMinutes', null
    { overlaps, overBudget: db? and total > db, totalDuration: total }

  # ── Streak calculation ────────────────────────────────────────────
  calculateStreak: (planHistory) ->
    return { current: 0, longest: 0 } unless Array.isArray planHistory

    days = new Set()
    for p in planHistory when p?.status is 'completed'
      ts = p.completedAt ? p.createdAt
      continue unless ts
      d = new Date ts
      continue if isNaN d.getTime()
      days.add PlanUtils.dayKey d

    today = new Date()
    cur = 0

    for offset in [0...MODULE_CONSTANTS.STREAK_MAX_DAYS]
      key = PlanUtils.dayKey new Date(today.getTime() - offset * MS_PER_DAY)
      if days.has key
        cur++
      else if offset is 0
        continue
      else
        break

    sortedMs = Array.from(days).map (key) ->
      [y, m, d] = key.split('-').map (s) -> parseInt s, 10
      Date.UTC y, m, d
    .sort (a, b) -> a - b

    longest = cur
    run     = 0
    prev    = null

    for ts in sortedMs
      run = if prev? and (ts - prev) is MS_PER_DAY then run + 1 else 1
      longest = run if run > longest
      prev = ts

    { current: cur, longest }

  # ── Motivation ────────────────────────────────────────────────────
  generateMotivationalQuote: (efficiencyScore, salt) ->
    score  = if _isNumber(efficiencyScore) then Math.max(0, Math.min(100, efficiencyScore)) else 50
    bucket = if score < 40 then 'low' else if score < 75 then 'medium' else 'high'
    q = @messages.motivationalQuotes[bucket]
    return 'Keep going — progress takes time.' unless q?.length

    idx = if _isNumber salt
      Math.abs(Math.floor salt) % q.length
    else
      Math.floor Math.random() * q.length
    q[idx]

  # ── Plan merging ──────────────────────────────────────────────────
  mergePlans: (planA, planB) ->
    a = if _isPlainObject planA then planA else {}
    b = if _isPlainObject planB then planB else {}

    m = Object.assign {}, b, a
    m.title = a.title ? b.title ? 'Merged plan'
    m.durationMinutes = 0

    aT = if Array.isArray a.tasks then a.tasks else []
    bT = if Array.isArray b.tasks then b.tasks else []
    seen = new Set()
    m.tasks = []

    for t in aT.concat bT when _isPlainObject t
      id = t.id ? "task_#{PlanEnhancer.cyrb53(t.title ? 'task', seen.size).toString(36)}"
      continue if seen.has id
      seen.add id
      m.durationMinutes += PlanUtils.taskDur t
      m.tasks.push Object.assign {}, t, { id }

    aTg = if Array.isArray a.tags then a.tags.filter((s) -> typeof s is 'string') else []
    bTg = if Array.isArray b.tags then b.tags.filter((s) -> typeof s is 'string') else []
    m.tags = Array.from new Set aTg.concat bTg
    m

  # ── Break suggestions ─────────────────────────────────────────────
  suggestBreakPoint: (plan, progressPct) ->
    tasks = PlanUtils.tasksOf plan
    return null unless tasks.length

    pct = if _isNumber progressPct then Math.max(0, Math.min(100, progressPct)) else 0
    ft  = tasks.filter (t) -> t?.isBreak isnt true
    return null unless ft.length

    tf     = ft.reduce ((sum, t) -> sum + PlanUtils.taskDur(t)), 0
    target = tf * (pct / 100)
    accum  = 0

    for t, i in tasks when t?.isBreak isnt true
      d = PlanUtils.taskDur t
      if accum + d >= target
        return
          taskIndex:       i
          minutesIntoTask: Math.max(0, Math.round(target - accum))
          reason:          'Matches current progress ratio'
      accum += d

    li = tasks.length - 1
    taskIndex:       li
    minutesIntoTask: PlanUtils.taskDur tasks[li]
    reason:          'After final task'

  # ── Micro-task decomposition ──────────────────────────────────────
  decomposeToMicroTasks: (task, maxMinutes = 5, opts = {}) ->
    return [] unless _isPlainObject(task) and _isPositiveInt(task.duration)
    mm   = if _isPositiveInt(maxMinutes) then maxMinutes else 5
    opts = TypeUtils.safeOpts opts
    pf   = opts.prioritizeFirst is true

    total     = task.duration
    title     = StringUtils.str(task.title, 'Task')
    nm        = Math.ceil total / mm
    seed      = PlanEnhancer.cyrb53(title, Date.now()).toString(36)
    mt        = []
    remaining = total

    for i in [0...nm]
      d = if pf and i is 0 then Math.min(MODULE_CONSTANTS.MICRO_FIRST_MIN, remaining) else Math.min mm, remaining
      remaining -= d
      mt.push
        id:       "micro_#{seed}_#{i}"
        title:    @messages.microStepFmt(title, i)
        duration: d
        completed: false
    mt
