###
# Music source adapters (client-side CoffeeScript)
#
# Mirrors the PHP adapter-abstract pattern on the client side. Each adapter
# knows how to search, resolve stream URLs, and build Track DTOs. A central
# SourceAdapterRegistry exposes uniform discovery and registration so the
# MusicPlayer is source-agnostic.
#
# Design principles:
#   - Null/type guards on all public methods
#   - No-throw listener wrappers (try/catch in callbacks)
#   - SimpleCache-backed lookups (LRU + TTL)
#   - Async-safe caching: resolved values replace in-flight promises;
#     rejections evict the entry; concurrent callers share one promise.
#     Null/undefined results are cached via a CACHE_NULL sentinel so
#     missing resources do not trigger repeated lookups.
#   - Class-based, no anonymous globals
#   - DRY: schema-driven TrackDTO; shared RemoteSearchAdapter base;
#     unified cache-key + sentinel helpers
#   - Empty-string optional fields coerced to null (no lingering '')
###

CONST = require './plan-enhancer-constants'
{ SimpleCache, _isPositiveInt, _isPlainObject } = CONST

AUDIO_EXTS    = Object.freeze ['mp3', 'm4a', 'flac', 'ogg', 'wav', 'aac', 'opus', 'webm']
AUDIO_EXT_SET = new Set AUDIO_EXTS

# Sentinel: distinguishes "not in cache" from "cached as null/undefined".
CACHE_NULL = Symbol 'CACHE_NULL'

SOURCE_TYPES = Object.freeze
  local:      'local'
  youtube:    'youtube'
  spotify:    'spotify'
  soundcloud: 'soundcloud'

DEFAULTS = Object.freeze
  searchLimit:    20
  localLimit:     100
  aggregateLimit: 50
  cacheSize:      300
  cacheTtlMs:     60000
  fakeRowCount:   3

# ── Internal helpers ──────────────────────────────────────────────────────

_isString      = (v) -> typeof v is 'string'
_isArray       = (v) -> Array.isArray v
_isFunction    = (v) -> typeof v is 'function'
_isNonEmptyStr = (v) -> _isString(v) and v.length > 0
_isThenable    = (v) -> v? and typeof v?.then is 'function'
_isCacheLike   = (v) -> v? and _isFunction(v?.get) and _isFunction(v?.set)

_toInt = (v, d = 0) ->
  n = parseInt v, 10
  if Number.isFinite(n) then n else d

_clamp    = (v, lo, hi) -> Math.max lo, Math.min hi, v
_cleanStr = (v) ->
  return '' unless _isString v
  v.replace(/\s+/g, ' ').trim()

_hasAudioExt = (path) ->
  return false unless _isString path
  m = /\.([a-z0-9]+)$/i.exec path
  m? and AUDIO_EXT_SET.has m[1].toLowerCase()

# Wrap a resolved value for the cache: real values pass through, null/undefined
# become the sentinel so missing-resource lookups are cached until TTL expiry.
_toCacheValue = (v) -> if v? then v else CACHE_NULL

# ── Coercers for schema-driven TrackDTO ──────────────────────────────────

_coerceString         = (v) -> if v? then String v else null
_coerceCleanStr       = (v) -> _cleanStr(v) or 'Untitled'
_coerceCleanStrOrNull = (v) ->
  s = _cleanStr v
  if s.length > 0 then s else null
_coerceInt0    = (v) -> _toInt v, 0
_coerceIntNull = (v) -> _toInt v, null
_coerceBool    = (v) -> !!v

# ── TrackDTO ──────────────────────────────────────────────────────────────
#
# FIELD_SCHEMA is the single source of truth for field names, defaults,
# coercers, and upstream row-key aliases. Constructor, fromRow, and toPlain
# all derive from it; adding/removing a field is a one-line edit here.

FIELD_SCHEMA = [
  # [name, default, coercer, rowAliases]
  ['id',          null,         _coerceString,         ['id']]
  ['sourceType',  'local',      _coerceString,         ['sourceType', 'source_type', 'source']]
  ['externalId',  null,         _coerceString,         ['externalId', 'external_id']]
  ['title',       'Untitled',   _coerceCleanStr,       ['title', 'name']]
  ['artist',      null,         _coerceCleanStrOrNull, ['artist']]
  ['album',       null,         _coerceCleanStrOrNull, ['album']]
  ['durationSec', 0,            _coerceInt0,           ['durationSec', 'duration', 'duration_sec']]
  ['genre',       null,         _coerceCleanStrOrNull, ['genre']]
  ['url',         null,         _coerceString,         ['url']]
  ['localPath',   null,         _coerceString,         ['localPath', 'local_path']]
  ['coverUrl',    null,         _coerceString,         ['coverUrl', 'cover_url']]
  ['year',        null,         _coerceIntNull,        ['year']]
  ['isFavorite',  false,        _coerceBool,           ['isFavorite', 'is_favorite']]
  ['playCount',   0,            _coerceInt0,           ['playCount', 'play_count']]
]

