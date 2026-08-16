###
# Music UI bindings — client-side interactivity.
#
# Features:
#   1. Pluggable keyboard shortcuts (default opt-in via MusicShortcuts#bind)
#   2. Command-palette autocomplete — debounced, LRU-cached
#   3. HTML5 drag/drop queue reordering
#   4. Click/tap-to-seek progress bar (pointer events + arrow-key seeking)
#   5. Lightweight data-tooltip helper (hover/focus)
#
# All public bind() methods return a cleanup function (or null on failure).
###

CONST = require './plan-enhancer-constants'
{ SimpleCache, _isNumber, _isPositiveInt, _isPlainObject } = CONST

MUSIC   = require './music-player'
{ MusicPlayer, REPEAT } = MUSIC

ADAPTERS = require './music-source-adapters'

# --- Internal helpers ----------------------------------------------------
# Guarded type checks with null/undefined safety
_isString = (v) -> typeof v is 'string'
_isArray  = Array.isArray
_isFn     = (v) -> typeof v is 'function'

# Robust node detection supporting browser DOM and SSR environments
_isNode = (v) ->
  return false unless v?
  # Standard browser HTMLElement check
  if typeof window isnt 'undefined' and window.HTMLElement?
    return v instanceof window.HTMLElement
  # Fallback for node-like event targets (Document, ShadowDOM, SSR mocks)
  typeof v is 'object' and typeof v.addEventListener is 'function' and typeof v.removeEventListener is 'function'

# Range clamping with type safety
_clamp = (v, lo, hi) ->
  v = Number(v) ? lo
  Math.max(lo, Math.min(hi, v))

# Enhanced string sanitization with XSS protection stripping
_cleanStr = (v) ->
  return '' unless _isString(v)
  v.replace(/\s+/g, ' ')
   .replace(/[<>]/g, '') # Strip potential HTML injection
   .trim()

# Safe event binding with error handling and guaranteed cleanup
_bindEvent = (el, ev, fn, opts = false) ->
  return null unless _isNode(el) and _isString(ev) and _isFn(fn)
  try
    el.addEventListener(ev, fn, opts)
    ->
      try el.removeEventListener(ev, fn, opts)
      return
  catch err
    console?.warn? '[_bindEvent] Failed to attach event listener', err?.message
    null

# Production-grade debounce with proper this binding and edge case handling
_debounce = (fn, waitMs = 200, opts = {}) ->
  timer    = null
  lastArgs = null
  lastThis = null
  result   = undefined
  leading  = !!opts.leading
  trailing = opts.trailing ? true

  invoke = ->
    result   = fn.apply(lastThis, lastArgs ? [])
    lastArgs = null
    lastThis = null
    result

  clear = ->
    clearTimeout(timer) if timer?
    timer    = null
    lastArgs = null
    lastThis = null
    return

  debounced = (args...) ->
    lastThis = @
    lastArgs = args
    hadTimer = timer?
    clearTimeout(timer) if timer?
    timer = setTimeout ->
      timer = null
      invoke() if trailing and lastArgs?
      return
    , waitMs
    if leading and not hadTimer
      result = invoke()
    result

  debounced.cancel = clear
  debounced.flush  = ->
    if timer? and lastArgs? then invoke()
    clear()
    result
  debounced

# --- Constants -----------------------------------------------------------
# Centralized configuration with immutability
SEEK_CONFIG = Object.freeze
  STEP_SEC:        5
  VOLUME_STEP:     0.1
  VOLUME_MIN:      0
  VOLUME_MAX:      1
  INPUT_BLOCKLIST: new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'])
  VOLUME_ALLOWED:  new Set(['volumeUp', 'volumeDown'])

