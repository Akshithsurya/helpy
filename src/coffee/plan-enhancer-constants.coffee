###
# PlanEnhancer constants, helpers, and SimpleCache.
# Extracted from plan-enhancer.coffee to keep the main module lean.
###

# ── Helpers ------------------------------------------------------------------

isFiniteNumber   = (v) -> typeof v is 'number' and Number.isFinite(v)
isPositiveInt    = (v) -> isFiniteNumber(v) and Number.isInteger(v) and v > 0
isNonNegativeInt = (v) -> isFiniteNumber(v) and Number.isInteger(v) and v >= 0

isPlainObject = (v) ->
  return false unless v? and typeof v is 'object'
  proto = Object.getPrototypeOf(v)
  proto is null or proto is Object.prototype

# Recursively freezes an object and all nested objects/arrays.
# Unlike Object.freeze (shallow), this guarantees deep immutability.
# Children are frozen before their parent (bottom-up) so a failure
# mid-tree doesn't leave a partially-frozen outer shell.
# Circular references are detected and skipped via the `seen` Set
# to prevent infinite recursion.
deepFreeze = (obj, seen) ->
  seen ?= new Set()
  return obj unless obj? and typeof obj is 'object'
  return obj if Object.isFrozen(obj) or seen.has(obj)
  seen.add(obj)
  for own key, val of obj
    deepFreeze(val, seen) if val? and typeof val is 'object'
  Object.freeze(obj)
  obj

###
# Lightweight LRU cache with per-entry TTL.
# Doubly-linked list + Map — zero external dependencies.
#
#   • set / get promote entries to most-recent position (LRU eviction)
#   • peek reads without promotion or stats side-effects
#   • expired entries are lazily evicted on access;
#     call purgeExpired() to proactively remove stale items
#
# Note: set() evicts the LRU tail when full without scanning for expired
# entries first (that would make set O(n)). Call purgeExpired() before
# critical inserts if you need to reclaim stale slots proactively.
###
class SimpleCache
  constructor: (maxSize = 500, defaultTtlMs = 300000) ->
    @maxSize      = if isPositiveInt(maxSize)      then maxSize      else 500
    @defaultTtlMs = if isPositiveInt(defaultTtlMs) then defaultTtlMs else 300000
    @cache     = new Map() # Maps keys to cache nodes for O(1) lookups
    @head      = null      # Most recently used node
    @tail      = null      # Least recently used node
    @hitCount  = 0         # Total cache hits for metrics
    @missCount = 0         # Total cache misses for metrics

  # ── Doubly-linked list primitives ─────────────────────────────────────────

  _removeNode: (node) ->
    # Safely unlinks a node from the linked list, updating head/tail
    { prev, next } = node
    if prev then prev.next = next else @head = next
    if next then next.prev = prev else @tail = prev
    node.prev = node.next = null
    node

  _addToHead: (node) ->
    # Adds a node to the front (MRU position) of the linked list
    node.next = @head
    node.prev = null
    if @head then @head.prev = node
    @head = node
    unless @tail then @tail = node
    node

  _removeTail: ->
    # Removes the LRU node from the tail and deletes it from the cache
    return null unless @tail
    oldTail = @tail
    @cache.delete(oldTail.key)
    @_removeNode(oldTail)
    oldTail

  _promoteToMRU: (node) ->
    # Moves an accessed node to the MRU position to maintain LRU order
    return node if node is @head
    @_removeNode(node)
    @_addToHead(node)

  _evictExpiredNode: (node, key) ->
    # Internal helper to clean up an expired node
    @cache.delete(key)
    @_removeNode(node)

  # ── Public API ────────────────────────────────────────────────────────────

  set: (key, value, ttlMs) ->
    ttl = if isPositiveInt(ttlMs) then ttlMs else @defaultTtlMs
    now = Date.now()
    existingNode = @cache.get(key)

    if existingNode
      # Update existing entry's value and expiration, then refresh LRU position
      existingNode.value     = value
      existingNode.expiresAt = now + ttl
      @_promoteToMRU(existingNode)
    else
      # Evict LRU entry if cache is at capacity before adding new entry
      @_removeTail() if @cache.size >= @maxSize
      newNode = { key, value, expiresAt: now + ttl, prev: null, next: null }
      @cache.set(key, newNode)
      @_addToHead(newNode)
    true

  get: (key) ->
    # Retrieves a value, updates LRU order and hit/miss statistics
    node = @cache.get(key)
    unless node
      @missCount++
      return null
    if Date.now() > node.expiresAt
      @_evictExpiredNode(node, key)
      @missCount++
      return null
    @hitCount++
    @_promoteToMRU(node)
    node.value

  peek: (key) ->
    # Read-only access that doesn't modify LRU order or statistics
    node = @cache.get(key)
    return null unless node
    if Date.now() > node.expiresAt
      @_evictExpiredNode(node, key)
      return null
    node.value

  has: (key) ->
    # Checks for existence of a valid (non-expired) entry
    node = @cache.get(key)
    return false unless node
    if Date.now() > node.expiresAt
      @_evictExpiredNode(node, key)
      return false
    true

  delete: (key) ->
    # Removes a specific entry from the cache
    node = @cache.get(key)
    return false unless node
    @cache.delete(key)
    @_removeNode(node)
    true

  purgeExpired: ->
    # Removes all expired entries from the cache to free up memory
    now = Date.now()
    @cache.forEach (node, key) =>
      if now > node.expiresAt
        @_evictExpiredNode(node, key)
    this

  clear: ->
    # Wipes the entire cache and resets all state and statistics
    @cache.clear()
    @head = @tail = null
    @hitCount = @missCount = 0
    this

  size: -> @cache.size # Returns current number of valid entries in cache

  forEach: (fn) ->
    # Iterates entries from most-recent to least-recent. Does not evict expired entries.
    # Call purgeExpired() first if you only want to process active entries.
    # Safely handles mutations during iteration by pre-capturing next pointers.
    currentNode = @head
    while currentNode
      nextNode = currentNode.next
      fn(currentNode.value, currentNode.key)
      currentNode = nextNode

  entries: ->
    # Returns array of [key, value] pairs ordered MRU → LRU
    result = []
    currentNode = @head
    while currentNode
      result.push [currentNode.key, currentNode.value]
      currentNode = currentNode.next
    result

  keys: ->
    # Returns array of all cache keys ordered MRU → LRU
    result = []
    currentNode = @head
    while currentNode
      result.push currentNode.key
      currentNode = currentNode.next
    result

  values: ->
    # Returns array of all cache values ordered MRU → LRU
    result = []
    currentNode = @head
    while currentNode
      result.push currentNode.value
      currentNode = currentNode.next
    result

  getStats: ->
    # Returns performance metrics including hit rate for monitoring
    totalRequests = @hitCount + @missCount
    hitRate = if totalRequests is 0 then 0 else @hitCount / totalRequests
    { size: @cache.size, hits: @hitCount, misses: @missCount, hitRate }

  resetStats: ->
    # Resets hit/miss counters to zero
    @hitCount = @missCount = 0
    this