class TrackDTO
  constructor: (fields = {}) ->
    f = if _isPlainObject(fields) then fields else {}
    for [name, defaultVal, coercer] in FIELD_SCHEMA
      @[name] = if f[name]? then coercer f[name] else defaultVal

  @fromRow: (row, sourceTypeOverride) ->
    return new TrackDTO(title: 'Untitled') unless _isPlainObject row
    fields = {}
    for [name, , , aliases] in FIELD_SCHEMA
      for alias in aliases
        if row[alias]? then fields[name] = row[alias]; break
    fields.sourceType = sourceTypeOverride if sourceTypeOverride?
    new TrackDTO fields

  toPlain: ->
    Object.fromEntries ([name, @[name]] for [name] in FIELD_SCHEMA)

  toJSON: -> @toPlain()

# ── BaseSourceAdapter ────────────────────────────────────────────────────

class BaseSourceAdapter
  constructor: (opts = {}) ->
    o = if _isPlainObject(opts) then opts else {}
    @cache = if _isCacheLike(o.cache)
      o.cache
    else
      new SimpleCache DEFAULTS.cacheSize, DEFAULTS.cacheTtlMs
    @logger = @_resolveLogger o.logger

  _resolveLogger: (logger) ->
    return console unless _isPlainObject logger
    if _isFunction(logger.debug) and _isFunction(logger.warn) and _isFunction(logger.error)
      logger
    else
      console

  getSourceType: -> throw new Error 'Subclasses must implement getSourceType()'
  isAvailable:   -> true

  # Uniform cache-key builder. Subclasses call @_cacheKey 'search', q, limit
  # rather than hand-rolling string templates.
  _cacheKey: (kind, rest...) ->
    "#{@getSourceType()}:#{kind}:#{rest.join ':'}"

  ###
  # Cache helper with async deduplication and null-result caching.
  #
  # Sync path: computeFn returns a plain value -- cached immediately.
  # Async path: computeFn returns a thenable:
  #   1. A normalized promise is cached so concurrent callers share one
  #      request (deduplication).
  #   2. On resolution, the cache entry is upgraded to the resolved value.
  #   3. On rejection, the entry is evicted so transient failures don't
  #      poison the cache permanently.
  # Null/undefined results are cached via the CACHE_NULL sentinel; callers
  # always receive null (never undefined). When key is absent or non-string,
  # caching is bypassed entirely and computeFn is invoked directly (errors
  # swallowed with log + fallback).
  ###
  _cached: (key, computeFn) ->
    return null unless _isFunction computeFn

    # Bypass cache when key is unusable; still normalize the result.
    unless _isNonEmptyStr key
      try
        return computeFn() ? null
      catch err
        return @_swallow err, null

    hit = @cache.get key
    return (if hit is CACHE_NULL then null else hit) if hit?

    try
      value = computeFn()
    catch err
      return @_swallow err, null

    if _isThenable value
      normalizedPromise = value.then(
        (result) =>
          normalized = result ? null
          @cache.set key, _toCacheValue normalized
          normalized
        (err) =>
          @cache.delete? key
          @_swallow err, null
          null
      )
      @cache.set key, normalizedPromise
      normalizedPromise
    else
      normalized = value ? null
      @cache.set key, _toCacheValue normalized
      normalized

  _swallow: (err, fallback) ->
    try
      @logger.warn "[#{@getSourceType()}] adapter error", err?.message ? String(err)
    catch _
    fallback

  clearCache: (key) ->
    if _isNonEmptyStr key then @cache.delete? key else @cache.clear?()
    return

  _normalizeQuery: (query) -> _cleanStr query

  _resolveLimit: (opts, fallback) ->
    if _isPlainObject(opts) and _isPositiveInt(opts.limit) then opts.limit else fallback

  # Default no-op implementations; subclasses override as needed.
  search:           (query, opts = {}) -> []
  resolveStreamUrl: (externalId)       -> null
  getTrackById:     (externalId)       -> null

# ── LocalFileAdapter ─────────────────────────────────────────────────────

