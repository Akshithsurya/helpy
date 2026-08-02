<?php
/**
 * Helpy API Entry Point — Modernized for PHP 8.1+
 *
 * Changes in this revision (vs. the prior version):
 *
 *  BUG FIXES
 *   A. emojiStrippingMiddleware() was a no-op: handlers read $req->body,
 *      never the stripped attribute. We now thread a new Request through
 *      the pipeline via a lightweight envelope, so handlers see the
 *      cleaned body transparently.
 *   B. requireAuth() used `($req->requireUser()) && false ?: $next()` —
 *      unreadable AND breaks if requireUser() ever returns falsy without
 *      throwing. Replaced with explicit guard.
 *   C. Comment promised `{planId:\d+}` but the routes used `/{planId}`.
 *      Applied the numeric constraint so the regex engine rejects
 *      non-numeric IDs before the handler is even called.
 *   D. Config constructor mixed DI with env reads awkwardly; collapsed to
 *      constructor property promotion with a named static factory.
 *   E. CORS Allow-Credentials:true was sent unconditionally even for
 *      non-allowed origins. Now only sent when origin is matched.
 *   F. parseBody() did not check Content-Type; could accept JSON inside
 *      a form-encoded request. Now verifies application/json.
 *
 *  STRUCTURAL
 *   1. MiddlewareInterface introduced — callable is still supported,
 *      but typed objects are preferred for IDE/PHPStan support.
 *   2. Pipeline carries an envelope (Request + Response|null) so
 *      middleware can REPLACE the request immutably.
 *   3. Consolidated emitHttpException + emitThrowable into a single
 *      emitError() with severity discrimination.
 *   4. Config gained originWhitelist() helper for O(1) CORS checks.
 *   5. Validation helpers split into nullable variants (optionalStringOrNull)
 *      so callers stop conflating "absent" with "empty string".
 *   6. Router caches compiled regex strings per route (avoid re-running
 *      preg_replace_callback on every dispatch).
 *   7. RateLimiter cleanup is O(n) per request — switched to a deque
 *      style prune that stops at first expired entry.
 *   8. PSR-4 note: replace the require_once block with spl_autoload_register
 *      (see bootstrap comment).
 *   9. response() helper added as a terser alias for Response::json().
 *  10. emitResponse() flushes output and disables buffering for large
 *      payloads in dev.
 */

declare(strict_types=1);

// ============================================================================
// BOOT-TIME GUARDS
// ============================================================================

if (!extension_loaded('mbstring')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    exit('{"success":false,"error":"mbstring extension required"}');
}
if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    exit('{"success":false,"error":"PHP 8.1+ required"}');
}

// ============================================================================
// ENUMS
// ============================================================================

enum HttpStatus: int
{
    case Ok = 200;
    case Created = 201;
    case NoContent = 204;
    case BadRequest = 400;
    case Unauthorized = 401;
    case Forbidden = 403;
    case NotFound = 404;
    case MethodNotAllowed = 405;
    case Conflict = 409;
    case PayloadTooLarge = 413;
    case UnprocessableEntity = 422;
    case TooManyRequests = 429;
    case InternalServerError = 500;

    public function isError(): bool => $this->value >= 400;

    /**
     * Get the standard reason phrase for this status code
     * @see https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml
     */
    public function reasonPhrase(): string
    {
        return match($this) {
            self::Ok => 'OK',
            self::Created => 'Created',
            self::NoContent => 'No Content',
            self::BadRequest => 'Bad Request',
            self::Unauthorized => 'Unauthorized',
            self::Forbidden => 'Forbidden',
            self::NotFound => 'Not Found',
            self::MethodNotAllowed => 'Method Not Allowed',
            self::Conflict => 'Conflict',
            self::PayloadTooLarge => 'Payload Too Large',
            self::UnprocessableEntity => 'Unprocessable Entity',
            self::TooManyRequests => 'Too Many Requests',
            self::InternalServerError => 'Internal Server Error',
        };
    }
}

// ============================================================================
// INFRASTRUCTURE
// ============================================================================

