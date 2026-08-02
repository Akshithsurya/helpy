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

_isString = (v) -> typeof v is 'string'
_isArray  = Array.isArray
_isFn     = (v) -> typeof v is 'function'

# Accepts HTMLElement, Document, or any node-like object with addEventListener.
_isNode = (v) ->
  return false unless v?
  return v instanceof HTMLElement if typeof HTMLElement isnt 'undefined'
  typeof v is 'object' and typeof v.addEventListener is 'function'

_clamp = (v, lo, hi) -> Math.max(lo, Math.min(hi, v))

_cleanStr = (v) ->
  return '' unless _isString(v)
  v.replace(/\s+/g, ' ').trim()

# Safe addEventListener; returns a removable cleanup function or null.
_bindEvent = (el, ev, fn, opts = false) ->
  return null unless _isNode(el) and _isString(ev) and _isFn(fn)
  try el.addEventListener(ev, fn, opts)
  ->
    try el.removeEventListener(ev, fn, opts)
    return

# Debounce with leading/trailing control. Suppresses the trailing edge when
# only a single leading call arrived (matches lodash semantics).
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

SEEK_STEP_SEC        = 5
VOLUME_STEP_FALLBACK = 0.1

# Element tags that should not trigger global shortcuts while focused.
# Volume keys are exempted so users can adjust without blurring inputs.
TAGS_THAT_EAT_KEYS = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']
VOLUME_KEYS        = new Set(['volumeUp', 'volumeDown'])

SHORTCUTS = Object.freeze [
  { keys: ['Space'],                  action: 'toggle',     description: 'Play / Pause' }
  { keys: ['Ctrl+ArrowRight', 'N'],   action: 'next',       description: 'Next track' }
  { keys: ['Ctrl+ArrowLeft',  'P'],   action: 'previous',   description: 'Previous track' }
  { keys: ['M'],                      action: 'mute',       description: 'Mute toggle' }
  { keys: ['S'],                      action: 'shuffle',    description: 'Shuffle toggle' }
  { keys: ['R'],                      action: 'repeat',     description: 'Cycle repeat mode' }
  { keys: ['+', '='],                 action: 'volumeUp',   description: 'Volume up' }
  { keys: ['-', '_'],                 action: 'volumeDown', description: 'Volume down' }
  { keys: ['J'],                      action: 'seekBack',   description: "Seek back #{SEEK_STEP_SEC}s" }
  { keys: ['K'],                      action: 'seekFwd',    description: "Seek forward #{SEEK_STEP_SEC}s" }
]

# --- MusicShortcuts ------------------------------------------------------