# Extensible shortcut schema with metadata for UI generation
SHORTCUTS = Object.freeze [
  { keys: ['Space'],                  action: 'toggle',     description: 'Play / Pause',         category: 'playback' }
  { keys: ['Ctrl+ArrowRight', 'N'],   action: 'next',       description: 'Next track',          category: 'playback' }
  { keys: ['Ctrl+ArrowLeft',  'P'],   action: 'previous',   description: 'Previous track',      category: 'playback' }
  { keys: ['M'],                      action: 'mute',       description: 'Mute toggle',         category: 'volume' }
  { keys: ['S'],                      action: 'shuffle',    description: 'Shuffle toggle',      category: 'queue' }
  { keys: ['R'],                      action: 'repeat',     description: 'Cycle repeat mode',   category: 'queue' }
  { keys: ['+', '='],                 action: 'volumeUp',   description: 'Volume up',           category: 'volume' }
  { keys: ['-', '_'],                 action: 'volumeDown', description: 'Volume down',         category: 'volume' }
  { keys: ['J'],                      action: 'seekBack',   description: "Seek back #{SEEK_CONFIG.STEP_SEC}s", category: 'playback' }
  { keys: ['K'],                      action: 'seekFwd',    description: "Seek forward #{SEEK_CONFIG.STEP_SEC}s", category: 'playback' }
]