class LocalFileAdapter extends BaseSourceAdapter
  constructor: (opts = {}) ->
    super opts
    @_files = new Map()
    @setFiles opts.files if _isArray opts?.files

  getSourceType: -> SOURCE_TYPES.local
  isAvailable:   -> typeof window isnt 'undefined'

  setFiles: (rows) ->
    @clearCache()
    @_files.clear()
    return @_files.size unless _isArray rows
    for r in rows when _isPlainObject r
      dto = TrackDTO.fromRow r, SOURCE_TYPES.local
      dto.localPath ?= dto.url ? "local:#{dto.title}" unless _isNonEmptyStr dto.localPath
      key = dto.externalId ? dto.localPath
      @_files.set String(key), dto if key?
    @_files.size

  search: (query, opts = {}) ->
    q = @_normalizeQuery(query).toLowerCase()
    limit = @_resolveLimit opts, DEFAULTS.localLimit
    @_cached @_cacheKey('search', q, limit), =>
      all = Array.from @_files.values()
      matched = if q.length is 0
        all
      else
        all.filter (dto) ->
          "#{dto.title} #{dto.artist ? ''} #{dto.album ? ''}".toLowerCase().includes q
      matched.slice(0, limit).map (dto) -> dto.toPlain()

  resolveStreamUrl: (externalId) ->
    return null unless _isNonEmptyStr externalId
    hit = @_files.get externalId
    hit?.url ? hit?.localPath ? null

  getTrackById: (externalId) ->
    return null unless _isNonEmptyStr externalId
    hit = @_files.get externalId
    if hit? then hit.toPlain() else null

# ── RemoteSearchAdapter ──────────────────────────────────────────────────

class RemoteSearchAdapter extends BaseSourceAdapter
  constructor: (opts = {}) ->
    super opts
    @_searchFn  = if _isFunction(opts?.searchFn)  then opts.searchFn  else null
    @_resolveFn = if _isFunction(opts?.resolveFn) then opts.resolveFn else null
    @_fakeCount = _toInt opts?.fakeCount, DEFAULTS.fakeRowCount

  _fakeRow: (q, i) ->
    title:       "#{q} (#{@getSourceType()} #{i + 1})"
    externalId:  "#{@getSourceType().charAt 0}_#{i}"
    durationSec: 180 + i * 10

  _runSearch: (q, limit) ->
    if @_searchFn?
      try
        rows = await @_searchFn q, limit
      catch err
        @_swallow err, null
        rows = []
    else
      rows = (@_fakeRow(q, i) for i in [0...Math.min limit, @_fakeCount])
    rows ? []

  async search: (query, opts = {}) ->
    q = @_normalizeQuery query
    return [] unless q.length > 0
    limit = @_resolveLimit opts, DEFAULTS.searchLimit
    @_cached @_cacheKey('search', q, limit), =>
      rows = await @_runSearch q, limit
      TrackDTO.fromRow(r, @getSourceType()).toPlain() for r in rows when _isPlainObject r

  async resolveStreamUrl: (externalId) ->
    return null unless _isNonEmptyStr externalId
    return await BaseSourceAdapter::resolveStreamUrl.call @, externalId unless @_resolveFn?
    @_cached @_cacheKey('stream', externalId), => await @_resolveFn externalId

# ── YouTubeAdapter ───────────────────────────────────────────────────────

class YouTubeAdapter extends RemoteSearchAdapter
  getSourceType: -> SOURCE_TYPES.youtube
  isAvailable:   -> typeof window isnt 'undefined'

  _fakeRow: (q, i) ->
    title:       "#{q} (YouTube #{i + 1})"
    artist:      'YouTube Artist'
    durationSec: 180 + ((q.length * 7 + i) % 240)
    externalId:  "yt_#{i}"
    url:         "https://www.youtube.com/results?search_query=#{encodeURIComponent q}"

# ── SpotifyAdapter ───────────────────────────────────────────────────────

class SpotifyAdapter extends RemoteSearchAdapter
  constructor: (opts = {}) ->
    super opts
    @accessToken = if _isNonEmptyStr opts?.accessToken then opts.accessToken else null
    @client      = if _isPlainObject opts?.client      then opts.client      else null
    if not @_searchFn? and @client?.search? and _isFunction @client.search
      @_searchFn = (q, limit) => @client.search q, limit

  getSourceType: -> SOURCE_TYPES.spotify
  isAvailable:   -> @accessToken? or @client? or @_searchFn?

  _fakeRow: (q, i) ->
    title:       "#{q} (Spotify #{i + 1})"
    artist:      'Spotify Artist'
    album:       'Spotify Album'
    durationSec: 200 + i * 10
    externalId:  "sp_#{i}"