# ── Default i18n messages ────────────────────────────────────────────────────

DEFAULT_MESSAGES = deepFreeze
  taskPartFmt:    (title, idx) -> "#{title} - Part #{idx + 1}"
  microStepFmt:   (title, idx) -> "#{title} - Step #{idx + 1}"
  presets:
    micro:      'Micro session'
    pomodoro:   'Pomodoro'
    sprint:     'Sprint mode'
    deep_work:  'Deep work'
  tips:
    struggling: 'Consider shortening your focus chunks — 20–25 minutes may better match your attention span.'
    excelling:  'Great progress! Try extending your focus blocks slightly for deeper work.'
  transitionChecklist:
    saveWork:           'Save current work'
    closeTabs:          'Close unnecessary tabs'
    gatherMaterials:    'Gather materials for next task'
    shortBreak:         'Take a 30-second break'
  transitionNameFmt: (from, to) -> "Transition: #{from} → #{to}"
  motivationalQuotes:
    low: [
      'Every expert was once a beginner. One small step is enough.'
      'Progress beats perfection. Start with the easiest part.'
      'Slow and steady wins the race.'
    ]
    medium: [
      'You are making progress. Keep going.'
      'Consistency builds momentum.'
      'Great work — keep the momentum alive.'
    ]
    high: [
      'Outstanding! You are in the zone.'
      'Fantastic rhythm — keep the streak alive!'
      'Top-tier performance. Excellent work!'
    ]

# ── Scheduling constants ─────────────────────────────────────────────────────

DEFAULTS = deepFreeze
  chunkSize:     25
  breakDuration: 5

WASM_TARGETS = deepFreeze
  focus: 20
  break: 70

EFFICIENCY_WEIGHTS = deepFreeze
  completion:   0.7
  timeliness:   0.3

TIP_THRESHOLDS = deepFreeze
  struggling: 0.5
  excelling:  0.9