class MusicShortcuts
  constructor: (@player, opts = {}) ->
    throw new TypeError('MusicShortcuts requires a MusicPlayer instance') unless @player instanceof MusicPlayer
    @scope  = opts.scope ? 'global'
    @target = if _isNode(opts.target)
      opts.target
    else if typeof document isnt 'undefined'
      document
    else
      null
    @custom = if _isFn(opts.customActionHandler) then opts.customActionHandler else null
    @_keyMap  = @_buildKeyMap(opts.overrides ? null)
    @_cleanup = null

  _buildKeyMap: (overrides) ->
    entries = SHORTCUTS.slice()
    if _isPlainObject(overrides)
      merged = []
      seen   = new Set()
      for name, def of overrides when _isPlainObject(def) and _isArray(def.keys)
        merged.push
          keys:        def.keys.slice()
          action:      name
          description: if _isString(def.description) then def.description else name
        seen.add(name)
      entries = (s for s in entries when not seen.has(s.action)).concat(merged)
    map = new Map()
    for s in entries
      for k in s.keys
        if (norm = @_normalizeKey(k))?
          map.set(norm, Object.assign({}, s))
    map

  _normalizeKey: (raw) ->
    return null unless _isString(raw) and raw.length > 0
    ctrl = alt = shift = meta = false
    key  = ''
    for p in raw.split('+').map((x) -> x.trim()).filter((x) -> x.length > 0)
      switch p.toLowerCase()
        when 'ctrl'  then ctrl  = true
        when 'alt'   then alt   = true
        when 'shift' then shift = true
        when 'meta'  then meta  = true
        else key = p
    key = ' ' if key.toLowerCase() is 'space'
    Object.freeze { ctrl, alt, shift, meta, key }

  _eventMatches: (e, norm) ->
    norm.ctrl  is !!e.ctrlKey  and
    norm.alt   is !!e.altKey   and
    norm.shift is !!e.shiftKey and
    norm.meta  is !!e.metaKey  and
    String(e.key ? '').toLowerCase() is norm.key.toLowerCase()

  _findBinding: (e) ->
    for [norm, def] from @_keyMap
      return def if @_eventMatches(e, norm)
    null

  _dispatch: (e, def) ->
    handled = false
    try
      if @custom? and @custom(def.action, e, @player) is true
        handled = true
      handled = @_invokeAction(def.action) unless handled
    catch err
      try console?.warn? '[MusicShortcuts] dispatch failed', def?.action, err?.message
    if handled
      try e.preventDefault()
      try e.stopPropagation()
    handled

  _invokeAction: (action) ->
    p = @player
    switch action
      when 'toggle'   then p.toggle();                                          true
      when 'next'     then p.next();                                            true
      when 'previous' then p.previous();                                        true
      when 'mute'     then p.muteToggle();                                      true
      when 'shuffle'  then p.setShuffle(not p.shuffle);                         true
      when 'repeat'
        next = switch p.repeatMode
          when REPEAT.OFF then REPEAT.ALL
          when REPEAT.ALL then REPEAT.ONE
          else REPEAT.OFF
        p.setRepeat(next); true
      when 'volumeUp'
        p.setVolume(p.volume + (p.VOLUME_STEP ? VOLUME_STEP_FALLBACK));         true
      when 'volumeDown'
        p.setVolume(p.volume - (p.VOLUME_STEP ? VOLUME_STEP_FALLBACK));         true
      when 'seekBack'
        p.seek(Math.max(0, p.positionSec - SEEK_STEP_SEC));                     true
      when 'seekFwd'
        p.seek(p.positionSec + SEEK_STEP_SEC);                                  true
      else false

  bind: ->
    return @_cleanup if @_cleanup?
    return null unless @target?

    handler = (e) =>
      def = @_findBinding(e)
      return unless def?
      tagName = String(e.target?.tagName ? '').toUpperCase()
      return if tagName in TAGS_THAT_EAT_KEYS and def.action not in VOLUME_KEYS
      @_dispatch(e, def)

    cleanup = _bindEvent(@target, 'keydown', handler, false)
    return null unless cleanup?
    @_cleanup = ->
      cleanup()
      @_cleanup = null
      return
    @_cleanup

  listBindings: ->
    (Object.assign({}, def) for [_n, def] from @_keyMap)

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
    @searchFn     = if _isFn(opts.searchFn) then opts.searchFn else null
    @extraPresets = if _isArray(opts.presets) then opts.presets.filter(_isPlainObject) else []
    @extraGenres  = if _isArray(opts.genres)  then opts.genres.filter(_isString)       else []
    @cache        = new SimpleCache(200, 180000)
    @waitMs       = if _isPositiveInt(opts.waitMs) then opts.waitMs else 220
    @_abortToken  = 0
    @debounced    = _debounce(@_execute.bind(@), @waitMs, trailing: true, leading: false)

  listPresets: -> MusicAutocomplete.DEFAULT_PRESETS.concat(@extraPresets)

  listGenres: ->
    set = new Set(MusicAutocomplete.DEFAULT_GENRES)
    set.add(g) for g in @extraGenres when _isString(g) and g.length > 0
    Array.from(set)

  # Returns a handle with .cancel() and .abort() — abort invalidates any
  # in-flight async result so callbacks won't fire with stale data.
  suggest: (text, onResult) ->
    return unless _isFn(onResult)
    token       = ++@_abortToken
    t           = _cleanStr(text)
    staticItems = if t.length is 0 then @listPresets().slice(0, 6) else @_staticMatches(t)
    onResult({ source: 'static', items: staticItems })
    if t.length > 0
      @debounced t, (res) =>
        return if token isnt @_abortToken
        onResult(res)
    { cancel: @debounced.cancel, abort: => ++@_abortToken }

  _staticMatches: (t) ->
    needle = t.toLowerCase()
    out = []
    for p in @listPresets()
      hay = "#{p.label} #{p.id} #{p.genre ? ''}".toLowerCase()
      out.push(p) if hay.includes(needle)
    for g in @listGenres() when g.toLowerCase().includes(needle)
      out.push { id: g, type: 'genre', label: "Genre: #{g}", genre: g }
    out.slice(0, 20)

  _execute: (t, cb) ->
    t = _cleanStr(t)
    return if t.length is 0
    key = "ac:#{t.toLowerCase()}"
    if (cached = @cache.get(key))?
      try cb({ source: 'cached', items: cached })
      return

    done = (items) =>
      arr  = if _isArray(items) then items else []
      safe = arr.filter(_isPlainObject).slice(0, 50)
      @cache.set(key, safe)
      try cb({ source: 'remote', items: safe })
      return

    if _isFn(@searchFn)
      try
        p = @searchFn(t)
        if p? and _isFn(p.then)
          p.then(done).catch(-> done([]))
        else if _isArray(p) then done(p)
        else done([])
      catch
        done([])
    else
      done([])

# --- QueueDragDrop -------------------------------------------------------