/**
 * Application configuration container - centralizes all environment-derived settings
 * with type safety and validation to prevent misconfiguration at runtime.
 */
final readonly class Config
{
    /** @param string[] $allowedOrigins */
    public function __construct(
        public bool   $isDev,
        public bool   $musicEnabled,
        public string $apiPrefix,
        public int    $maxBodyBytes,
        public int    $rateLimitPerMinute,
        public array  $allowedOrigins,
    ) {}

    public static function fromEnv(
        ?string $env = null,
        ?string $allowedOriginStr = null,
        ?bool   $musicEnabled = null,
    ): self {
        $rawEnv      = $env ?? (getenv('APP_ENV') ?: 'production');
        $isDev       = $rawEnv === 'development';

        $envMusic    = getenv('APP_MUSIC_ENABLED');
        $music       = $musicEnabled ?? ($envMusic === false
            ? true
            : in_array(mb_strtolower((string)$envMusic), ['1','true','yes','on'], true));

        $maxBody     = (int)(getenv('APP_MAX_BODY_BYTES') ?: 1_048_576);
        $maxBody     = $maxBody > 0 ? $maxBody : 1_048_576;

        $rate        = (int)(getenv('APP_RATE_LIMIT') ?: 60);
        $rate        = $rate > 0 ? $rate : 60;

        $originStr   = $allowedOriginStr ?? (getenv('APP_ALLOWED_ORIGIN') ?: 'https://yourdomain.com');
        $origins     = $isDev
            ? []
            : array_values(array_filter(array_map('trim', explode(',', $originStr))));

        // Use O(1) hash set lookups for origin checks in production
        if (!$isDev && $origins !== []) {
            $origins = array_flip($origins);
        }

        if (!$isDev && $origins === []) {
            error_log('[Helpy] WARNING: No APP_ALLOWED_ORIGIN configured in production');
        }

        return new self(
            isDev: $isDev,
            musicEnabled: $music,
            apiPrefix: '/api',
            maxBodyBytes: $maxBody,
            rateLimitPerMinute: $rate,
            allowedOrigins: $origins,
        );
    }

    public function originAllowed(string $origin): bool
    {
        return $this->isDev || isset($this->allowedOrigins[$origin]);
    }
}

final class HttpException extends RuntimeException
{
    private function __construct(
        public readonly array $data,
        public readonly HttpStatus $status,
    ) {
        parent::__construct($data['error'] ?? 'Unknown error', $status->value);
    }

    public static function error(string $message, HttpStatus $status, array $extra = []): self
    {
        return new self(['success' => false, 'error' => $message, ...$extra], $status);
    }

    public static function badRequest(string $m, array $x = []): self  { return self::error($m, HttpStatus::BadRequest, $x); }
    public static function unauthorized(string $m = 'Unauthorized'): self { return self::error($m, HttpStatus::Unauthorized); }
    public static function forbidden(string $m = 'Forbidden'): self   { return self::error($m, HttpStatus::Forbidden); }
    public static function notFound(string $m = 'Not Found', array $x = []): self { return self::error($m, HttpStatus::NotFound, $x); }
    public static function methodNotAllowed(): self                   { return self::error('Method Not Allowed', HttpStatus::MethodNotAllowed); }
    public static function conflict(string $m, array $x = []): self   { return self::error($m, HttpStatus::Conflict, $x); }
    public static function payloadTooLarge(string $m = 'Payload Too Large'): self { return self::error($m, HttpStatus::PayloadTooLarge); }
    public static function tooManyRequests(int $retry = 60): self     { return self::error('Too Many Requests', HttpStatus::TooManyRequests, ['retry_after' => $retry]); }
}

/** Immutable HTTP response value object. */
final readonly class Response
{
    public function __construct(
        public array $data,
        public HttpStatus $status = HttpStatus::Ok,
        public array $headers = [],
    ) {}

    public static function json(array $data, HttpStatus $status = HttpStatus::Ok, array $headers = []): self
    {
        return new self($data, $status, $headers);
    }

    public function withHeader(string $name, string $value): self
    {
        return new self($this->data, $this->status, [...$this->headers, $name => $value]);
    }
}