# --- MusicShortcuts ------------------------------------------------------
class MusicShortcuts
  constructor: (@player, opts = {}) ->
    unless @player instanceof MusicPlayer
      throw new TypeError('MusicShortcuts requires a valid MusicPlayer instance')
    
    @scope          = opts.scope ? 'global'
    @target         = @_resolveTarget(opts.target)
    @customHandler  = if _isFn(opts.customActionHandler) then opts.customActionHandler else null
    @keyMap         = @_buildKeyMap(opts.overrides ? {})
    @_cleanup       = null
    @_boundHandler  = null

  # Resolve event target with SSR safety
  _resolveTarget: (customTarget) ->
    return customTarget if _isNode(customTarget)
    if typeof document isnt 'undefined' then document else null

  # Merge default and custom shortcuts with deduplication
  _buildKeyMap: (overrides) ->
    entries = SHORTCUTS.slice()
    if _isPlainObject(overrides)
      merged = []
      seen = new Set()
      for name, def of overrides when _isPlainObject(def) and _isArray(def.keys)
        merged.push
          keys:        def.keys.slice()
          action:      name
          description: if _isString(def.description) then def.description else name
          category:    def.category ? 'custom'
        seen.add(name)
      entries = entries.filter((s) -> not seen.has(s.action)).concat(merged)
    
    map = new Map()
    for s in entries
      for k in s.keys
        norm = @_normalizeKey(k)
        map.set(norm, Object.freeze(s)) if norm?
    map

  # Standardize key combination format for cross-browser compatibility
  _normalizeKey: (raw) ->
    return null unless _isString(raw) and raw.length > 0
    ctrl = alt = shift = meta = false
    key = ''
    for p in raw.split('+').map((x) -> x.trim()).filter((x) -> x.length)
      switch p.toLowerCase()
        when 'ctrl'  then ctrl  = true
        when 'alt'   then alt   = true
        when 'shift' then shift = true
        when 'meta'  then meta  = true
        else key = p
    key = ' ' if key.toLowerCase() is 'space'
    Object.freeze { ctrl, alt, shift, meta, key }

  # Match keyboard events against normalized key bindings
  _eventMatches: (e, norm) ->
    norm.ctrl  is !!e.ctrlKey  and
    norm.alt   is !!e.altKey   and
    norm.shift is !!e.shiftKey and
    norm.meta  is !!e.metaKey  and
    String(e.key ? '').toLowerCase() is norm.key.toLowerCase()

  # Find matching shortcut for incoming event
  _findBinding: (e) ->
    for [norm, def] from @keyMap
      return def if @_eventMatches(e, norm)
    null

  # Dispatch shortcut action with error handling
  _dispatch: (e, def) ->
    handled = false
    try
      if @customHandler? and @customHandler(def.action, e, @player) is true
        handled = true
      handled = @_invokeAction(def.action) unless handled
    catch err
      console?.warn? '[MusicShortcuts] Dispatch failed', def.action, err?.message
    if handled
      e.preventDefault()
      e.stopPropagation()
    handled

  # Execute core player actions
  _invokeAction: (action) ->
    p = @player
    switch action
      when 'toggle'   then p.toggle(); true
      when 'next'     then p.next(); true
      when 'previous' then p.previous(); true
      when 'mute'     then p.muteToggle(); true
      when 'shuffle'  then p.setShuffle(not p.shuffle); true
      when 'repeat'
        nextMode = switch p.repeatMode
          when REPEAT.OFF then REPEAT.ALL
          when REPEAT.ALL then REPEAT.ONE
          else REPEAT.OFF
        p.setRepeat(nextMode); true
      when 'volumeUp'
        step = p.VOLUME_STEP ? SEEK_CONFIG.VOLUME_STEP
        p.setVolume(_clamp(p.volume + step, SEEK_CONFIG.VOLUME_MIN, SEEK_CONFIG.VOLUME_MAX)); true
      when 'volumeDown'
        step = p.VOLUME_STEP ? SEEK_CONFIG.VOLUME_STEP
        p.setVolume(_clamp(p.volume - step, SEEK_CONFIG.VOLUME_MIN, SEEK_CONFIG.VOLUME_MAX)); true
      when 'seekBack'
        p.seek(Math.max(0, p.positionSec - SEEK_CONFIG.STEP_SEC)); true
      when 'seekFwd'
        dur = @_getSafeDuration()
        p.seek(_clamp(p.positionSec + SEEK_CONFIG.STEP_SEC, 0, dur)); true
      else false

  # Safely retrieve track duration from multiple player interfaces
  _getSafeDuration: ->
    if _isFn(@player.getDuration)
      d = @player.getDuration()
      return d if _isNumber(d) and d > 0
    try
      audio = @player._audio
      if audio?.duration and Number.isFinite(Number(audio.duration))
        return Number(audio.duration)
    Math.max(0, Number(@player.currentTrack?.durationSec ? 0))

  # Bind keyboard event listeners
  bind: ->
    return @_cleanup if @_cleanup?
    return null unless @target?

    @_boundHandler = (e) =>
      def = @_findBinding(e)
      return unless def?
      # Block shortcuts when typing in inputs, except volume controls
      tagName = String(e.target?.tagName ? '').toUpperCase()
      return if SEEK_CONFIG.INPUT_BLOCKLIST.has(tagName) and not SEEK_CONFIG.VOLUME_ALLOWED.has(def.action)
      @_dispatch(e, def)

    cleanup = _bindEvent(@target, 'keydown', @_boundHandler, false)
    return null unless cleanup?

    @_cleanup = ->
      cleanup()
      @_boundHandler = null
      @_cleanup = null
      return
    @_cleanup

  # List unique bindings for UI display
  listBindings: ->
    uniq = new Map()
    for [_, def] from @keyMap
      uniq.set(def.action, Object.assign({}, def))
    Array.from(uniq.values())