# FIX: PRESETS contains nested objects — Object.freeze only freezes the array
# shell, leaving each preset object mutable. deepFreeze freezes recursively.
PRESETS = deepFreeze [
  { name: 'micro',     duration: 15, break: 3,  description: null, maxAvg: 20 }
  { name: 'pomodoro',  duration: 25, break: 5,  description: null, maxAvg: 45 }
  { name: 'sprint',    duration: 50, break: 10, description: null, maxAvg: 80 }
  { name: 'deep_work', duration: 90, break: 20, description: null, maxAvg: Infinity }
]

DEFAULT_FOCUS_PROMPTS = deepFreeze [
  'Take a 10-second pause and notice your breath.'
  'What is one tiny step you can take right now?'
  'Remember the goal of this session.'
  'Take one deep breath and gently refocus.'
  'Silently name three things that can wait until later.'
]

MS_PER_DAY = 86400000 # Milliseconds in one full day (24 * 60 * 60 * 1000)

# ── Music constants (mirrors PHP PlanParser + MusicService) ──────────────────

MUSIC_PRESETS = deepFreeze [
  { id: 'lofi-focus',      title: 'Lo-fi Focus Session',       duration: 90,  goal: 'Ambient focus',   musicPreset: 'lofi',     genre: 'ambient',     source: 'all' }
  { id: 'classical-study', title: 'Classical Study Session',    duration: 60,  goal: 'Deep study',     musicPreset: 'classical', genre: 'classical',  source: 'all' }
  { id: 'white-noise',     title: 'White Noise Session',        duration: 120, goal: 'Noise isolation', musicPreset: 'noise',    genre: 'noise',       source: 'local' }
  { id: 'binaural',        title: 'Binaural Focus Session',     duration: 45,  goal: 'Binaural focus',  musicPreset: 'binaural', genre: 'binaural',   source: 'local' }
  { id: 'ambient-code',    title: 'Ambient Coding Session',     duration: 120, goal: 'Flow coding',    musicPreset: 'ambient',  genre: 'electronic',  source: 'all' }
  { id: 'energize',        title: 'Energize Sprint',            duration: 25,  goal: 'Upbeat energy',  musicPreset: 'upbeat',   genre: 'electronic',  source: 'all' }
]

MUSIC_GENRES = deepFreeze [
  'ambient', 'classical', 'noise', 'binaural', 'electronic', 'lofi',
  'jazz', 'instrumental', 'soundtrack', 'blues', 'folk', 'rock', 'pop'
]

MUSIC_SOURCE_TYPES = deepFreeze [ 'local', 'youtube', 'spotify', 'soundcloud', 'all' ]

MUSIC_SLASH_FLAGS = deepFreeze [
  { flag: '--music',    valueHint: '<preset>',    values: (MUSIC_PRESETS.map (p) -> p.id),          description: 'Apply a music focus preset' }
  { flag: '--playlist', valueHint: '<playlistId>', values: null,                                      description: 'Attach a playlist by ID' }
  { flag: '--source',   valueHint: '<source>',    values: MUSIC_SOURCE_TYPES.slice(0, -1),          description: 'Restrict sources' }
  { flag: '--genre',    valueHint: '<genre>',     values: MUSIC_GENRES.slice(),                     description: 'Filter by genre' }
]

# ── Exports ──────────────────────────────────────────────────────────────────

module.exports =
  # Core classes
  SimpleCache: SimpleCache

  # Shared constants
  DEFAULT_MESSAGES: DEFAULT_MESSAGES
  DEFAULTS: DEFAULTS
  WASM_TARGETS: WASM_TARGETS
  EFFICIENCY_WEIGHTS: EFFICIENCY_WEIGHTS
  TIP_THRESHOLDS: TIP_THRESHOLDS
  PRESETS: PRESETS
  DEFAULT_FOCUS_PROMPTS: DEFAULT_FOCUS_PROMPTS
  MS_PER_DAY: MS_PER_DAY

  # Music-related constants
  MUSIC_PRESETS: MUSIC_PRESETS
  MUSIC_GENRES: MUSIC_GENRES
  MUSIC_SOURCE_TYPES: MUSIC_SOURCE_TYPES
  MUSIC_SLASH_FLAGS: MUSIC_SLASH_FLAGS

  # Internal utilities (exposed for testing/consumption)
  isFiniteNumber: isFiniteNumber
  isPositiveInt: isPositiveInt
  isNonNegativeInt: isNonNegativeInt
  isPlainObject: isPlainObject
  deepFreeze: deepFreeze