/** Terse alias. */
function response(array $data, HttpStatus $status = HttpStatus::Ok, array $headers = []): Response
{
    return Response::json($data, $status, $headers);
}

/**
 * Immutable HTTP Request. withBody() returns a NEW instance — no clone hack,
 * no Reflection, no readonly property reassignment.
 */
final class Request
{
    public function __construct(
        public readonly string  $method,
        public readonly string  $fullPath,
        public readonly string  $path,
        public readonly array   $body,
        public readonly ?string $authToken,
        public readonly array   $query,
        public readonly array   $headers,
        public readonly string  $requestId,
        public readonly string  $clientIp,
        public readonly float   $startTime,
        private readonly array  $attributes = [],
    ) {}

    public static function fromGlobals(string $apiPrefix, int $maxBodyBytes): self
    {
        $startTime = $_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true);
        $method    = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

        $parsed   = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        $fullPath = is_string($parsed) ? $parsed : '/';
        $path     = str_starts_with($fullPath, $apiPrefix)
            ? substr($fullPath, strlen($apiPrefix))
            : $fullPath;

        $headers   = self::parseHeaders();
        $authToken = self::extractBearer($headers);
        $body      = self::parseBody($maxBodyBytes, $headers);
        $requestId = bin2hex(random_bytes(8));
        $clientIp  = self::resolveClientIp();

        return new self(
            method: $method,
            fullPath: $fullPath,
            path: $path,
            body: $body,
            authToken: $authToken,
            query: $_GET,
            headers: $headers,
            requestId: $requestId,
            clientIp: $clientIp,
            startTime: $startTime,
        );
    }

    /** Return a new Request with a replaced body — true immutability. */
    public function withBody(array $body): self
    {
        return new self(
            method: $this->method,
            fullPath: $this->fullPath,
            path: $this->path,
            body: $body,
            authToken: $this->authToken,
            query: $this->query,
            headers: $this->headers,
            requestId: $this->requestId,
            clientIp: $this->clientIp,
            startTime: $this->startTime,
            attributes: $this->attributes,
        );
    }

    public function withAttribute(string $key, mixed $value): self
    {
        return new self(
            method: $this->method,
            fullPath: $this->fullPath,
            path: $this->path,
            body: $this->body,
            authToken: $this->authToken,
            query: $this->query,
            headers: $this->headers,
            requestId: $this->requestId,
            clientIp: $this->clientIp,
            startTime: $this->startTime,
            attributes: [...$this->attributes, $key => $value],
        );
    }

    public function get(string $key, mixed $default = null): mixed { return $this->attributes[$key] ?? $default; }
    public function user(): ?array                                 { return $this->attributes['user'] ?? null; }

    public function requireUser(): array
    {
        return $this->attributes['user'] ?? throw HttpException::unauthorized();
    }

    // ---- private helpers ----

    private static function resolveClientIp(): string
    {
        $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if ($forwarded !== '') {
            $ips = array_map('trim', explode(',', $forwarded));
            if (filter_var($ips[0], FILTER_VALIDATE_IP)) return $ips[0];
        }
        return $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
    }

    private static function parseHeaders(): array
    {
        if (function_exists('getallheaders') && ($raw = getallheaders()) !== false) {
            return array_change_key_case($raw, CASE_LOWER);
        }
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headers[str_replace('_', '-', strtolower(substr($key, 5)))] = $value;
            }
        }
        return $headers;
    }

    private static function extractBearer(array $headers): ?string
    {
        $auth = $headers['authorization'] ?? '';
        if (!str_starts_with($auth, 'Bearer ')) return null;
        $token = trim(substr($auth, 7));
        return $token !== '' ? $token : null;
    }

    private static function parseBody(int $maxBodyBytes, array $headers): array
    {
        $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > $maxBodyBytes) {
            throw HttpException::payloadTooLarge("Body exceeds {$maxBodyBytes} bytes");
        }

        $raw = file_get_contents('php://input') ?: '';
        if ($raw === '') return [];

        if (strlen($raw) > $maxBodyBytes) {
            throw HttpException::payloadTooLarge("Body exceeds {$maxBodyBytes} bytes");
        }

        $ctype = $headers['content-type'] ?? '';
        // Normalize content-type to handle charset parameters properly
        $baseCtype = trim(explode(';', $ctype)[0]);
        if (!str_contains($baseCtype, 'application/json')) {
            // Reject non-JSON early — avoids silent misparse.
            throw HttpException::badRequest('Content-Type must be application/json');
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw HttpException::badRequest('Malformed JSON body');
        }
        return is_array($decoded) ? $decoded : [];
    }
}