class QueueDragDrop
  constructor: (@player, opts = {}) ->
    throw new TypeError('QueueDragDrop requires MusicPlayer instance') unless @player instanceof MusicPlayer
    @listEl       = if _isNode(opts.listEl) then opts.listEl else null
    @itemSelector = if _isString(opts.itemSelector) and opts.itemSelector.length > 0
      opts.itemSelector
    else
      '[data-track-index]'
    @_cleanup = null

  bind: ->
    return @_cleanup if @_cleanup?
    return null unless @listEl?

    draggingIndex = null
    hoverIndex    = null

    onDragStart = (e) =>
      idx = @_indexFromEvent(e)
      unless idx?
        try e.preventDefault()
        return
      draggingIndex = idx
      try e.dataTransfer.effectAllowed = 'move'
      try e.dataTransfer.setData('text/plain', String(idx))
      try e.target?.classList.add('music-dragging')
      return

    onDragEnd = (e) =>
      try e?.target?.classList.remove('music-dragging')
      @_clearHoverClasses()
      draggingIndex = null
      hoverIndex    = null
      return

    onDragOver = (e) =>
      try e.preventDefault()
      idx = @_indexFromEvent(e)
      if idx? and idx isnt hoverIndex
        @_setHover(idx)
        hoverIndex = idx
      try e.dataTransfer.dropEffect = 'move'
      false

    onDrop = (e) =>
      try e.preventDefault()
      fromIdx = draggingIndex
      fromIdx ?= parseInt(String(e.dataTransfer?.getData('text/plain') ? '-1'), 10)
      toIdx   = @_indexFromEvent(e)
      if Number.isFinite(fromIdx) and Number.isFinite(toIdx) and
         fromIdx isnt toIdx and fromIdx >= 0 and toIdx >= 0
        @player.reorderQueue(fromIdx, toIdx)
        try @player.emit?('queueReordered', { from: fromIdx, to: toIdx })
      @_clearHoverClasses()
      draggingIndex = null
      hoverIndex    = null
      false

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
      @_clearHoverClasses()
      @_cleanup = null
      return
    @_cleanup

  _indexFromEvent: (e) ->
    node = e.target
    while node?
      if (idx = node.getAttribute?('data-track-index'))?
        n = parseInt(idx, 10)
        return n if Number.isFinite(n) and n >= 0
      node = node.parentElement
    null

  _setHover: (idx) ->
    return unless @listEl?
    @_clearHoverClasses()
    target = @listEl.querySelectorAll(@itemSelector)[idx]
    target?.classList.add('music-drop-target')
    return

  _clearHoverClasses: ->
    return unless @listEl?
    try
      for el in @listEl.querySelectorAll('.music-drop-target, .music-dragging')
        el.classList.remove('music-drop-target')
        el.classList.remove('music-dragging')
    return

# --- ProgressSeek --------------------------------------------------------

