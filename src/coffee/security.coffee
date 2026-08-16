###
# SecurityManager — Authenticated encryption (AES-GCM/CBC), scrypt password
# hashing, JWT algorithm pinning, sliding-window rate limiting, HMAC utilities,
# and helpers for secure storage and safe logging.
#
# Constructor options:
#   secretKey         — Buffer or hex string of correct length (auto-generated
#                        if falsy; non-hex strings derived via scrypt with caveats)
#   logger            — optional { debug, info, warn, error } logger object
#   scryptOptions     — { N, r, p } for scrypt (defaults: N=16384, r=8, p=1)
#   algorithm         — cipher algorithm (default 'aes-256-gcm')
#   ivLength          — override IV bytes (default: 12 for GCM, 16 for CBC)
#   saltLength        — scrypt salt bytes (default 16)
#   scryptKeyLength   — scrypt output bytes (default 64)
#   legacyHmacKey     — set true to decrypt CBC data created by v1.x which used
#                        SHA-256(label‖key) instead of HMAC-SHA256(key, label)
#   redactInspect     — hide algorithm name from inspect()/toJSON() (default true)
###

crypto = require 'crypto'
{ promisify } = require 'util'

scryptAsync = promisify crypto.scrypt

# ── Lazy-loaded optional dependency ──────────────────────────────────────────
_jwtLoader = ->
  try require 'jsonwebtoken'
  catch
    null

# ── Type guards ──────────────────────────────────────────────────────────────
isString         = (v) -> typeof v is 'string'
isNonEmptyString = (v) -> isString(v) and v.length > 0
isBuffer         = (v) -> Buffer.isBuffer v
isPlainObject    = (v) -> v? and typeof v is 'object' and not Array.isArray v
isPositiveInt    = (v) -> Number.isInteger(v) and v > 0
isFunction       = (v) -> typeof v is 'function'

# Even-length hex only — prevents silent truncation by Buffer.from(_, 'hex')
HEX_EVEN_RE = /^(?:[0-9a-fA-F]{2})+$/
BASE64_RE   = /^[A-Za-z0-9+/]+={0,2}$/
GCM_RE      = /gcm/i

# Pre-compiled sensitive-key regex (compiled once, reused per walk)
SENSITIVE_RE = ///(?:
    password | passwd | pwd | secret | token
  | api[_-]?key | private[_-]?key | jwt
  | session | cookie | auth | credential
  | ssn | social[_-]?sec
  | credit[_-]?card | card[_-]?num | cvv
  | access[_-]?code | pin | bearer
)///i

# ── Error classes ────────────────────────────────────────────────────────────
class SecurityError extends Error
  constructor: (msg = 'Security error', cause = null) ->
    super msg
    @name = @constructor.name
    @cause = cause if cause?
    Error.captureStackTrace? @, @constructor

class EncryptionError extends SecurityError
  constructor: (msg = 'Encryption failed', cause = null) -> super msg, cause

class DecryptionError extends SecurityError
  constructor: (msg = 'Decryption failed', cause = null) -> super msg, cause

class HashingError extends SecurityError
  constructor: (msg = 'Hashing failed', cause = null) -> super msg, cause

class KeyLengthError extends SecurityError
  constructor: (expected, actual) ->
    super "Invalid key length: expected #{expected} bytes, got #{actual}"

class CSRFTokenError extends SecurityError
  constructor: (msg = 'Invalid or missing CSRF token') -> super msg

class RateLimitError extends SecurityError
  constructor: (key, retryMs) ->
    super if isPositiveInt retryMs
      "Rate limit exceeded for '#{key}'. Retry after #{retryMs} ms."
    else
      "Rate limit exceeded for '#{key}'."
    @retryAfterMs = retryMs

# ── Algorithm / key utilities ────────────────────────────────────────────────
SUPPORTED_ALGORITHMS = Object.freeze new Set [
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm'
  'aes-128-cbc', 'aes-192-cbc', 'aes-256-cbc'
]

KEY_LENGTHS = { 128: 16, 192: 24, 256: 32 }

isGCM        = (algo) -> GCM_RE.test algo
keyLengthFor = (algo) -> KEY_LENGTHS[/^aes-(\d+)-/.exec(algo)?[1]] ? 32
ivLengthFor  = (algo) -> if isGCM algo then 12 else 16