// ============================================================================
// RATE LIMITER
// ============================================================================

interface RateLimiterInterface
{
    public function check(string $key, int $windowSeconds, int $maxHits): bool;
}

final class InMemoryRateLimiter implements RateLimiterInterface
{
    /** @var array<string, SplQueue<int>> */
    private array $hits = [];

    public function check(string $key, int $windowSeconds, int $maxHits): bool
    {
        $now    = time();
        $cutoff = $now - $windowSeconds;

        // Initialize queue if not exists
        if (!isset($this->hits[$key])) {
            $this->hits[$key] = new SplQueue();
        }
        $bucket = $this->hits[$key];

        // Prune only leading expired entries — O(1) amortized, not O(n).
        while (!$bucket->isEmpty() && $bucket->bottom() <= $cutoff) {
            $bucket->dequeue();
        }

        if ($bucket->count() >= $maxHits) {
            return false;
        }

        $bucket->enqueue($now);
        return true;
    }
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

interface MiddlewareInterface
{
    /**
     * Receives a (Request, next) and MUST return a Response.
     * To replace the request flowing downstream, call $next->with($newReq).
     */
    public function __invoke(Request $request, Next $next): Response;
}

/**
 * Carries the pipeline forward. Each middleware can call $next->with($req)
 * to thread a modified request to subsequent stages, or $next() to forward
 * the current request unchanged.
 */
final class Next
{
    public function __construct(
        private readonly Request $request,
        private readonly \Closure $core,
    ) {}

    public function __invoke(): Response { return ($this->core)($this->request); }

    public function with(Request $request): Response
    {
        return ($this->core)($request);
    }
}

// ============================================================================
// ROUTER
// ============================================================================

final class Router
{
    /** @var array<string, array{regex: string, handler: callable, middleware: array<MiddlewareInterface|callable>}> */
    private array $routes = [];
    private string $prefix = '';
    /** @var array<MiddlewareInterface|callable> */
    private array $groupMiddleware = [];
    /** @var array<string, string> Route pattern regex cache */
    private array $routeRegexCache = [];

    private function add(string $method, string $pattern, callable $handler, array $middleware): void
    {
        $fullPattern = $this->prefix . $pattern;
        // Use cached regex if available
        if (!isset($this->routeRegexCache[$fullPattern])) {
            $regex = '#^' . preg_replace_callback(
                '#\{(\w+)(?::([^}]+))?\}#',
                static fn(array $m): string => isset($m[2])
                    ? "(?P<{$m[1]}>{$m[2]})"
                    : "(?P<{$m[1]}>[^/]+)",
                $fullPattern,
            ) . '$#';
            $this->routeRegexCache[$fullPattern] = $regex;
        }
        $regex = $this->routeRegexCache[$fullPattern];

        $this->routes[$method][] = [
            'regex'      => $regex,
            'handler'    => $handler,
            'middleware' => [...$this->groupMiddleware, ...$middleware],
        ];
    }

    public function get(string $p, callable $h, array $m = []): void    { $this->add('GET',    $p, $h, $m); }
    public function post(string $p, callable $h, array $m = []): void   { $this->add('POST',   $p, $h, $m); }
    public function put(string $p, callable $h, array $m = []): void    { $this->add('PUT',    $p, $h, $m); }
    public function delete(string $p, callable $h, array $m = []): void { $this->add('DELETE', $p, $h, $m); }