class ProgressSeek
  constructor: (@player, opts = {}) ->
    throw new TypeError('ProgressSeek requires MusicPlayer instance') unless @player instanceof MusicPlayer
    @trackEl         = if _isNode(opts.trackEl) then opts.trackEl else null
    @fillEl          = if _isNode(opts.fillEl)  then opts.fillEl  else null
    @debouncedRender = _debounce(@_renderFill.bind(@), 50, trailing: true)
    @_cleanup        = null

  bind: ->
    return @_cleanup if @_cleanup?
    return null unless @trackEl?

    onPointerDown = (e) =>
      return unless @trackEl?
      @_seekFromEvent(e)
      @_renderFill()
      return

    onKeyDown = (e) =>
      switch e.key
        when 'ArrowLeft'
          @player.seek(Math.max(0, @player.positionSec - SEEK_STEP_SEC))
          try e.preventDefault()
        when 'ArrowRight'
          @player.seek(@player.positionSec + SEEK_STEP_SEC)
          try e.preventDefault()
      return

    onPos   = (info) => @debouncedRender(info); return
    onTrack = => @_renderFill(); return
    onState = => @_renderFill(); return

    cleanups = [
      _bindEvent(@trackEl, 'pointerdown', onPointerDown, false)
      _bindEvent(@trackEl, 'keydown',     onKeyDown,     false)
      _bindEvent(@trackEl, 'click',       ((e) -> try e.preventDefault(); return), false)
    ]

    playerCleanups = []
    try
      @player.on('position', onPos)
      @player.on('track',    onTrack)
      @player.on('state',    onState)
      playerCleanups.push => try @player.off('position', onPos)
      playerCleanups.push => try @player.off('track',    onTrack)
      playerCleanups.push => try @player.off('state',    onState)
    catch
      c?() for c in cleanups
      c?() for c in playerCleanups
      return null

    if null in cleanups
      c?() for c in cleanups
      c?() for c in playerCleanups
      return null

    @_renderFill()

    @_cleanup = ->
      c?() for c in cleanups
      c?() for c in playerCleanups
      @_cleanup = null
      return
    @_cleanup

  _seekFromEvent: (e) ->
    return unless @trackEl?
    rect    = @trackEl.getBoundingClientRect()
    clientX = e.clientX ? e.touches?[0]?.clientX ? rect.left
    ratio   = _clamp((clientX - rect.left) / rect.width, 0, 1)
    dur     = @_currentDuration()
    @player.seek(Math.floor(ratio * dur)) if dur > 0
    return

  _currentDuration: ->
    if _isFn(@player.getDuration)
      d = @player.getDuration()
      return d if _isNumber(d) and d > 0
    try
      audio = @player._audio
      if audio? and Number.isFinite(Number(audio.duration))
        return Number(audio.duration)
    Math.max(0, Number(@player.currentTrack?.durationSec ? 0))

  _renderFill: (info = null) ->
    return unless @fillEl? and @trackEl?
    try
      dur   = @_currentDuration()
      pos   = if _isNumber(info?.positionSec) then info.positionSec else @player.positionSec
      ratio = if dur > 0 then _clamp(pos / dur, 0, 1) else 0
      @fillEl.style.width = "#{Math.round(ratio * 10000) / 100}%"
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
    @delayMs  = if _isPositiveInt(opts.delayMs) then opts.delayMs else 300
    @tipClass = if _isString(opts.className) and opts.className.length > 0
      opts.className
    else
      'music-tooltip'
    @tip        = null
    @_hideTimer = null
    @_showTimer = null
    @_activeEl  = null
    @_cleanup   = null

  bind: ->
    return @_cleanup if @_cleanup? or not @scope?

    showEv = (e) =>
      el = e.target
      return unless el?.getAttribute?
      text = el.getAttribute('data-tooltip')
      return unless _isString(text) and text.length > 0
      clearTimeout(@_hideTimer) if @_hideTimer?; @_hideTimer = null
      clearTimeout(@_showTimer) if @_showTimer?
      @_showTimer = setTimeout (=> @_show(el, text)), @delayMs
      return

    hideEv = =>
      clearTimeout(@_showTimer) if @_showTimer?; @_showTimer = null
      @_hideTimer = setTimeout (=> @_hide()), 80
      return

    events = [
      ['mouseover', showEv, true]
      ['mouseout',  hideEv, true]
      ['focusin',   showEv, true]
      ['focusout',  hideEv, true]
    ]
    cleanups = for [ev, fn, useCapture] in events
      _bindEvent(@scope, ev, fn, useCapture)
    if null in cleanups
      c?() for c in cleanups
      return null

    @_cleanup = ->
      clearTimeout(@_showTimer) if @_showTimer?; @_showTimer = null
      clearTimeout(@_hideTimer) if @_hideTimer?; @_hideTimer = null
      c?() for c in cleanups
      @_hide()
      @_cleanup = null
      return
    @_cleanup

  _ensureTip: ->
    return @tip if @tip?
    return null unless typeof document isnt 'undefined'
    try
      t = document.createElement('span')
      t.setAttribute('role', 'tooltip')
      t.className          = @tipClass
      t.style.position     = 'absolute'
      t.style.pointerEvents = 'none'
      t.style.zIndex       = '99999'
      t.style.display      = 'none'
      document.body.appendChild(t)
      @tip = t
    catch
      null

  _show: (el, text) ->
    return unless _isNode(el)
    return unless (tip = @_ensureTip())?
    @_activeEl = el
    try
      tip.textContent   = text
      tip.style.display = 'block'
      r       = el.getBoundingClientRect()
      scrollY = window.scrollY ? window.pageYOffset ? 0
      scrollX = window.scrollX ? window.pageXOffset ? 0
      top     = scrollY + r.top - tip.offsetHeight - 8
      left    = scrollX + r.left + (r.width / 2) - (tip.offsetWidth / 2)
      maxLeft = (window.innerWidth ? document.documentElement.clientWidth) - tip.offsetWidth - 4
      left    = _clamp(left, 4, Math.max(4, maxLeft))
      top     = scrollY + r.bottom + 8 if top < scrollY
      tip.style.top  = "#{Math.floor(top)}px"
      tip.style.left = "#{Math.floor(left)}px"
    return

  _hide: ->
    return unless @tip?
    try
      @tip.style.display = 'none'
      @tip.textContent   = ''
    @_activeEl = null
    return

# --- Exports -------------------------------------------------------------

module.exports = {
  SHORTCUTS
  MusicShortcuts
  MusicAutocomplete
  QueueDragDrop
  ProgressSeek
  SimpleTooltips
  _musicDebounce: _debounce
  _musicUiClean:  _cleanStr
  _musicUiBind:   _bindEvent
}