# --- MusicAutocomplete ---------------------------------------------------
class MusicAutocomplete
  @DEFAULT_PRESETS: Object.freeze [
    { id: 'lofi-focus',      type: 'preset', label: 'Lo-fi Focus',         genre: 'ambient' }
    { id: 'classical-study', type: 'preset', label: 'Classical Study',     genre: 'classical' }
    { id: 'white-noise',     type: 'preset', label: 'White Noise Session', genre: 'noise' }
    { id: 'binaural',        type: 'preset', label: 'Binaural Focus',      genre: 'binaural' }
    { id: 'ambient-code',    type: 'preset', label: 'Ambient Coding',      genre: 'electronic' }
    { id: 'energize',        type: 'preset', label: 'Energize Sprint',     genre: 'electronic' }
  ]

  @DEFAULT_GENRES: Object.freeze [
    'ambient', 'classical', 'noise', 'binaural', 'electronic', 'lofi',
    'jazz', 'instrumental', 'soundtrack', 'blues', 'folk', 'rock', 'pop'
  ]

  constructor: (opts = {}) ->
    @searchFn          = if _isFn(opts.searchFn) then opts.searchFn else null
    @extraPresets      = if _isArray(opts.presets) then opts.presets.filter(_isPlainObject) else []
    @extraGenres       = if _isArray(opts.genres)  then opts.genres.filter(_isString)       else []
    @maxCacheSize      = if _isPositiveInt(opts.cacheSize) then opts.cacheSize else 200
    @cacheTTL          = if _isPositiveInt(opts.cacheTTL) then opts.cacheTTL else 180000
    @cache             = new SimpleCache(@maxCacheSize, @cacheTTL)
    @debounceWait      = if _isPositiveInt(opts.waitMs) then opts.waitMs else 220
    @maxStaticResults  = if _isPositiveInt(opts.maxStatic) then opts.maxStatic else 20
    @maxRemoteResults  = if _isPositiveInt(opts.maxRemote) then opts.maxRemote else 50
    @_abortController  = null # Modern AbortController replacement for token system
    @debouncedSearch   = _debounce(@_executeSearch.bind(@), @debounceWait, trailing: true, leading: false)

  # Get merged preset list
  listPresets: -> MusicAutocomplete.DEFAULT_PRESETS.concat(@extraPresets)

  # Get merged unique genre list
  listGenres: ->
    genreSet = new Set(MusicAutocomplete.DEFAULT_GENRES)
    genreSet.add(g) for g in @extraGenres when _isString(g) and g.length > 0
    Array.from(genreSet)

  # Get suggestions with stale request prevention
  suggest: (text, onResult) ->
    return unless _isFn(onResult)
    # Abort any in-flight requests
    @_abortController?.abort()
    @_abortController = new AbortController()
    signal = @_abortController.signal

    t = _cleanStr(text)
    staticItems = if t.length is 0 then @listPresets().slice(0, 6) else @_getStaticMatches(t)
    onResult({ source: 'static', items: staticItems, signal })

    if t.length > 0
      @debouncedSearch(t, (res) =>
        return if signal.aborted
        onResult(res)
      )

    { cancel: @debouncedSearch.cancel, abort: => @_abortController?.abort() }

  # Find matching static presets and genres
  _getStaticMatches: (t) ->
    needle = t.toLowerCase()
    results = []
    # Match presets
    for p in @listPresets()
      haystack = "#{p.label} #{p.id} #{p.genre ? ''}".toLowerCase()
      results.push(p) if haystack.includes(needle)
    # Match genres
    for g in @listGenres() when g.toLowerCase().includes(needle)
      results.push { id: g, type: 'genre', label: "Genre: #{g}", genre: g }
    results.slice(0, @maxStaticResults)

  # Execute remote search with caching
  _executeSearch: (t, cb) ->
    t = _cleanStr(t)
    return if t.length is 0
    cacheKey = "ac:#{t.toLowerCase()}"
    # Return cached results if available
    if (cached = @cache.get(cacheKey))?
      try cb({ source: 'cached', items: cached })
      return
    # Process new search results
    done = (items) =>
      safeItems = (if _isArray(items) then items else []).filter(_isPlainObject).slice(0, @maxRemoteResults)
      @cache.set(cacheKey, safeItems)
      try cb({ source: 'remote', items: safeItems })
      return
    # Execute search if function exists
    if _isFn(@searchFn)
      try
        promise = @searchFn(t)
        if promise?.then?
          promise.then(done).catch(-> done([]))
        else if _isArray(promise) then done(promise)
        else done([])
      catch
        done([])
    else
      done([])