# ── SoundCloudAdapter ────────────────────────────────────────────────────

class SoundCloudAdapter extends RemoteSearchAdapter
  getSourceType: -> SOURCE_TYPES.soundcloud
  isAvailable:   -> typeof window isnt 'undefined'

  _fakeRow: (q, i) ->
    title:       "#{q} (SoundCloud #{i + 1})"
    artist:      'SoundCloud Creator'
    durationSec: 240 + i * 7
    externalId:  "sc_#{i}"

# ── SourceAdapterRegistry ────────────────────────────────────────────────

class SourceAdapterRegistry
  constructor: -> @_adapters = new Map()

  @withDefaults: (opts = {}) ->
    reg = new SourceAdapterRegistry()
    reg.register new LocalFileAdapter   opts?.local
    reg.register new YouTubeAdapter     opts?.youtube
    reg.register new SpotifyAdapter     opts?.spotify
    reg.register new SoundCloudAdapter  opts?.soundcloud
    reg

  register: (adapter) ->
    throw new TypeError 'Expected BaseSourceAdapter instance' \
      unless adapter instanceof BaseSourceAdapter
    type = adapter.getSourceType()
    throw new Error 'Adapter returned invalid source type' unless _isNonEmptyStr type
    @_adapters.set type, adapter
    @

  unregister: (type) ->
    if _isNonEmptyStr type then @_adapters.delete type else false

  get: (type) ->
    return null unless _isNonEmptyStr type
    @_adapters.get(type) ? null

  has: (type) -> _isNonEmptyStr(type) and @_adapters.has type

  sourceTypes: -> Array.from @_adapters.keys()

  listAvailable: ->
    Object.fromEntries ([t, a.isAvailable()] for [t, a] from @_adapters)

  listAdapters: -> Array.from @_adapters.values()

  getAdapterForTrack: (track) ->
    return null unless _isPlainObject(track) and _isNonEmptyStr track?.sourceType
    @get track.sourceType

  ###
  # Aggregate search across every available adapter in parallel, deduplicate
  # by sourceType + externalId/id/url, and respect the overall limit.
  # The `source` option accepts a single source-type string or an array to
  # restrict which adapters are queried.
  ###
  async searchAll: (query, opts = {}) ->
    q = _cleanStr query
    return [] unless q.length > 0
    o = if _isPlainObject(opts) then opts else {}

    sourceFilter = switch
      when _isNonEmptyStr o.source then [o.source]
      when _isArray(o.source) and o.source.length > 0
        filtered = (s for s in o.source when _isNonEmptyStr s)
        if filtered.length then filtered else null
      else null

    limit = if _isPositiveInt(o.limit) then o.limit else DEFAULTS.aggregateLimit
    perSourceLimit = if sourceFilter?
      limit
    else
      _clamp Math.ceil(limit / Math.max 1, @_adapters.size), 1, 50

    adapters = @listAdapters().filter (a) ->
      a.isAvailable() and (not sourceFilter? or a.getSourceType() in sourceFilter)

    settled = await Promise.allSettled adapters.map (a) -> a.search q, limit: perSourceLimit

    seen = new Set()
    out  = []
    for result in settled
      if result.status is 'rejected'
        @_logSearchError result.reason
        continue
      rows = result.value
      continue unless _isArray rows
      for r in rows when _isPlainObject r
        dedupKey = "#{r.sourceType}::#{r.externalId ? r.id ? r.url}"
        continue if seen.has dedupKey
        seen.add dedupKey
        out.push r
        break if out.length >= limit
      break if out.length >= limit
    out

  _logSearchError: (err) ->
    try
      console.warn '[SourceAdapterRegistry] searchAll error', err?.message ? String err
    catch _

module.exports =
  TrackDTO:              TrackDTO
  BaseSourceAdapter:     BaseSourceAdapter
  RemoteSearchAdapter:   RemoteSearchAdapter
  LocalFileAdapter:      LocalFileAdapter
  YouTubeAdapter:        YouTubeAdapter
  SpotifyAdapter:        SpotifyAdapter
  SoundCloudAdapter:     SoundCloudAdapter
  SourceAdapterRegistry: SourceAdapterRegistry
  AUDIO_EXTS:            AUDIO_EXTS
  AUDIO_EXT_SET:         AUDIO_EXT_SET
  hasAudioExt:           _hasAudioExt
  DEFAULTS:              DEFAULTS
  FIELD_SCHEMA:          FIELD_SCHEMA
  SOURCE_TYPES:          SOURCE_TYPES
  CACHE_NULL:            CACHE_NULL