DEFAULT_SCRYPT_OPTIONS = Object.freeze { N: 16384, r: 8, p: 1 }

HMAC_KEY_LABEL = 'SecurityManager-HMAC-Key-Derivation'

PASSPHRASE_SALT = Buffer.from(
  '53656375726974794d616e61676572204b65792044657269766174696f6e2053616c74', 'hex'
)

# ── Small shared helpers ─────────────────────────────────────────────────────
validateScryptOpts = (opts = {}) ->
  { N, r, p } = opts
  unless isPositiveInt(N) and N >= 2 and (N & (N - 1)) is 0
    throw new HashingError "scrypt N must be a power of 2 ≥ 2; got #{N}"
  unless isPositiveInt r
    throw new HashingError "scrypt r must be a positive integer; got #{r}"
  unless isPositiveInt p
    throw new HashingError "scrypt p must be a positive integer; got #{p}"
  return

mergeScryptOpts = (overrides = {}) ->
  { ...DEFAULT_SCRYPT_OPTIONS, ...(if isPlainObject overrides then overrides else {}) }

parseSalt = (salt, defaultLength = 16) ->
  return salt if isBuffer salt
  if isNonEmptyString(salt) and HEX_EVEN_RE.test salt
    return Buffer.from salt, 'hex'
  crypto.randomBytes defaultLength

coerceKey = (secretKey, keyLen, logger) ->
  if isBuffer secretKey
    return secretKey if secretKey.length is keyLen
    throw new KeyLengthError keyLen, secretKey.length

  if isNonEmptyString secretKey
    if HEX_EVEN_RE.test secretKey
      buf = Buffer.from secretKey, 'hex'
      return buf if buf.length is keyLen
      throw new KeyLengthError keyLen, buf.length
    logger?.warn? '[SecurityManager] Warning: passphrase-derived key — provide proper hex key for production'
    return crypto.scryptSync secretKey, PASSPHRASE_SALT, keyLen, DEFAULT_SCRYPT_OPTIONS

  logger?.warn? '[SecurityManager] No secretKey provided — ephemeral key generated (not persistable across restarts)'
  crypto.randomBytes keyLen

# Constant-time comparison with length smoothing.
constantTimeCompare = (bufA, bufB) ->
  if bufA.length isnt bufB.length
    crypto.timingSafeEqual bufA, bufA
    return false
  crypto.timingSafeEqual bufA, bufB

# Zero-fill a Buffer defensively (no-op on null/undefined).
zeroBuffer = (buf) ->
  return unless buf?
  try buf.fill 0
  return