# --- QueueDragDrop -------------------------------------------------------
class QueueDragDrop
  constructor: (@player, opts = {}) ->
    unless @player instanceof MusicPlayer
      throw new TypeError('QueueDragDrop requires valid MusicPlayer instance')
    @listEl       = if _isNode(opts.listEl) then opts.listEl else null
    @itemSelector = if _isString(opts.itemSelector) and opts.itemSelector.length
      opts.itemSelector
    else
      '[data-track-index]'
    @_cleanup     = null
    @_dragState   = null

  # Bind drag and drop event listeners
  bind: ->
    return @_cleanup if @_cleanup?
    return null unless @listEl?

    @_dragState = { draggingIndex: null, hoverIndex: null }

    onDragStart = (e) =>
      idx = @_getIndexFromEvent(e)
      unless idx?
        e.preventDefault()
        return
      @_dragState.draggingIndex = idx
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      e.target?.classList.add('music-dragging')
      return

    onDragEnd = (e) =>
      e.target?.classList.remove('music-dragging')
      @_clearHoverStates()
      @_dragState = { draggingIndex: null, hoverIndex: null }
      return

    onDragOver = (e) =>
      e.preventDefault()
      idx = @_getIndexFromEvent(e)
      if idx? and idx isnt @_dragState.hoverIndex
        @_setDropTarget(idx)
        @_dragState.hoverIndex = idx
      e.dataTransfer.dropEffect = 'move'
      false

    onDrop = (e) =>
      e.preventDefault()
      fromIdx = @_dragState.draggingIndex
      fromIdx ?= parseInt(String(e.dataTransfer?.getData('text/plain') ? '-1'), 10)
      toIdx   = @_getIndexFromEvent(e)
      # Validate indices and execute reorder
      if Number.isFinite(fromIdx) and Number.isFinite(toIdx) and
         fromIdx isnt toIdx and fromIdx >= 0 and toIdx >= 0
        @player.reorderQueue(fromIdx, toIdx)
        @player.emit?.('queueReordered', { from: fromIdx, to: toIdx })
      @_clearHoverStates()
      @_dragState = { draggingIndex: null, hoverIndex: null }
      false

    # Aggregate cleanup functions
    cleanups = [
      _bindEvent(@listEl, 'dragstart', onDragStart, false)
      _bindEvent(@listEl, 'dragend',   onDragEnd,   false)
      _bindEvent(@listEl, 'dragover',  onDragOver,  false)
      _bindEvent(@listEl, 'drop',      onDrop,      false)
    ]

    if null in cleanups
      c?() for c in cleanups
      return null

    @_cleanup = ->
      c?() for c in cleanups
      @_clearHoverStates()
      @_dragState = null
      @_cleanup = null
      return
    @_cleanup

  # Extract track index from event target
  _getIndexFromEvent: (e) ->
    node = e.target
    while node?
      if (idxStr = node.getAttribute?.('data-track-index'))?
        idx = parseInt(idxStr, 10)
        return idx if Number.isFinite(idx) and idx >= 0
      node = node.parentElement
    null

  # Set visual drop target state
  _setDropTarget: (idx) ->
    return unless @listEl?
    @_clearHoverStates()
    items = @listEl.querySelectorAll(@itemSelector)
    items[idx]?.classList.add('music-drop-target') if idx < items.length
    return

  # Reset all drag visual states
  _clearHoverStates: ->
    return unless @listEl?
    try
      for el in @listEl.querySelectorAll('.music-drop-target, .music-dragging')
        el.classList.remove('music-drop-target', 'music-dragging')
    return