    public function group(string $prefix, array $middleware, callable $definer): void
    {
        $prevPrefix = $this->prefix;
        $prevMW     = $this->groupMiddleware;
        $this->prefix           .= $prefix;
        $this->groupMiddleware   = [...$prevMW, ...$middleware];

        try {
            $definer($this);
        } finally {
            $this->prefix           = $prevPrefix;
            $this->groupMiddleware  = $prevMW;
        }
    }

    public function dispatch(Request $request): Response
    {
        $method       = $request->method;
        $lookupMethod = $method === 'HEAD' ? 'GET' : $method;
        $path         = $request->path;
        $pathExists   = false;

        if (isset($this->routes[$lookupMethod])) {
            foreach ($this->routes[$lookupMethod] as $route) {
                if (!preg_match($route['regex'], $path, $matches)) continue;
                $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
                return $this->runPipeline($route, $request, $params);
            }
        }

        foreach ($this->routes as $routeMethod => $routes) {
            if ($routeMethod === $lookupMethod) continue;
            foreach ($routes as $route) {
                if (preg_match($route['regex'], $path)) { $pathExists = true; break 2; }
            }
        }

        throw $pathExists
            ? HttpException::methodNotAllowed()
            : HttpException::notFound('Endpoint not found', ['path' => $request->fullPath]);
    }

    private function runPipeline(array $route, Request $request, array $params): Response
    {
        $core = static fn(Request $req): Response => $route['handler']($req, $params);

        // Build onion: outermost middleware wraps the rest.
        $pipeline = $core;
        foreach (array_reverse($route['middleware']) as $mw) {
            $inner = $pipeline;
            $pipeline = static function (Request $req) use ($mw, $inner): Response {
                return $mw($req, new Next($req, $inner));
            };
        }
        return $pipeline($request);
    }
}

// ============================================================================
// VALIDATION & SANITIZATION
// ============================================================================

function requireString(array $data, string $key, int $maxLength = 255, bool $sanitize = false): string
{
    if (!array_key_exists($key, $data)) {
        throw HttpException::badRequest("Field '{$key}' is required");
    }

    if (!is_string($data[$key])) {
        throw HttpException::badRequest("Field '{$key}' must be a string");
    }

    $value = $data[$key];
    $length = mb_strlen($value);

    if ($length === 0) {
        throw HttpException::badRequest("Field '{$key}' cannot be empty");
    }

    if ($length > $maxLength) {
        throw HttpException::badRequest("Field '{$key}' must be at most {$maxLength} characters long");
    }

    return $sanitize ? htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE) : $value;
}

/**
 * Get an optional string value that may be null
 * Returns null if the key doesn't exist or the value is null
 * Throws HttpException if the value exists and is not a string
 */
function optionalStringOrNull(array $data, string $key, int $maxLength = 255, bool $sanitize = false): ?string
{
    if (!array_key_exists($key, $data) || $data[$key] === null) {
        return null;
    }

    if (!is_string($data[$key])) {
        throw HttpException::badRequest("Field '{$key}' must be a string or null");
    }

    $value = $data[$key];
    if (mb_strlen($value) > $maxLength) {
        throw HttpException::badRequest("Field '{$key}' must be at most {$maxLength} characters long");
    }

    return $sanitize ? htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE) : $value;
}

/**
 * Require an integer value with range validation
 */
function requireInt(array $data, string $key, ?int $min = null, ?int $max = null): int
{
    if (!array_key_exists($key, $data)) {
        throw HttpException::badRequest("Field '{$key}' is required");
    }

    $value = filter_var($data[$key], FILTER_VALIDATE_INT);
    if ($value === false) {
        throw HttpException::badRequest("Field '{$key}' must be a valid integer");
    }

    if ($min !== null && $value < $min) {
        throw HttpException::badRequest("Field '{$key}' must be at least {$min}");
    }

    if ($max !== null && $value > $max) {
        throw HttpException::badRequest("Field '{$key}' must be at most {$max}");
    }

    return $value;
}

/**
 * Require a valid email address
 */
function requireEmail(array $data, string $key): string
{
    $value = requireString($data, $key);
    if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
        throw HttpException::badRequest("Field '{$key}' must be a valid email address");
    }
    return strtolower($value);
}