# ── SecurityManager ─────────────────────────────────────────────────────────
class SecurityManager

  @SecurityError    = SecurityError
  @EncryptionError  = EncryptionError
  @DecryptionError  = DecryptionError
  @HashingError     = HashingError
  @KeyLengthError   = KeyLengthError
  @CSRFTokenError   = CSRFTokenError
  @RateLimitError   = RateLimitError
  @VERSION          = '2.4.0'

  # ── Static: key derivation ─────────────────────────────────────────────────
  @deriveKeyFromPassphrase: (passphrase, salt = null, scryptOpts = {}, keyLength = 32) ->
    @_deriveKey 'deriveKeyFromPassphrase', passphrase, salt, scryptOpts, keyLength, false

  @deriveKeyFromPassphraseSync: (passphrase, salt = null, scryptOpts = {}, keyLength = 32) ->
    @_deriveKey 'deriveKeyFromPassphraseSync', passphrase, salt, scryptOpts, keyLength, true

  @_deriveKey: (fnName, passphrase, salt, scryptOpts, keyLength, sync) ->
    unless isNonEmptyString passphrase
      throw new HashingError "#{fnName}: passphrase must be a non-empty string"
    unless isPositiveInt keyLength
      throw new HashingError "#{fnName}: keyLength must be a positive integer"
    merged = mergeScryptOpts scryptOpts
    validateScryptOpts merged
    saltBuf = parseSalt salt
    if sync
      derived = crypto.scryptSync passphrase, saltBuf, keyLength, merged
      { key: derived.toString('hex'), salt: saltBuf.toString('hex') }
    else
      scryptAsync(passphrase, saltBuf, keyLength, merged).then (derived) ->
        { key: derived.toString('hex'), salt: saltBuf.toString('hex') }

  @generateKey: (bytes = 32) ->
    n = if isPositiveInt bytes then bytes else 32
    crypto.randomBytes(n).toString 'hex'

  @secureCompare: (a, b) ->
    return false unless (isString(a) or isBuffer(a)) and (isString(b) or isBuffer(b))
    bufA = if isBuffer a then a else Buffer.from a, 'utf8'
    bufB = if isBuffer b then b else Buffer.from b, 'utf8'
    constantTimeCompare bufA, bufB

  # ── Constructor ────────────────────────────────────────────────────────────
  constructor: (secretKey, opts = {}) ->
    opts = if isPlainObject opts then opts else {}
    @_initAlgorithm opts
    @_initScrypt opts
    @_legacyHmacKey = opts.legacyHmacKey is true
    @_redactInspect = opts.redactInspect ? true
    @_configureLogger opts.logger
    @_warnIfUnsupportedAlgo()

    try
      @keyBuffer = coerceKey secretKey, @aesKeyLength, @logger
    catch err
      @logger.error '[SecurityManager] key validation failed:', err?.message
      throw err

    @_hmacKeyBuf       = null
    @_rateLimitBuckets = new Map()
    @_destroyed        = false
    @_inflightAsync    = 0

  _initAlgorithm: (opts) ->
    algo = if isNonEmptyString opts.algorithm
      opts.algorithm.toLowerCase()
    else
      'aes-256-gcm'

    @_algorithm     = algo
    @_aesKeyLength  = keyLengthFor algo
    @_isGCM         = isGCM algo
    @_ivLength      = if isPositiveInt opts.ivLength then opts.ivLength else ivLengthFor algo

  _initScrypt: (opts) ->
    @_saltLength     = if isPositiveInt opts.saltLength     then opts.saltLength     else 16
    @_scryptKeyLength = if isPositiveInt opts.scryptKeyLength then opts.scryptKeyLength else 64
    @_scryptOptions  = mergeScryptOpts opts.scryptOptions
    validateScryptOpts @_scryptOptions

  _warnIfUnsupportedAlgo: ->
    return if SUPPORTED_ALGORITHMS.has @_algorithm
    @logger?.warn? "[SecurityManager] Algorithm '#{@_algorithm}' is not in the supported set — decryption may fail"

  _configureLogger: (custom) ->
    if isPlainObject(custom) and ['debug','info','warn','error'].every (m) -> isFunction custom[m]
      @logger = custom
    else
      @logger = console

  # ── Read-only accessors ────────────────────────────────────────────────────
  Object.defineProperties @prototype,
    algorithm:       { enumerable: true, get: -> @_algorithm }
    aesKeyLength:    { enumerable: true, get: -> @_aesKeyLength }
    ivLength:        { enumerable: true, get: -> @_ivLength }
    saltLength:      { enumerable: true, get: -> @_saltLength }
    scryptKeyLength: { enumerable: true, get: -> @_scryptKeyLength }
    scryptOptions:   { enumerable: true, get: -> Object.freeze { ...@_scryptOptions } }
    legacyHmacKey:   { enumerable: true, get: -> @_legacyHmacKey }
    isDestroyed:     { enumerable: true, get: -> @_destroyed }

  inspect: -> if @_redactInspect then '[SecurityManager]' else "[SecurityManager algorithm=#{@_algorithm}]"
  toJSON:  ->
    if @_redactInspect
      { type: 'SecurityManager', version: SecurityManager.VERSION }
    else
      { type: 'SecurityManager', algorithm: @_algorithm, version: SecurityManager.VERSION }

  _ensureNotDestroyed: ->
    throw new SecurityError 'SecurityManager instance has been destroyed' if @_destroyed

  # ── HMAC key derivation ────────────────────────────────────────────────────
  _hmacKey: ->
    return @_hmacKeyBuf if @_hmacKeyBuf?
    if @_legacyHmacKey
      @_hmacKeyBuf = crypto.createHash('sha256').update(HMAC_KEY_LABEL).update(@keyBuffer).digest()
    else
      @_hmacKeyBuf = crypto.createHmac('sha256', @keyBuffer).update(HMAC_KEY_LABEL).digest()
    @_hmacKeyBuf

  generateKey: -> crypto.randomBytes(@_aesKeyLength).toString 'hex'

  _pepperInput: (data, pepper) ->
    if pepper? then "#{data}:#{pepper}" else data

  # ── Encryption: shared internal helpers ────────────────────────────────────
  _formatEncrypted: (iv, body, tagOrMac) ->
    if @_isGCM
      "#{iv.toString 'base64url'}:#{tagOrMac.toString 'base64url'}:#{body.toString 'base64url'}"
    else
      "#{iv.toString 'base64url'}:#{body.toString 'base64url'}:#{tagOrMac.toString 'base64url'}"

  _parseEncrypted: (text) ->
    parts = text.split ':'
    return null unless parts.length is 3
    [ a, b, c ] = parts
    return null unless a and b and c
    iv   = Buffer.from a, 'base64url'
    if @_isGCM
      { iv, tag: Buffer.from(b, 'base64url'), body: Buffer.from(c, 'base64url') }
    else
      { iv, body: Buffer.from(b, 'base64url'), mac: Buffer.from(c, 'base64url') }

  _encryptInternal: (raw) ->
    iv     = crypto.randomBytes @_ivLength
    cipher = crypto.createCipheriv @_algorithm, @keyBuffer, iv
    enc    = Buffer.concat [ cipher.update(raw, 'utf8'), cipher.final() ]
    if @_isGCM
      tag = cipher.getAuthTag()
      @_formatEncrypted iv, enc, tag
    else
      mac = crypto.createHmac('sha256', @_hmacKey()).update(iv).update(enc).digest()
      @_formatEncrypted iv, enc, mac

  _decryptInternal: (parsed) ->
    { iv, body } = parsed
    if @_isGCM
      { tag } = parsed
      decipher = crypto.createDecipheriv @_algorithm, @keyBuffer, iv
      decipher.setAuthTag tag
      Buffer.concat [ decipher.update(body), decipher.final() ]
    else
      { mac } = parsed
      expected = crypto.createHmac('sha256', @_hmacKey()).update(iv).update(body).digest()
      throw new DecryptionError 'HMAC verification failed — data may be tampered' \
        unless constantTimeCompare expected, mac
      decipher = crypto.createDecipheriv @_algorithm, @keyBuffer, iv
      Buffer.concat [ decipher.update(body), decipher.final() ]

  # ── Encryption: public API ─────────────────────────────────────────────────
  encrypt: (plaintext) ->
    @_ensureNotDestroyed()
    try
      throw new EncryptionError 'Cannot encrypt null or undefined' unless plaintext?
      raw = if isString plaintext then plaintext else JSON.stringify plaintext
      throw new EncryptionError 'Empty payload — nothing to encrypt' unless isNonEmptyString raw
      @_encryptInternal raw
    catch err
      throw err if err instanceof SecurityError
      @logger.error '[SecurityManager.encrypt] failed:', err?.message
      throw new EncryptionError err?.message or 'Unknown encryption error', err

  decrypt: (encryptedText) ->
    @_ensureNotDestroyed()
    unless isNonEmptyString encryptedText
      @logger.debug '[SecurityManager.decrypt] rejected: non-string or empty input'
      return null
    try
      parsed = @_parseEncrypted encryptedText
      unless parsed?
        @logger.warn '[SecurityManager.decrypt] rejected: malformed payload'
        return null
      plain = @_decryptInternal parsed
      plainStr = plain.toString 'utf8'
      try JSON.parse plainStr catch then plainStr
    catch err
      @logger.warn '[SecurityManager.decrypt] failed:', err?.message or 'unknown'
      null

  decryptOrThrow: (encryptedText) ->
    unless isNonEmptyString encryptedText
      throw new DecryptionError 'Non-string or empty input'
    try
      parsed = @_parseEncrypted encryptedText
      throw new DecryptionError 'Malformed payload — expected 3 colon-separated base64 segments' unless parsed?
      plain = @_decryptInternal parsed
    catch err
      throw err if err instanceof SecurityError
      throw new DecryptionError err?.message or 'Unknown decryption error', err
    plainStr = plain.toString 'utf8'
    try JSON.parse plainStr catch then plainStr

  isEncryptedFormat: (text) ->
    return false unless isNonEmptyString text
    parts = text.split ':'
    parts.length is 3 and parts.every (p) -> isNonEmptyString(p)

  peekEncrypted: (text) ->
    return null unless @isEncryptedFormat text
    { iv } = @_parseEncrypted text
    { ivLength: iv.length, hasTag: @_isGCM, hasMac: not @_isGCM }

  getEncryptionInfo: ->
    algorithm: @_algorithm
    aesKeyLength: @_aesKeyLength
    ivLength: @_ivLength
    isGCM: @_isGCM
    legacyHmacKey: @_legacyHmacKey
    version: SecurityManager.VERSION

  rotateKey: (newKey) ->
    @_ensureNotDestroyed()
    old = @keyBuffer
    try
      @keyBuffer = coerceKey newKey, @_aesKeyLength, @logger
    catch err
      @keyBuffer = old  # rollback
      throw err
    @_hmacKeyBuf = null
    @logger.info '[SecurityManager] Encryption key rotated'
    zeroBuffer old
    return

  destroy: ->
    return if @_destroyed
    @_destroyed = true
    zeroBuffer @keyBuffer
    @keyBuffer = null
    zeroBuffer @_hmacKeyBuf
    @_hmacKeyBuf = null
    @_rateLimitBuckets.clear()
    @logger.info '[SecurityManager] Instance destroyed — key material zeroed'
    return

  # Optional `using` semantics (TC39 explicit-resource-management)
  if Symbol.dispose?
    @prototype[Symbol.dispose] = -> @destroy()
  if Symbol.asyncDispose?
    @prototype[Symbol.asyncDispose] = -> @destroy(); Promise.resolve()

  # ── Hashing ────────────────────────────────────────────────────────────────
  hash:     (data, salt = null, pepper = null) -> @_hash data, salt, pepper, false
  hashSync: (data, salt = null, pepper = null) -> @_hash data, salt, pepper, true

  _scryptDerive: (fnName, input, saltBuf, sync) ->
    if sync
      crypto.scryptSync input, saltBuf, @_scryptKeyLength, @_scryptOptions
    else
      scryptAsync input, saltBuf, @_scryptKeyLength, @_scryptOptions

  _hash: (data, salt, pepper, sync) ->
    fnName = if sync then 'hashSync' else 'hash'
    try
      throw new HashingError "#{fnName}() input must be a string" unless isString data
      saltBuf = parseSalt salt, @_saltLength
      input   = @_pepperInput data, pepper
      if sync
        derived = @_scryptDerive fnName, input, saltBuf, sync
        throw new HashingError 'scrypt produced unexpected output' \
          unless isBuffer(derived) and derived.length is @_scryptKeyLength
        "#{saltBuf.toString 'hex'}:#{derived.toString 'hex'}"
      else
        @_inflightAsync++
        try
          derived = await @_scryptDerive fnName, input, saltBuf, sync
          throw new HashingError 'scrypt produced unexpected output' \
            unless isBuffer(derived) and derived.length is @_scryptKeyLength
          "#{saltBuf.toString 'hex'}:#{derived.toString 'hex'}"
        finally
          @_inflightAsync--

    catch err
      throw err if err instanceof SecurityError
      @logger.error "[SecurityManager.#{fnName}] failed:", err?.message
      throw new HashingError err?.message or 'Hashing failed', err

  verifyHash:     (data, hashedData, pepper = null) -> @_verifyHash data, hashedData, pepper, false
  verifyHashSync: (data, hashedData, pepper = null) -> @_verifyHash data, hashedData, pepper, true

  _verifyHash: (data, hashedData, pepper, sync) ->
    fnName = if sync then 'verifyHashSync' else 'verifyHash'
    try
      return false unless isString data
      return false unless isString(hashedData) and hashedData.includes ':'
      [ saltHex, expectedHex ] = hashedData.split ':'
      return false unless saltHex? and expectedHex?
      saltBuf  = Buffer.from saltHex,     'hex'
      expected = Buffer.from expectedHex, 'hex'
      input    = @_pepperInput data, pepper
      if sync
        derived = @_scryptDerive fnName, input, saltBuf, sync
        return false unless derived.length is expected.length
        constantTimeCompare derived, expected
      else
        @_inflightAsync++
        try
          derived = await @_scryptDerive fnName, input, saltBuf, sync
          return false unless derived.length is expected.length
          constantTimeCompare derived, expected
        finally
          @_inflightAsync--
    catch err
      @logger.warn "[SecurityManager.#{fnName}] failed:", err?.message
      false

  # ── Sliding window rate limiting ───────────────────────────────────────────
  checkRateLimit: (key, maxRequests, windowMs) ->
    @_ensureNotDestroyed()
    unless isNonEmptyString(key) and isPositiveInt(maxRequests) and isPositiveInt(windowMs)
      throw new RateLimitError 'Invalid rate limit parameters'
    now = Date.now()
    windowStart = now - windowMs
    bucket = @_rateLimitBuckets.get(key) ? []
    bucket = bucket.filter (ts) -> ts > windowStart
    if bucket.length >= maxRequests
      oldestRequest = Math.min(...bucket)
      retryMs = oldestRequest + windowMs - now
      throw new RateLimitError(key, Math.max(0, retryMs))
    bucket.push now
    @_rateLimitBuckets.set(key, bucket)
    if @_rateLimitBuckets.size > 10000
      @_cleanupRateLimitBuckets windowMs
    true

  _cleanupRateLimitBuckets: (windowMs) ->
    now = Date.now()
    cutoff = now - windowMs
    for [key, timestamps] from @_rateLimitBuckets.entries()
      active = timestamps.filter (ts) -> ts > cutoff
      if active.length is 0
        @_rateLimitBuckets.delete key

  # ── Safe logging utilities ────────────────────────────────────────────────
  redactSensitive: (obj, replacer = '[REDACTED]') ->
    return obj unless isPlainObject obj
    result = {}
    for k, v of obj
      if SENSITIVE_RE.test k
        result[k] = replacer
      else if isPlainObject v
        result[k] = @redactSensitive v, replacer
      else if Array.isArray v
        result[k] = v.map (item) -> if isPlainObject(item) then @redactSensitive(item, replacer) else item
      else
        result[k] = v
    result

  # ── Tokens ─────────────────────────────────────────────────────────────────
  generateToken: (lengthBytes = 32) ->
    n = if isPositiveInt lengthBytes then lengthBytes else 32
    crypto.randomBytes(n).toString 'hex'

  generateCSRFToken: -> crypto.randomBytes(16).toString 'base64url'

  verifyCSRFToken: (expected, actual) ->
    unless isNonEmptyString(expected) and isNonEmptyString(actual)
      throw new CSRFTokenError 'Both expected and actual tokens must be non-empty strings'
    SecurityManager.secureCompare expected, actual

  # ── JWT ────────────────────────────────────────────────────────────────────
  signSecureJWT: (payload, jwtSecret, options = {}) ->
    jwt = _jwtLoader()
    unless jwt?
      throw new SecurityError 'jsonwebtoken not installed; install it to use JWT features'
    @_ensureNotDestroyed()
    unless isPlainObject(payload)
      throw new SecurityError 'JWT payload must be an object'
    unless isNonEmptyString(jwtSecret) or isBuffer(jwtSecret)
      throw new SecurityError 'jwtSecret must be a non-empty string or Buffer'
    
    defaultOpts = 
      algorithm: 'HS256'
      expiresIn: '1h'
    mergedOpts = { ...defaultOpts, ...options }
    allowedAlgos = new Set ['HS256', 'HS384', 'HS512']
    unless allowedAlgos.has mergedOpts.algorithm
      throw new SecurityError "Unsupported JWT algorithm: #{mergedOpts.algorithm}. Use one of: #{Array.from(allowedAlgos).join(', ')}"
    
    jwt.sign payload, jwtSecret, mergedOpts

  verifySecureJWT: (token, jwtSecret, options = {}) ->
    jwt = _jwtLoader()
    unless jwt?
      throw new SecurityError 'jsonwebtoken not installed; install it to use JWT features'
    @_ensureNotDestroyed()
    unless isNonEmptyString(token)
      throw new SecurityError 'JWT token must be a non-empty string'
    unless isNonEmptyString(jwtSecret) or isBuffer(jwtSecret)
      throw new SecurityError 'jwtSecret must be a non-empty string or Buffer'
    
    defaultOpts =
      algorithms: ['HS256', 'HS384', 'HS512']
    mergedOpts = { ...defaultOpts, ...options }
    
    try
      jwt.verify token, jwtSecret, mergedOpts
    catch err
      throw new SecurityError 'JWT verification failed', err