# --- ProgressSeek --------------------------------------------------------
class ProgressSeek
  constructor: (@player, opts = {}) ->
    unless @player instanceof MusicPlayer
      throw new TypeError('ProgressSeek requires valid MusicPlayer instance')
    @trackEl         = if _isNode(opts.trackEl) then opts.trackEl else null
    @fillEl          = if _isNode(opts.fillEl)  then opts.fillEl  else null
    @bufferEl        = if _isNode(opts.bufferEl) then opts.bufferEl else null
    @renderThrottle  = if _isPositiveInt(opts.renderDelay) then opts.renderDelay else 50
    @debouncedRender = _debounce(@_updateUI.bind(@), @renderThrottle, trailing: true)
    @_cleanup        = null
    @_playerCleanups = []

  # Bind progress bar interactions
  bind: ->
    return @_cleanup if @_cleanup?
    return null unless @trackEl?
    # Make focusable for keyboard navigation
    @trackEl.setAttribute('tabindex', '0') unless @trackEl.getAttribute('tabindex')?

    # Pointer interaction handler
    onPointerDown = (e) =>
      return unless @trackEl?
      @_seekFromPointerEvent(e)
      @_updateUI()
      return

    # Keyboard seek handler
    onKeyDown = (e) =>
      switch e.key
        when 'ArrowLeft'
          @player.seek(Math.max(0, @player.positionSec - SEEK_CONFIG.STEP_SEC))
          e.preventDefault()
        when 'ArrowRight'
          dur = @_getCurrentDuration()
          @player.seek(_clamp(@player.positionSec + SEEK_CONFIG.STEP_SEC, 0, dur))
          e.preventDefault()
      return

    # Player event handlers
    onPositionUpdate = (info) => @debouncedRender(info); return
    onTrackChange    = => @_updateUI(); return
    onStateChange    = => @_updateUI(); return
    onBufferUpdate   = => @_updateUI(); return

    # Aggregate DOM event cleanups
    cleanups = [
      _bindEvent(@trackEl, 'pointerdown', onPointerDown, false)
      _bindEvent(@trackEl, 'keydown',     onKeyDown,     false)
      _bindEvent(@trackEl, 'click',       ((e) -> e.preventDefault(); return), false)
    ]

    # Attach player event listeners
    try
      @player.on('position', onPositionUpdate)
      @player.on('track',    onTrackChange)
      @player.on('state',    onStateChange)
      @player.on('buffer',   onBufferUpdate) if @player.addEventListener?
      # Register player cleanup functions
      @_playerCleanups.push => @player.off('position', onPositionUpdate)
      @_playerCleanups.push => @player.off('track',    onTrackChange)
      @_playerCleanups.push => @player.off('state',    onStateChange)
      @_playerCleanups.push => @player.off('buffer',   onBufferUpdate) if @player.removeEventListener?
    catch err
      c?() for c in cleanups
      c?() for c in @_playerCleanups
      @_playerCleanups = []
      return null

    if null in cleanups
      c?() for c in cleanups
      c?() for c in @_playerCleanups
      @_playerCleanups = []
      return null

    @_updateUI()

    # Main cleanup function
    @_cleanup = ->
      c?() for c in cleanups
      c?() for c in @_playerCleanups
      @_playerCleanups = []
      @_cleanup = null
      return
    @_cleanup

  # Calculate seek position from pointer event
  _seekFromPointerEvent: (e) ->
    return unless @trackEl?
    rect = @trackEl.getBoundingClientRect()
    clientX = e.clientX ? e.touches?.[0]?.clientX ? rect.left
    ratio = _clamp((clientX - rect.left) / rect.width, 0, 1)
    dur = @_getCurrentDuration()
    @player.seek(Math.floor(ratio * dur)) if dur > 0
    return

  # Safely get current track duration
  _getCurrentDuration: ->
    if _isFn(@player.getDuration)
      d = @player.getDuration()
      return d if _isNumber(d) and d > 0
    try
      audio = @player._audio
      if audio?.duration and Number.isFinite(Number(audio.duration))
        return Number(audio.duration)
    Math.max(0, Number(@player.currentTrack?.durationSec ? 0))

  # Calculate buffer progress ratio
  _getBufferRatio: ->
    return 0 unless @bufferEl?
    try
      if _isFn(@player.getBuffered)
        buffered = @player.getBuffered()
        return _clamp(buffered, 0, 1) if _isNumber(buffered)
      audio = @player._audio
      if audio?.buffered?.length > 0
        end = audio.buffered.end(audio.buffered.length - 1)
        return _clamp(end / audio.duration, 0, 1) if audio.duration > 0
    0

  # Update all progress bar UI elements
  _updateUI: (info = null) ->
    return unless @trackEl?
    try
      dur = @_getCurrentDuration()
      pos = if _isNumber(info?.positionSec) then info.positionSec else @player.positionSec
      posRatio = if dur > 0 then _clamp(pos / dur, 0, 1) else 0
      @fillEl.style.width = "#{Math.round(posRatio * 10000) / 100}%" if @fillEl?
      bufRatio = @_getBufferRatio()
      @bufferEl.style.width = "#{Math.round(bufRatio * 10000) / 100}%" if @bufferEl?
    return

