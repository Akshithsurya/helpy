###
# MusicPlayer — HTML5 Audio-based player with state machine, queue, crossfade,
# repeat/shuffle, and localStorage-backed persistence.
###

CONST = require './plan-enhancer-constants'
{ _isNumber, _isPositiveInt, _isPlainObject } = CONST

# ── Frozen enums ──────────────────────────────────────────────────────

STATES = Object.freeze
  IDLE:      'idle'
  LOADING:   'loading'
  PLAYING:   'playing'
  PAUSED:    'paused'
  BUFFERING: 'buffering'
  ENDED:     'ended'
  ERROR:     'error'

REPEAT = Object.freeze
  OFF: 'off'
  ONE: 'one'
  ALL: 'all'

# ── Valid state transitions (soft-validated — warns, doesn't block) ───

VALID_TRANSITIONS = Object.freeze
  idle:      [STATES.LOADING, STATES.ERROR]
  loading:   [STATES.PLAYING, STATES.PAUSED, STATES.BUFFERING, STATES.ERROR, STATES.IDLE]
  playing:   [STATES.PAUSED, STATES.BUFFERING, STATES.ENDED, STATES.ERROR, STATES.IDLE, STATES.LOADING]
  paused:    [STATES.PLAYING, STATES.LOADING, STATES.IDLE, STATES.ERROR]
  buffering: [STATES.PLAYING, STATES.PAUSED, STATES.ERROR, STATES.IDLE]
  ended:     [STATES.PLAYING, STATES.LOADING, STATES.IDLE]
  error:     [STATES.LOADING, STATES.IDLE, STATES.PLAYING, STATES.PAUSED]

# ── Helpers ───────────────────────────────────────────────────────────

_isString   = (v) -> typeof v is 'string'
_isArray    = (v) -> Array.isArray v
_isFunction = (v) -> typeof v is 'function'

_clamp = (v, lo, hi) ->
  v = Number v
  return lo if isNaN v
  Math.max lo, Math.min hi, v

_nowIso = -> try new Date().toISOString() catch then ''

_shuffleArr = (arr) ->
  a = arr.slice()
  i = a.length - 1
  while i > 0
    j = Math.floor Math.random() * (i + 1)
    [a[i], a[j]] = [a[j], a[i]]
    i -= 1
  a

# ── EventEmitter ──────────────────────────────────────────────────────

class EventEmitter
  constructor: -> @_listeners = new Map()

  on: (evt, fn) ->
    return unless _isFunction fn
    evt = String evt
    @_listeners.set evt, new Set() unless @_listeners.has evt
    @_listeners.get(evt).add fn
    => @off evt, fn               # return unsubscribe thunk

  off: (evt, fn) ->
    return unless _isFunction fn
    set = @_listeners.get String evt
    set?.delete fn
    return

  once: (evt, fn) ->
    return unless _isFunction fn
    unsub = @on evt, (payload) =>
      unsub?()
      fn payload
    unsub

  emit: (evt, payload = null) ->
    set = @_listeners.get String evt
    return 0 unless set?.size
    fns = [...set]          # snapshot to avoid mutation during iteration
    count = 0
    for fn in fns
      try fn payload
      catch err
        try console.warn '[EventEmitter] listener error for "%s": %s', evt, err?.message
      count += 1
    count

  clear: (evt = null) ->
    if evt? then @_listeners.delete(String evt) else @_listeners.clear()
    return

  listenerCount: (evt) ->
    set = @_listeners.get String evt
    if set? then set.size else 0

# ── MusicPlayer ───────────────────────────────────────────────────────