# --- SimpleTooltips ------------------------------------------------------
class SimpleTooltips
  constructor: (scope, opts = {}) ->
    @scope = if _isNode(scope)
      scope
    else if typeof document isnt 'undefined'
      document.body
    else
      null
    @showDelayMs  = if _isPositiveInt(opts.showDelayMs) then opts.showDelayMs else 300
    @hideDelayMs  = if _isPositiveInt(opts.hideDelayMs) then opts.hideDelayMs else 80
    @tooltipClass = if _isString(opts.className) and opts.className.length
      opts.className
    else
      'music-tooltip'
    @activeTooltip = null
    @_hideTimer    = null
    @_showTimer    = null
    @_activeTarget = null
    @_cleanup      = null

  # Initialize tooltip event listeners
  bind: ->
    return @_cleanup if @_cleanup? or not @scope?

    # Show tooltip after delay
    showTooltip = (e) =>
      target = e.currentTarget
      text = target?.getAttribute?.('data-tooltip')
      return unless _isString(text) and text.length
      @_clearTimers()
      @_activeTarget = target
      @_showTimer = setTimeout(=> @_createTooltip(text, target), @showDelayMs)
      return

    # Hide tooltip after delay
    hideTooltip = =>
      @_clearTimers()
      @_hideTimer = setTimeout(=> @_destroyTooltip(), @hideDelayMs)
      return

    # Cleanup timeouts to prevent memory leaks
    @_clearTimers = ->
      clearTimeout(@_showTimer) if @_showTimer?
      clearTimeout(@_hideTimer) if @_hideTimer?
      @_showTimer = @_hideTimer = null
      return

    # Create tooltip element
    @_createTooltip = (text, target) =>
      @_destroyTooltip()
      rect = target.getBoundingClientRect()
      tip = document.createElement('div')
      tip.className = @tooltipClass
      tip.textContent = text
      # Position tooltip above target
      tip.style.cssText = """
        position: fixed;
        left: #{rect.left + rect.width/2}px;
        top: #{rect.top - 10}px;
        transform: translate(-50%, -100%);
        z-index: 9999;
      """
      document.body.appendChild(tip)
      @activeTooltip = tip
      return

    # Remove tooltip element
    @_destroyTooltip = =>
      @activeTooltip?.remove()
      @activeTooltip = null
      @_activeTarget = null
      return

    # Attach delegated event listeners
    cleanups = [
      _bindEvent(@scope, 'mouseenter', showTooltip, true)
      _bindEvent(@scope, 'focusin',   showTooltip, true)
      _bindEvent(@scope, 'mouseleave', hideTooltip, true)
      _bindEvent(@scope, 'focusout',  hideTooltip, true)
    ]

    if null in cleanups
      c?() for c in cleanups
      return null

    @_cleanup = ->
      c?() for c in cleanups
      @_clearTimers()
      @_destroyTooltip()
      @_cleanup = null
      return
    @_cleanup