class MusicPlayer extends EventEmitter

  # Class-level enum access — no instance needed
  @STATES: STATES
  @REPEAT: REPEAT

  CROSSFADE_MS:      5000
  PERSIST_DEBOUNCE:  300
  STORAGE_KEY:       'helpy.musicplayer.state.v1'
  VOLUME_STEP:       0.05
  MAX_QUEUE:         10000
  MAX_PERSIST_QUEUE: 1000
  RESTART_THRESHOLD: 3   # seconds before 'previous' restarts current track

  constructor: (opts = {}) ->
    super()
    @logger = if _isPlainObject(opts.logger) and
                  _isFunction(opts.logger.debug) and
                  _isFunction(opts.logger.warn) and
                  _isFunction(opts.logger.error)
                opts.logger
              else
                console

    @state        = STATES.IDLE
    @queue        = []
    @queueIndex   = 0
    @shuffle      = false
    @repeatMode   = REPEAT.OFF
    @volume       = 0.8
    @isMuted      = false
    @currentTrack = null
    @positionSec  = 0
    @playlistId   = null
    @playOrder    = null
    @_playOrderMap = null   # reverse map: queueIndex → position in playOrder
    @_lastError   = null
    @_destroyed   = false

    # Crossfade internals
    @_crossfading    = false
    @_crossfadeTimer = null
    @_pendingAudio   = null

    # Debounced persist
    @_persistTimer = null

    # Storage backend
    @_storage = opts.storage ? null

    # HTML5 Audio element
    @_audio = opts.audioEl ? null
    if not @_audio? and typeof Audio isnt 'undefined'
      try @_audio = new Audio()
      
    if @_audio? then @_bindAudioEvents @_audio

    # Load persisted preferences
    try @_loadPersisted() catch then undefined
    return

  # ── State read API ──────────────────────────────────────────────────

  isPlaying: -> @state is STATES.PLAYING
  isPaused:  -> @state is STATES.PAUSED
  isLoading: -> @state is STATES.LOADING or @state is STATES.BUFFERING

  getPublicState: ->
    state:          @state
    queue:          @queue.slice()
    queueLength:    @queue.length
    queueIndex:     @queueIndex
    shuffle:        !!@shuffle
    repeatMode:     @repeatMode
    volume:         @volume
    isMuted:        !!@isMuted
    currentTrack:   if @currentTrack? then Object.assign({}, @currentTrack) else null
    positionSec:    @positionSec
    durationSec:    @getDuration()
    playlistId:     @playlistId ? null
    lastError:      @_lastError
    hasAudioDriver: @_audio?

  getDuration: ->
    d = Number @_audio?.duration
    if Number.isFinite(d) then d else 0

  getBuffered: ->
    a = @_audio
    return 0 unless a?.buffered?.length
    try a.buffered.end(a.buffered.length - 1) catch then 0

  # ── Persistence ──────────────────────────────────────────────────────

  _storageBackend: ->
    return @_storage if @_storage?
    if typeof localStorage isnt 'undefined' then localStorage else null

  _loadPersisted: ->
    backend = @_storageBackend()
    return unless backend?
    raw = backend.getItem @STORAGE_KEY
    return unless _isString(raw) and raw.length > 0

    try
      obj = JSON.parse raw
    catch err
      @logger?.warn? '[MusicPlayer._loadPersisted] JSON parse failed', err?.message
      return

    return unless _isPlainObject obj

    @volume     = _clamp Number(obj.volume) ? @volume, 0, 1
    @isMuted    = !!obj.isMuted
    @shuffle    = !!obj.shuffle
    @repeatMode = if obj.repeatMode in [REPEAT.OFF, REPEAT.ONE, REPEAT.ALL]
                    String obj.repeatMode
                  else
                    REPEAT.OFF
    @queue      = if _isArray(obj.queue) then obj.queue.slice(0, @MAX_QUEUE) else []
    @queueIndex = if _isPositiveInt(obj.queueIndex) and obj.queueIndex < @queue.length
                    obj.queueIndex
                  else
                    0
    @playlistId = if _isString(obj.playlistId) and obj.playlistId.length > 0
                    obj.playlistId
                  else
                    null

    @_rebuildPlayOrder()
    return

  persist: ->
    return false if @_destroyed
    backend = @_storageBackend()
    return false unless backend?
    payload =
      volume:     @volume
      isMuted:    @isMuted
      shuffle:    @shuffle
      repeatMode: @repeatMode
      queue:      @queue.slice 0, @MAX_PERSIST_QUEUE
      queueIndex: @queueIndex
      playlistId: @playlistId
      savedAt:    _nowIso()
    try
      backend.setItem @STORAGE_KEY, JSON.stringify payload
      true
    catch err
      @logger.warn '[MusicPlayer.persist] storage failed', err?.message
      false

  _schedulePersist: ->
    return if @_destroyed
    clearTimeout @_persistTimer if @_persistTimer?
    @_persistTimer = setTimeout (=> @persist()), @PERSIST_DEBOUNCE
    return

  # ── Audio DOM bindings ──────────────────────────────────────────────

  _bindAudioEvents: (a) ->
    return unless a?
    return if a._mpBound          # prevent double-binding
    a._mpBound = true
    try
      a.preload = 'metadata'
      a.volume  = if @isMuted then 0 else @volume
      a.addEventListener 'play',           @_onAudioPlay
      a.addEventListener 'pause',          @_onAudioPause
      a.addEventListener 'waiting',        @_onAudioWaiting
      a.addEventListener 'canplay',        @_onAudioCanPlay
      a.addEventListener 'ended',          @_onAudioEnded
      a.addEventListener 'error',          @_onAudioError
      a.addEventListener 'timeupdate',     @_onAudioTimeUpdate
      a.addEventListener 'loadedmetadata', @_onAudioLoadedMetadata
      a.addEventListener 'seeked',         @_onAudioSeeked
    catch err
      @logger.warn '[MusicPlayer._bindAudioEvents] binding failed', err?.message
    return

  _unbindAudioEvents: (a) ->
    return unless a? and a._mpBound
    a._mpBound = false
    try
      a.removeEventListener 'play',           @_onAudioPlay
      a.removeEventListener 'pause',          @_onAudioPause
      a.removeEventListener 'waiting',        @_onAudioWaiting
      a.removeEventListener 'canplay',        @_onAudioCanPlay
      a.removeEventListener 'ended',          @_onAudioEnded
      a.removeEventListener 'error',          @_onAudioError
      a.removeEventListener 'timeupdate',     @_onAudioTimeUpdate
      a.removeEventListener 'loadedmetadata', @_onAudioLoadedMetadata
      a.removeEventListener 'seeked',         @_onAudioSeeked
    catch then undefined
    return

  # Bound handler refs — stable references so removeEventListener works
  _onAudioPlay: =>
    return if @_crossfading
    @_transition STATES.PLAYING, driver: 'audio'

  _onAudioPause: =>
    return if @_crossfading
    @_transition STATES.PAUSED, driver: 'audio'

  _onAudioWaiting: =>
    return if @_crossfading
    @_transition STATES.BUFFERING, driver: 'audio'

  _onAudioCanPlay: =>
    return if @_crossfading
    a = @_audio
    return unless a?
    @_transition (if a.paused then STATES.PAUSED else STATES.PLAYING), driver: 'audio'

  _onAudioEnded: =>
    return if @_crossfading
    @_transition STATES.ENDED, driver: 'audio'
    @next true

  _onAudioError: (e) =>
    return if @_crossfading
    code = e?.target?.error?.code ? 'unknown'
    msg  = e?.target?.error?.message ? ''
    @_lastError = "AUDIO_ERROR:#{code}"
    @_transition STATES.ERROR, driver: 'audio', error: @_lastError, detail: msg

  _onAudioTimeUpdate: =>
    try
      a = @_audio
      return unless a?
      sec = Number a.currentTime
      @positionSec = if Number.isFinite sec then _clamp(sec, 0, Infinity) else 0
      @emit 'position', positionSec: @positionSec, durationSec: @getDuration()
    catch then undefined

  _onAudioLoadedMetadata: =>
    @emit 'duration', durationSec: @getDuration()

  _onAudioSeeked: =>
    try
      a = @_audio
      return unless a?
      sec = Number a.currentTime
      @positionSec = if Number.isFinite sec then _clamp(sec, 0, Infinity) else 0
      @emit 'seeked', positionSec: @positionSec, durationSec: @getDuration()
    catch then undefined

  # ── Swap audio element (used by crossfade) ──────────────────────────

  _swapAudio: (newAudio) ->
    old = @_audio
    @_unbindAudioEvents old if old?
    try old?.pause()
    try old?.removeAttribute 'src'
    try old?.load()                # release held network resources
    @_audio = newAudio
    @_bindAudioEvents newAudio
    return

  # ── Internal state transitions ──────────────────────────────────────

  _transition: (next, meta = null) ->
    return if @_destroyed
    prev = @state
    # Suppress audio-driven duplicates; allow explicit re-emission
    return if prev is next and meta?.driver is 'audio'
    # Soft validation — warn on unexpected transitions but don't block
    allowed = VALID_TRANSITIONS[prev]
    if allowed? and next not in allowed and not meta?.force
      @logger?.warn? '[MusicPlayer._transition] unexpected %s → %s', prev, next
    @state = next
    @_schedulePersist()
    @emit 'state',
      previous:     prev
      state:        next
      meta:         meta
      currentTrack: @currentTrack
      positionSec:  @positionSec
      queueIndex:   @queueIndex
    return

  # ── Track URL resolution (DRY) ──────────────────────────────────────

  _resolveTrackUrl: (track) ->
    return null unless _isPlainObject track
    track.streamUrl ? track.url ? track.localPath ? null

  # ── Track loading & playback controls ───────────────────────────────

  loadTrack: (track) ->
    unless _isPlainObject(track) and _isString(track.title)
      throw new TypeError 'loadTrack requires track object with title'

    @_cancelCrossfade()
    @_setTrackInternal track

    if @_audio?
      url = @_resolveTrackUrl track
      if url?
        @_transition STATES.LOADING
        try
          @_audio.pause()
          @_audio.src = url
          @_audio.load()
        catch err
          @_lastError = "LOAD_FAILED: #{err?.message ? 'unknown'}"
          @_transition STATES.ERROR, error: @_lastError
      else
        @positionSec = 0
        @_transition STATES.PAUSED
    else
      @positionSec = 0
      @_transition STATES.PAUSED

    @emit 'track', Object.assign {}, @currentTrack
    @currentTrack

  play: ->
    return false if @_destroyed
    unless @currentTrack?
      if @queue.length > 0
        @_playIndex @queueIndex ? 0
        return true
      return false
    if @_audio?
      try
        p = @_audio.play()
        if p? and _isFunction p.then
          p.catch (err) =>
            @_lastError = "PLAY_REJECTED: #{err?.message ? 'autoplay blocked'}"
            @_transition STATES.ERROR, error: @_lastError
      catch err
        @_lastError = "PLAY_FAILED: #{err?.message ? 'unknown'}"
        @_transition STATES.ERROR, error: @_lastError
    else
      @_transition STATES.PLAYING
    true

  pause: ->
    return false if @_destroyed
    @_cancelCrossfade()
    try @_audio?.pause()
    @_transition STATES.PAUSED
    true

  toggle: ->
    if @state is STATES.PLAYING then @pause() else @play()

  stop: ->
    return false if @_destroyed
    @_cancelCrossfade()
    try
      @_audio?.pause()
      if @_audio? then @_audio.currentTime = 0
    catch then undefined
    @positionSec = 0
    @_transition STATES.IDLE
    true

  seek: (seconds) ->
    wasPlaying = @state is STATES.PLAYING
    @_cancelCrossfade()
    sec = if _isNumber seconds then _clamp(seconds, 0, Infinity) else 0
    @positionSec = sec
    if @_audio?
      try
        if Number.isFinite @_audio.duration
          sec = _clamp sec, 0, @_audio.duration
        @_audio.currentTime = sec
      catch then undefined
    @emit 'position', positionSec: sec, durationSec: @getDuration()
    
    # Resume playback if it was interrupted by crossfade cancellation
    if wasPlaying and @_audio?.paused
      @play()
    sec

  setVolume: (vol) ->
    v = _clamp Number(vol ? 0), 0, 1
    @volume = v
    if @_audio? and not @isMuted
      try @_audio.volume = v
    @_schedulePersist()
    @emit 'volume', volume: v, isMuted: @isMuted
    v

  volumeUp: (step = @VOLUME_STEP) ->
    @setVolume @volume + step

  volumeDown: (step = @VOLUME_STEP) ->
    @setVolume @volume - step

  muteToggle: (force = null) ->
    @isMuted = if force? then !!force else not @isMuted
    if @_audio?
      try @_audio.volume = if @isMuted then 0 else @volume
    @_schedulePersist()
    @emit 'volume', volume: @volume, isMuted: @isMuted
    @isMuted

  # ── Queue management ────────────────────────────────────────────────

  _emitQueueChange: ->
    @emit 'queue', queue: @queue.slice(), index: @queueIndex, playlistId: @playlistId

  setQueue: (tracks, startIndex = 0, playlistId = null) ->
    unless _isArray tracks then throw new TypeError 'setQueue expects array'
    @queue      = tracks.filter((t) -> _isPlainObject t).slice 0, @MAX_QUEUE
    @playlistId = if _isString(playlistId) and playlistId.length > 0 then playlistId else null
    @queueIndex = _clamp (parseInt(startIndex, 10) or 0), 0, Math.max(0, @queue.length - 1)
    @_rebuildPlayOrder()
    @_schedulePersist()
    @_emitQueueChange()
    @queue.length

  enqueue: (track, front = false) ->
    unless _isPlainObject track then throw new TypeError 'enqueue expects track object'
    if @queue.length >= @MAX_QUEUE
      @logger?.warn? '[MusicPlayer.enqueue] queue at max capacity (%d)', @MAX_QUEUE
      return @queue.length
    if front
      @queue.unshift track
      @queueIndex = 0
    else
      @queue.push track
    @_rebuildPlayOrder()
    @_schedulePersist()
    @_emitQueueChange()
    @queue.length

  clearQueue: ->
    @queue         = []
    @queueIndex    = 0
    @playlistId    = null
    @playOrder     = null
    @_playOrderMap = null
    @_schedulePersist()
    @_emitQueueChange()
    0

  reorderQueue: (fromIndex, toIndex) ->
    from = parseInt fromIndex, 10
    to   = parseInt toIndex,   10
    return @queue unless Number.isFinite(from) and Number.isFinite(to) and
                          0 <= from < @queue.length and 0 <= to <= @queue.length
    [item] = @queue.splice from, 1
    @queue.splice to, 0, item

    # Adjust queueIndex to keep pointing at the same logical track
    if from is @queueIndex
      @queueIndex = to
    else if from < @queueIndex <= to
      @queueIndex -= 1
    else if to <= @queueIndex < from
      @queueIndex += 1

    @_rebuildPlayOrder()
    @_schedulePersist()
    @_emitQueueChange()
    @queue.slice()

  removeFromQueue: (index) ->
    i = parseInt index, 10
    return null unless Number.isFinite(i) and 0 <= i < @queue.length
    [removed] = @queue.splice i, 1
    if i < @queueIndex
      @queueIndex = Math.max 0, @queueIndex - 1
    else if i is @queueIndex
      @queueIndex = Math.min @queueIndex, Math.max(0, @queue.length - 1)
    @_rebuildPlayOrder()
    @_schedulePersist()
    @_emitQueueChange()
    removed

  # ── Shuffle / repeat ────────────────────────────────────────────────

  _rebuildPlayOrder: ->
    unless @shuffle
      @playOrder = null
      @_playOrderMap = null
      return

    @playOrder = _shuffleArr [0...@queue.length]
    @_playOrderMap = new Map()
    @playOrder.forEach (idx, pos) => @_playOrderMap.set idx, pos
    return

  setShuffle: (enabled) ->
    @shuffle = !!enabled
    @_rebuildPlayOrder()
    @_schedulePersist()
    @_emitQueueChange()
    @shuffle

  setRepeat: (mode) ->
    m = String(mode ? REPEAT.OFF).toLowerCase()
    @repeatMode = if m in [REPEAT.OFF, REPEAT.ONE, REPEAT.ALL] then m else REPEAT.OFF
    @_schedulePersist()
    @emit 'repeat', mode: @repeatMode
    @repeatMode

  # ── Previous / Next ─────────────────────────────────────────────────

  next: (auto = false) ->
    return false if @_destroyed
    if @repeatMode is REPEAT.ONE and auto and @queue.length > 0
      @seek 0
      @play()
      return true
    return false if @queue.length is 0

    nextIdx = @_resolveNextIndex()
    return @_finishQueue() if nextIdx < 0
    @_playIndex nextIdx
    true

  previous: ->
    return false if @_destroyed
    return false unless @queue.length > 0
    # Standard UX: restart current track if past threshold, otherwise go back
    if @positionSec > @RESTART_THRESHOLD
      @seek 0
      return true
    @_playIndex @_resolvePrevIndex()
    true

  _resolveNextIndex: ->
    if @playOrder?
      flatIdx = @_playOrderMap?.get(@queueIndex) ? -1
      return 0 if flatIdx < 0
      return @playOrder[flatIdx + 1] if flatIdx + 1 < @playOrder.length
      return if @repeatMode is REPEAT.ALL then @playOrder[0] else -1
    if @queueIndex + 1 < @queue.length then @queueIndex + 1
    else if @repeatMode is REPEAT.ALL then 0 else -1

  _resolvePrevIndex: ->
    if @playOrder?
      flatIdx = @_playOrderMap?.get(@queueIndex) ? -1
      return @queueIndex if flatIdx < 0
      if flatIdx > 0
        return @playOrder[flatIdx - 1]
      # At start of shuffled queue
      return if @repeatMode is REPEAT.ALL then @playOrder[@playOrder.length - 1] else @playOrder[0]
    Math.max 0, @queueIndex - 1

  _playIndex: (i) ->
    idx = _clamp (parseInt(i, 10) or 0), 0, Math.max(0, @queue.length - 1)
    @queueIndex = idx
    nextTrack = @queue[idx]
    return null unless nextTrack?
    @_schedulePersist()
    if @state is STATES.PLAYING and @CROSSFADE_MS > 0 and @_audio?
      @_crossfade nextTrack
    else
      @loadTrack nextTrack
      @play()
    nextTrack

  # ── Crossfade ───────────────────────────────────────────────────────

  _crossfade: (nextTrack) ->
    @_cancelCrossfade()

    url = @_resolveTrackUrl nextTrack
    unless url?
      @loadTrack nextTrack
      @play()
      return

    # Prepare the new audio element
    pending = null
    if typeof Audio isnt 'undefined'
      try pending = new Audio()
    unless pending?
      @loadTrack nextTrack
      @play()
      return

    pending.volume  = 0
    pending.src     = url
    pending.preload = 'auto'
    pending.load()

    @_crossfading  = true
    @_pendingAudio = pending
    oldAudio       = @_audio
    startVol       = if @isMuted then 0 else @volume
    steps          = 10
    stepMs         = Math.max 1, Math.floor @CROSSFADE_MS / (steps * 2)
    phase          = 'out'
    phaseStep      = 0
    waitingForPlay = false
    aborted        = false       # guard against double-finish

    # ── Successful crossfade completion ──────────────────────────────
    finish = =>
      return if aborted
      aborted = true
      if @_crossfadeTimer?
        clearInterval @_crossfadeTimer
        @_crossfadeTimer = null
      @_crossfading  = false
      @_pendingAudio = null

      @_swapAudio pending
      @_setTrackInternal nextTrack
      try pending.volume = if @isMuted then 0 else @volume
      @_transition STATES.PLAYING
      @emit 'crossfade', done: true

    # ── Crossfade failure (e.g. play() rejected) ────────────────────
    fail = (reason) =>
      return if aborted
      aborted = true
      if @_crossfadeTimer?
        clearInterval @_crossfadeTimer
        @_crossfadeTimer = null
      @_crossfading  = false
      @_pendingAudio = null

      # Clean up the audio that failed to play
      try pending.pause()
      try pending.removeAttribute 'src'
      try pending.load()

      # Restore old audio volume if it's still active
      if oldAudio? and not @isMuted
        try oldAudio.volume = startVol

      @_lastError = "CROSSFADE_FAILED: #{reason ? 'unknown'}"
      @_transition STATES.ERROR, error: @_lastError
      @emit 'crossfade', done: false, error: @_lastError

    @_crossfadeTimer = setInterval =>
      # Bail out if waiting for async play promise or destroyed
      return if aborted or waitingForPlay or @_destroyed or not @_crossfading
      try
        if phase is 'out'
          phaseStep += 1
          try oldAudio.volume = Math.max(0, startVol * (1 - phaseStep / steps)) unless @isMuted
          if phaseStep >= steps
            try oldAudio.pause()
            playResult = pending.play()
            if playResult? and _isFunction playResult.then
              waitingForPlay = true
              playResult
                .then =>
                  # Ignore if crossfade was cancelled while waiting
                  return unless @_crossfading and @_pendingAudio is pending
                  waitingForPlay = false
                  phase = 'in'
                  phaseStep = 0
                .catch (err) =>
                  return unless @_crossfading and @_pendingAudio is pending
                  fail "PLAY_REJECTED: #{err?.message ? 'autoplay'}"
            else
              phase = 'in'
              phaseStep = 0
        else  # phase is 'in'
          phaseStep += 1
          tgt = if @isMuted then 0 else @volume
          try pending.volume = tgt * (phaseStep / steps)
          if phaseStep >= steps then finish()
      catch err
        @logger.warn '[MusicPlayer.crossfade] step failed', err?.message
        fail err?.message
    , stepMs
    return

  _cancelCrossfade: ->
    if @_crossfadeTimer?
      clearInterval @_crossfadeTimer
      @_crossfadeTimer = null

    pending = @_pendingAudio
    if pending?
      try pending.pause()
      try pending.removeAttribute 'src'
      try pending.load()
      @_pendingAudio = null

    if @_crossfading and @_audio?
      # Restore volume if not muted
      unless @isMuted
        try @_audio.volume = @volume
    @_crossfading = false
    return

  # ── Queue end ───────────────────────────────────────────────────────

  _finishQueue: ->
    try @_audio?.pause()
    @_transition STATES.ENDED, finished: true
    false

  # ── Internal setter ─────────────────────────────────────────────────

  _setTrackInternal: (t) ->
    flat = {}
    for k, v of t when v isnt undefined
      flat[k] = v
    flat.sourceType = t.sourceType ? 'unknown'
    flat.title      = if _isString(t.title) and t.title.length > 0 then t.title else 'Untitled'
    @currentTrack = Object.freeze flat
    @positionSec  = 0
    @_lastError   = null
    @currentTrack

  # ── Destroy ─────────────────────────────────────────────────────────

  destroy: ->
    return if @_destroyed
    @_destroyed = true
    @_cancelCrossfade()
    try
      if @_audio?
        @_unbindAudioEvents @_audio
        @_audio.pause()
        @_audio.removeAttribute 'src'
        @_audio.load()
    catch then undefined
    if @_persistTimer?
      clearTimeout @_persistTimer
      @_persistTimer = null
    @clear()
    return

module.exports =
  MusicPlayer: MusicPlayer
  EventEmitter: EventEmitter
  STATES: STATES
  REPEAT: REPEAT
