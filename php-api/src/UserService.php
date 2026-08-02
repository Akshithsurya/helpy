<?php
declare(strict_types=1);

use PDOException;
use JsonException;
use InvalidArgumentException;
use Random\RandomException;

/**
 * Plan status enum — replaces the string-array constant for type safety.
 */
enum PlanStatus: string
{
    case Pending    = 'pending';
    case InProgress = 'in_progress';
    case Completed  = 'completed';
    case Cancelled  = 'cancelled';
    case Paused     = 'paused';
}

/**
 * UserService handles user authentication, session management, and plan associations.
 *
 * Security notes:
 *   - Session tokens are stored as SHA-256 hashes; the plaintext token is returned
 *     to the client only at creation time. A database leak therefore does not
 *     immediately compromise active sessions. SHA-256 is appropriate here because
 *     the input (a 256-bit random token) has sufficient entropy to resist brute-force.
 *     SHA-256 is NOT suitable for password hashing — use password_hash() for that.
 *   - Passwords are hashed with password_hash() using PHP's default algorithm
 *     and transparently rehashed when the algorithm or cost changes.
 *   - Authentication errors return generic messages to avoid user enumeration.
 *   - Password length is bounded to mitigate bcrypt DoS.
 *   - Login always invokes password_verify against a valid-format bcrypt hash
 *     even when the supplied email does not exist, reducing (but not eliminating)
 *     timing differences exploitable for user enumeration.
 *   - #[\SensitiveParameter] is used on all password parameters to redact them
 *     from stack traces and error logs.
 *   - Emails are normalized to lowercase before storage and lookup.
 *   - IDs are validated as UUID v4 before reaching the database.
 *   - Login throttling (optional) prevents brute-force attacks.
 *   - Sessions track optional IP / User-Agent metadata for auditing.
 *
 * @note Optimized for MySQL/MariaDB 8.0.19+.
 */
final class UserService
{
    // ------------------------------------------------------------------
    // Session configuration
    // ------------------------------------------------------------------

    public const SESSION_EXPIRATION_DAYS    = 7;
    public const SESSION_EXPIRATION_SECONDS = self::SESSION_EXPIRATION_DAYS * 86_400;
    /** Sliding-window threshold: extend session once less than half its life remains. */
    public const SESSION_REFRESH_THRESHOLD  = (int) (self::SESSION_EXPIRATION_SECONDS / 2);
    public const SESSION_TOKEN_HEX_LENGTH   = 64;
    public const SESSION_TOKEN_BYTES        = 32;
    /** Max attempts to regenerate a session token on (astronomically unlikely) collision. */
    private const SESSION_TOKEN_MAX_RETRIES = 3;

    // ------------------------------------------------------------------
    // Plan configuration
    // ------------------------------------------------------------------

    public const DEFAULT_PLAN_DURATION   = 30;
    public const DEFAULT_PLAN_STATUS     = PlanStatus::Pending->value;
    public const UNTITLED_PLAN           = 'Untitled';
    public const PLAN_TITLE_MAX_LENGTH   = 255;
    public const PLAN_GOAL_MAX_LENGTH    = 65_535;
    public const PLAN_DURATION_MAX       = 100_000;

    // ------------------------------------------------------------------
    // Bulk / batch configuration
    // ------------------------------------------------------------------

    public const BULK_BATCH_SIZE            = 500;
    public const SESSION_CLEANUP_BATCH_SIZE = 500;
    public const USER_PLANS_DEFAULT_LIMIT   = 50;
    public const USER_PLANS_MAX_LIMIT       = 500;
    /** Hard cap on plans accepted by syncPlans() in a single call. */
    public const SYNC_PLANS_MAX_INPUT       = 5_000;
    /** Max error messages retained by syncPlans() before truncation. */
    public const SYNC_PLANS_MAX_ERRORS      = 100;

    // ------------------------------------------------------------------
    // Input constraints
    // ------------------------------------------------------------------

    public const USERNAME_MIN_LENGTH  = 1;
    public const USERNAME_MAX_LENGTH  = 100;
    public const EMAIL_MAX_LENGTH     = 255;
    public const PASSWORD_MIN_LENGTH  = 8;
    public const PASSWORD_MAX_LENGTH  = 4096;
    public const PASSWORD_MIN_CLASSES = 3;

    // ------------------------------------------------------------------
    // Database / crypto
    // ------------------------------------------------------------------

    public const MYSQL_DUPLICATE_ENTRY_ERROR = 1062;
    public const UUID_V4_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    public const DATETIME_FORMAT  = 'Y-m-d H:i:s';

    /**
     * Precomputed valid bcrypt hash used to keep the password_verify code path
     * consistent in timing even when the supplied email is unknown.
     */
    private const DUMMY_PASSWORD_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

    public const TIMEZONE = 'UTC';

    /**
     * @param Database                       $db
     * @param (Closure(): int)|null          $timeProvider   Override for current Unix timestamp (testing).
     * @param (Closure(string, Throwable): void)|null $logHandler  Non-fatal error handler.
     * @param (Closure(string): bool)|null   $loginThrottler Returns true to reject before password check.
     */
    public function __construct(
        private readonly Database $db,
        private readonly ?\Closure $timeProvider = null,
        private readonly ?\Closure $logHandler = null,
        private readonly ?\Closure $loginThrottler = null,
    ) {}

    // ==================================================================
    // Schema
    // ==================================================================

    public function initializeSchema(): void
    {
        $this->db->execute("
            CREATE TABLE IF NOT EXISTS users (
                id            CHAR(36)       NOT NULL,
                username      VARCHAR(100)   NOT NULL,
                email         VARCHAR(255)   NOT NULL,
                password_hash VARCHAR(255)   NOT NULL,
                created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uk_users_username (username),
                UNIQUE KEY uk_users_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->db->execute("
            CREATE TABLE IF NOT EXISTS plans (
                id               CHAR(36)     NOT NULL,
                title            VARCHAR(255) NOT NULL,
                goal             TEXT,
                duration_minutes INT          NOT NULL DEFAULT 30,
                status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
                created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                data             JSON         NULL,
                PRIMARY KEY (id),
                KEY idx_plans_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->db->execute("
            CREATE TABLE IF NOT EXISTS user_sessions (
                id            CHAR(36)    NOT NULL,
                user_id       CHAR(36)    NOT NULL,
                token_hash    CHAR(64)    NOT NULL,
                expires_at    TIMESTAMP   NOT NULL,
                created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ip_address    VARCHAR(45) NULL,
                user_agent    VARCHAR(255) NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uk_sessions_token_hash (token_hash),
                KEY idx_sessions_user_id (user_id),
                KEY idx_sessions_expires_at (expires_at),
                CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

        $this->db->execute("
            CREATE TABLE IF NOT EXISTS user_plans (
                user_id    CHAR(36) NOT NULL,
                plan_id    CHAR(36) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, plan_id),
                KEY idx_user_plans_plan_id (plan_id),
                CONSTRAINT fk_user_plans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_user_plans_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    }

    // ==================================================================
    // Helpers
    // ==================================================================

    private function now(): int
    {
        return $this->timeProvider !== null ? (int) ($this->timeProvider)() : time();
    }

    private function dateTimeString(?int $timestamp = null): string
    {
        $ts = $timestamp ?? $this->now();
        return (new \DateTimeImmutable('@' . $ts))
            ->setTimezone(new \DateTimeZone(self::TIMEZONE))
            ->format(self::DATETIME_FORMAT);
    }

    /**
     * Safely invoke the optional log handler. Fails silently if none configured.
     */
    private function logWarning(string $message, \Throwable $e): void
    {
        if ($this->logHandler === null) {
            return;
        }
        try {
            ($this->logHandler)($message, $e);
        } catch (\Throwable $handlerError) {
            // A logging failure must never propagate into the application.
            // Last-resort: write to stderr so the error is at least visible.
            fwrite(\STDERR, "logHandler threw: " . $handlerError->getMessage() . "\n");
        }
    }

    /** @throws RandomException */
    private function generateUuidV4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); // version 4
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); // variant 10
        $hex = bin2hex($bytes);
        return \substr($hex, 0, 8) . '-'
             . \substr($hex, 8, 4) . '-'
             . \substr($hex, 12, 4) . '-'
             . \substr($hex, 16, 4) . '-'
             . \substr($hex, 20, 12);
    }

    private function isValidUuidV4(string $value): bool
    {
        return preg_match(self::UUID_V4_PATTERN, $value) === 1;
    }

    private function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /**
     * Detects MySQL duplicate-key errors. Only matches the specific MySQL
     * driver code 1062 — does NOT fall back to generic SQLSTATE 23000,
     * which would also match FK violations, NOT NULL, CHECK, etc.
     */
    private function isDuplicateKeyError(PDOException $e): bool
    {
        return ($e->errorInfo[1] ?? null) === self::MYSQL_DUPLICATE_ENTRY_ERROR;
    }

    private function safeRollBack(): void
    {
        try {
            $this->db->rollBack();
        } catch (PDOException $e) {
            $this->logWarning('Transaction rollback failed', $e);
        }
    }

    /** Truncate and normalize a UTF-8 string to a max byte/char length. */
    private function clampString(string $value, int $maxLength): string
    {
        return mb_substr($value, 0, $maxLength, 'UTF-8');
    }

    // ==================================================================
    // Input validation
    // ==================================================================

    /** @throws InvalidArgumentException */
    private function validateUsername(string $username): string
    {
        $username = trim($username);
        $length   = mb_strlen($username);

        if ($length < self::USERNAME_MIN_LENGTH || $length > self::USERNAME_MAX_LENGTH) {
            throw new InvalidArgumentException(
                'Username must be between ' . self::USERNAME_MIN_LENGTH
                . ' and ' . self::USERNAME_MAX_LENGTH . ' characters.'
            );
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $username)) {
            throw new InvalidArgumentException('Username contains invalid characters.');
        }
        return $username;
    }

    /** @throws InvalidArgumentException */
    private function validateEmail(string $email): string
    {
        $email = mb_strtolower(trim($email), 'UTF-8');
        if (\strlen($email) > self::EMAIL_MAX_LENGTH
            || filter_var($email, FILTER_VALIDATE_EMAIL) === false
        ) {
            throw new InvalidArgumentException('A valid email address is required.');
        }
        return $email;
    }

    /** @throws InvalidArgumentException */
    private function validatePassword(#[\SensitiveParameter] string $password): string
    {
        $length = \strlen($password);
        if ($length < self::PASSWORD_MIN_LENGTH || $length > self::PASSWORD_MAX_LENGTH) {
            throw new InvalidArgumentException(
                'Password must be between ' . self::PASSWORD_MIN_LENGTH
                . ' and ' . self::PASSWORD_MAX_LENGTH . ' characters.'
            );
        }
        $classes  = 0;
        $classes += (int) preg_match('/[a-z]/',        $password);
        $classes += (int) preg_match('/[A-Z]/',        $password);
        $classes += (int) preg_match('/[0-9]/',        $password);
        $classes += (int) preg_match('/[^a-zA-Z0-9]/', $password);
        if ($classes < self::PASSWORD_MIN_CLASSES) {
            throw new InvalidArgumentException(
                'Password must contain at least three of: lowercase, uppercase, digits, symbols.'
            );
        }
        return $password;
    }

    /**
     * @return array{0: string, 1: string, 2: string}
     * @throws InvalidArgumentException
     */
    private function normalizeAndValidateRegistrationInput(
        string $username,
        string $email,
        #[\SensitiveParameter] string $password,
    ): array {
        return [
            $this->validateUsername($username),
            $this->validateEmail($email),
            $this->validatePassword($password),
        ];
    }

    private function hashPassword(#[\SensitiveParameter] string $password): ?string
    {
        try {
            return password_hash($password, PASSWORD_DEFAULT);
        } catch (\ValueError $e) {
            $this->logWarning('password_hash threw ValueError', $e);
            return null;
        }
    }

    /**
     * Validate and normalize a plan record for syncPlans().
     *
     * @param array<string, mixed> $plan
     * @return array{title: string, goal: string, duration: int, status: string, created_at: string, data: string}
     * @throws InvalidArgumentException
     * @throws JsonException
     */
    private function normalizePlan(array $plan, string $currentTime): array
    {
        $title = trim((string) ($plan['title'] ?? self::UNTITLED_PLAN));
        if ($title === '' || mb_strlen($title) > self::PLAN_TITLE_MAX_LENGTH) {
            throw new InvalidArgumentException(
                'Plan title must be 1-' . self::PLAN_TITLE_MAX_LENGTH . ' characters.'
            );
        }

        $goal = trim((string) ($plan['goal'] ?? ''));
        if (mb_strlen($goal) > self::PLAN_GOAL_MAX_LENGTH) {
            throw new InvalidArgumentException('Plan goal is too long.');
        }

        // Strict-ish: reject bools/objects, accept ints and numeric strings.
        $rawDuration = $plan['durationMinutes'] ?? self::DEFAULT_PLAN_DURATION;
        if (is_bool($rawDuration) || is_array($rawDuration) || $rawDuration instanceof \stdClass) {
            throw new InvalidArgumentException('Plan duration must be an integer.');
        }
        if (!is_numeric($rawDuration)) {
            throw new InvalidArgumentException('Plan duration must be numeric.');
        }
        $duration = (int) $rawDuration;
        if ($duration < 0 || $duration > self::PLAN_DURATION_MAX) {
            throw new InvalidArgumentException('Plan duration is out of range.');
        }

        $statusValue = (string) ($plan['status'] ?? self::DEFAULT_PLAN_STATUS);
        if (PlanStatus::tryFrom($statusValue) === null) {
            throw new InvalidArgumentException("Invalid plan status: {$statusValue}");
        }

        // Validate or default created_at — prevents clients from injecting
        // arbitrary timestamps (e.g., far-future dates) into the database.
        $createdAt = $currentTime;
        if (isset($plan['createdAt']) && is_string($plan['createdAt'])) {
            $parsed = \DateTimeImmutable::createFromFormat(
                '!' . self::DATETIME_FORMAT,
                $plan['createdAt'],
                new \DateTimeZone(self::TIMEZONE),
            );
            if ($parsed === false) {
                throw new InvalidArgumentException(
                    'Plan createdAt must be in "Y-m-d H:i:s" format (UTC).'
                );
            }
            $createdAt = $parsed->format(self::DATETIME_FORMAT);
        }

        // Strip the ID from stored data (it's already in its own column).
        $dataForStorage = $plan;
        unset($dataForStorage['id']);

        $jsonData = json_encode(
            $dataForStorage,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );

        return [
            'title'      => $title,
            'goal'       => $goal,
            'duration'   => $duration,
            'status'     => $statusValue,
            'created_at' => $createdAt,
            'data'       => $jsonData,
        ];
    }

    // ==================================================================
    // Authentication
    // ==================================================================

    /**
     * @return array{success: bool, error?: string, user?: array{id: string, username: string, email: string}, session?: array{token: string, expires_at: string}}
     */
    public function registerUser(
        string $username,
        string $email,
        #[\SensitiveParameter] string $password,
        ?string $ipAddress = null,
        ?string $userAgent = null,
    ): array {
        try {
            [$username, $email, $password] = $this->normalizeAndValidateRegistrationInput($username, $email, $password);
        } catch (InvalidArgumentException $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        $userId       = $this->generateUuidV4();
        $passwordHash = $this->hashPassword($password);

        if ($passwordHash === null) {
            return ['success' => false, 'error' => 'Failed to hash password.'];
        }

        try {
            $this->db->beginTransaction();

            $stmt = $this->db->prepare(
                'INSERT INTO users (id, username, email, password_hash)
                 VALUES (:id, :username, :email, :password_hash)'
            );
            $stmt->execute([
                ':id'            => $userId,
                ':username'      => $username,
                ':email'         => $email,
                ':password_hash' => $passwordHash,
            ]);

            $session = $this->createSession($userId, $ipAddress, $userAgent);

            $this->db->commit();

            return [
                'success' => true,
                'user'    => [
                    'id'       => $userId,
                    'username' => $username,
                    'email'    => $email,
                ],
                'session' => $session,
            ];
        } catch (PDOException $e) {
            $this->safeRollBack();
            if ($this->isDuplicateKeyError($e)) {
                return ['success' => false, 'error' => 'Username or email already exists.'];
            }
            $this->logWarning('Registration database error', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred during registration.'];
        } catch (RandomException $e) {
            $this->safeRollBack();
            $this->logWarning('Session token generation failed during registration', $e);
            return ['success' => false, 'error' => 'Failed to create session.'];
        }
    }

    /**
     * @return array{success: bool, error?: string, user?: array{id: string, username: string, email: string}, session?: array{token: string, expires_at: string}}
     */
    public function loginUser(
        string $email,
        #[\SensitiveParameter] string $password,
        ?string $ipAddress = null,
        ?string $userAgent = null,
    ): array {
        $email = mb_strtolower(trim($email), 'UTF-8');

        if ($this->loginThrottler !== null && ($this->loginThrottler)($email) === true) {
            return ['success' => false, 'error' => 'Too many login attempts. Please try again later.'];
        }

        $user = null;
        try {
            $stmt = $this->db->prepare(
                'SELECT id, username, email, password_hash FROM users WHERE email = :email LIMIT 1'
            );
            $stmt->execute([':email' => $email]);
            $user = $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        } catch (PDOException $e) {
            $this->logWarning('Login query failed', $e);
            // Fall through to password_verify against dummy hash to keep timing similar.
        }

        $validPassword = password_verify(
            $password,
            $user['password_hash'] ?? self::DUMMY_PASSWORD_HASH,
        );

        if (!$user || !$validPassword) {
            return ['success' => false, 'error' => 'Invalid credentials.'];
        }

        $this->maybeRehashPassword($password, $user['password_hash'], $user['id']);

        try {
            $this->db->beginTransaction();
            $session = $this->createSession($user['id'], $ipAddress, $userAgent);
            $this->db->commit();
        } catch (PDOException | RandomException $e) {
            $this->safeRollBack();
            $this->logWarning('Session creation failed during login', $e);
            return ['success' => false, 'error' => 'Failed to start session.'];
        }

        return [
            'success' => true,
            'user'    => [
                'id'       => $user['id'],
                'username' => $user['username'],
                'email'    => $user['email'],
            ],
            'session' => $session,
        ];
    }

    private function maybeRehashPassword(
        #[\SensitiveParameter] string $password,
        string $currentHash,
        string $userId,
    ): void {
        if (!password_needs_rehash($currentHash, PASSWORD_DEFAULT)) {
            return;
        }
        $newHash = $this->hashPassword($password);
        if ($newHash === null) {
            return;
        }
        try {
            $stmt = $this->db->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
            $stmt->execute([':hash' => $newHash, ':id' => $userId]);
        } catch (PDOException $e) {
            $this->logWarning('Password rehash update failed', $e);
        }
    }

    // ==================================================================
    // Sessions
    // ==================================================================

    /**
     * @return array{token: string, expires_at: string}
     * @throws PDOException
     * @throws RandomException
     */
    private function createSession(
        string $userId,
        ?string $ipAddress = null,
        ?string $userAgent = null,
    ): array {
        $sessionId = $this->generateUuidV4();
        $expiresAt = $this->dateTimeString($this->now() + self::SESSION_EXPIRATION_SECONDS);

        // Retry on the (astronomically unlikely) token_hash collision.
        for ($attempt = 0; $attempt < self::SESSION_TOKEN_MAX_RETRIES; $attempt++) {
            $token     = bin2hex(random_bytes(self::SESSION_TOKEN_BYTES));
            $tokenHash = $this->hashToken($token);

            try {
                $stmt = $this->db->prepare(
                    'INSERT INTO user_sessions
                        (id, user_id, token_hash, expires_at, ip_address, user_agent)
                     VALUES
                        (:id, :user_id, :token_hash, :expires_at, :ip, :ua)'
                );
                $stmt->execute([
                    ':id'         => $sessionId,
                    ':user_id'    => $userId,
                    ':token_hash' => $tokenHash,
                    ':expires_at' => $expiresAt,
                    ':ip'         => $this->sanitizeIpAddress($ipAddress),
                    ':ua'         => $this->sanitizeUserAgent($userAgent),
                ]);
                return ['token' => $token, 'expires_at' => $expiresAt];
            } catch (PDOException $e) {
                if (!$this->isDuplicateKeyError($e)) {
                    throw $e;
                }
                // Collision on token_hash — loop and try a fresh token.
            }
        }

        // Exhausted retries.
        throw new RandomException('Unable to generate a unique session token after retries.');
    }

    private function sanitizeIpAddress(?string $ip): ?string
    {
        if ($ip === null || $ip === '') {
            return null;
        }
        // IPv4 / IPv6 length caps.
        return $this->clampString($ip, 45);
    }

    private function sanitizeUserAgent(?string $ua): ?string
    {
        if ($ua === null || $ua === '') {
            return null;
        }
        // Strip control chars and clamp to column size.
        $clean = preg_replace('/[\x00-\x1F\x7F]/', '', $ua) ?? '';
        $clean = trim($clean);
        return $clean === '' ? null : $this->clampString($clean, 255);
    }

    /**
     * @return array{id: string, username: string, email: string}|null
     */
    public function verifySession(string $token): ?array
    {
        if ($token === ''
            || \strlen($token) !== self::SESSION_TOKEN_HEX_LENGTH
            || !ctype_xdigit($token)
        ) {
            return null;
        }

        $tokenHash = $this->hashToken($token);

        try {
            $stmt = $this->db->prepare(
                'SELECT us.user_id AS id, u.username, u.email, us.expires_at
                 FROM user_sessions us
                 JOIN users u ON us.user_id = u.id
                 WHERE us.token_hash = :token_hash AND us.expires_at > NOW()
                 LIMIT 1'
            );
            $stmt->execute([':token_hash' => $tokenHash]);
            $session = $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        } catch (PDOException $e) {
            $this->logWarning('Session verification query failed', $e);
            return null;
        }

        if (!$session) {
            return null;
        }

        // Use DB time (via dateTimeString based on PHP now() for the extension target).
        $this->maybeExtendSession($session['expires_at'], $tokenHash);

        unset($session['expires_at']);
        return $session;
    }

    private function maybeExtendSession(string $expiresAt, string $tokenHash): void
    {
        try {
            $expiresTs = (new \DateTimeImmutable($expiresAt, new \DateTimeZone(self::TIMEZONE)))
                ->getTimestamp();
        } catch (\Throwable $e) {
            $this->logWarning('Failed to parse session expires_at', $e);
            return;
        }

        $remaining = $expiresTs - $this->now();
        if ($remaining >= self::SESSION_REFRESH_THRESHOLD) {
            return;
        }

        try {
            $newExpiresAt = $this->dateTimeString($this->now() + self::SESSION_EXPIRATION_SECONDS);
            $stmt = $this->db->prepare(
                'UPDATE user_sessions
                 SET expires_at = :expires_at, last_seen_at = CURRENT_TIMESTAMP
                 WHERE token_hash = :token_hash'
            );
            $stmt->execute([
                ':expires_at' => $newExpiresAt,
                ':token_hash' => $tokenHash,
            ]);
        } catch (PDOException $e) {
            $this->logWarning('Session extension failed', $e);
        }
    }

    /** @return array{success: bool, revoked: bool} */
    public function logoutUser(string $token): array
    {
        if ($token === '') {
            return ['success' => true, 'revoked' => false];
        }
        if (\strlen($token) !== self::SESSION_TOKEN_HEX_LENGTH || !ctype_xdigit($token)) {
            return ['success' => true, 'revoked' => false];
        }
        try {
            $stmt = $this->db->prepare('DELETE FROM user_sessions WHERE token_hash = :token_hash');
            $stmt->execute([':token_hash' => $this->hashToken($token)]);
            return ['success' => true, 'revoked' => $stmt->rowCount() > 0];
        } catch (PDOException $e) {
            $this->logWarning('Logout DELETE failed', $e);
            return ['success' => false, 'revoked' => false];
        }
    }

    /** Semantic alias for logoutUser(). */
    public function revokeSession(string $token): array
    {
        return $this->logoutUser($token);
    }

    /**
     * @return int Number of sessions revoked (0 for invalid UUID or no active sessions).
     */
    public function revokeAllUserSessions(string $userId): int
    {
        if (!$this->isValidUuidV4($userId)) {
            return 0;
        }
        try {
            $stmt = $this->db->prepare('DELETE FROM user_sessions WHERE user_id = :user_id');
            $stmt->execute([':user_id' => $userId]);
            return $stmt->rowCount();
        } catch (PDOException $e) {
            $this->logWarning('Bulk session revocation failed', $e);
            return 0;
        }
    }

    /**
     * Revoke all of a user's sessions except the one matching $keepToken.
     * Useful for "log out other devices" flows.
     *
     * @return int Number of sessions revoked.
     */
    public function revokeAllUserSessionsExcept(string $userId, string $keepToken): int
    {
        if (!$this->isValidUuidV4($userId)) {
            return 0;
        }
        if (\strlen($keepToken) !== self::SESSION_TOKEN_HEX_LENGTH || !ctype_xdigit($keepToken)) {
            return 0;
        }
        try {
            $stmt = $this->db->prepare(
                'DELETE FROM user_sessions
                 WHERE user_id = :user_id AND token_hash <> :keep_hash'
            );
            $stmt->execute([
                ':user_id'   => $userId,
                ':keep_hash' => $this->hashToken($keepToken),
            ]);
            return $stmt->rowCount();
        } catch (PDOException $e) {
            $this->logWarning('Selective session revocation failed', $e);
            return 0;
        }
    }

    /**
     * List a user's active sessions (excluding token hashes).
     *
     * @return list<array{id: string, expires_at: string, created_at: string, last_seen_at: string, ip_address: ?string, user_agent: ?string, current: bool}>
     */
    public function getUserSessions(string $userId, ?string $currentToken = null): array
    {
        if (!$this->isValidUuidV4($userId)) {
            return [];
        }
        $currentHash = $currentToken !== null
            ? $this->hashToken($currentToken)
            : null;

        try {
            $stmt = $this->db->prepare(
                'SELECT id, expires_at, created_at, last_seen_at, ip_address, user_agent, token_hash
                 FROM user_sessions
                 WHERE user_id = :user_id AND expires_at > NOW()
                 ORDER BY last_seen_at DESC'
            );
            $stmt->execute([':user_id' => $userId]);
            $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (PDOException $e) {
            $this->logWarning('getUserSessions failed', $e);
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $isCurrent = $currentHash !== null
                && hash_equals($currentHash, (string) $row['token_hash']);
            unset($row['token_hash']);
            $row['current'] = $isCurrent;
            $out[] = $row;
        }
        return $out;
    }

    /**
     * Remove expired sessions in batches. Re-invoke until the returned count is 0.
     *
     * @return int Number of sessions removed in this batch.
     */
    public function cleanupExpiredSessions(): int
    {
        try {
            $stmt = $this->db->prepare(
                'DELETE FROM user_sessions WHERE expires_at < NOW() LIMIT :batch_size'
            );
            $stmt->bindValue(':batch_size', self::SESSION_CLEANUP_BATCH_SIZE, \PDO::PARAM_INT);
            $stmt->execute();
            return $stmt->rowCount();
        } catch (PDOException $e) {
            $this->logWarning('Expired session cleanup failed', $e);
            return 0;
        }
    }

    // ==================================================================
    // Plans
    // ==================================================================

    /** @return bool True if a NEW association was created. */
    public function associatePlanWithUser(string $userId, string $planId): bool
    {
        if (!$this->isValidUuidV4($userId) || !$this->isValidUuidV4($planId)) {
            return false;
        }
        try {
            $stmt = $this->db->prepare(
                'INSERT IGNORE INTO user_plans (user_id, plan_id) VALUES (:user_id, :plan_id)'
            );
            $stmt->execute([':user_id' => $userId, ':plan_id' => $planId]);
            return $stmt->rowCount() > 0;
        } catch (PDOException $e) {
            $this->logWarning('Plan association failed', $e);
            return false;
        }
    }

    /** @return bool True if the association existed and was removed. */
    public function disassociatePlanFromUser(string $userId, string $planId): bool
    {
        if (!$this->isValidUuidV4($userId) || !$this->isValidUuidV4($planId)) {
            return false;
        }
        try {
            $stmt = $this->db->prepare(
                'DELETE FROM user_plans WHERE user_id = :user_id AND plan_id = :plan_id'
            );
            $stmt->execute([':user_id' => $userId, ':plan_id' => $planId]);
            return $stmt->rowCount() > 0;
        } catch (PDOException $e) {
            $this->logWarning('Plan disassociation failed', $e);
            return false;
        }
    }

    /**
     * @return list<array{id: string, title: string, goal: string, duration_minutes: int, status: string, created_at: string}>
     */
    public function getUserPlans(
        string $userId,
        int $limit = self::USER_PLANS_DEFAULT_LIMIT,
        int $offset = 0,
    ): array {
        if (!$this->isValidUuidV4($userId)) {
            return [];
        }
        $limit  = self::normalizeLimit($limit, self::USER_PLANS_DEFAULT_LIMIT, self::USER_PLANS_MAX_LIMIT);
        $offset = max(0, $offset);

        try {
            $stmt = $this->db->prepare(
                'SELECT p.id, p.title, p.goal, p.duration_minutes, p.status, p.created_at
                 FROM plans p
                 JOIN user_plans up ON p.id = up.plan_id
                 WHERE up.user_id = :user_id
                 ORDER BY p.created_at DESC
                 LIMIT :limit OFFSET :offset'
            );
            $stmt->bindValue(':user_id', $userId);
            $stmt->bindValue(':limit', $limit, \PDO::PARAM_INT);
            $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
            $stmt->execute();
            return $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
        } catch (PDOException $e) {
            $this->logWarning('Get user plans failed', $e);
            return [];
        }
    }

    /** @return int */
    public function countUserPlans(string $userId): int
    {
        if (!$this->isValidUuidV4($userId)) {
            return 0;
        }
        try {
            $stmt = $this->db->prepare('SELECT COUNT(*) FROM user_plans WHERE user_id = :user_id');
            $stmt->execute([':user_id' => $userId]);
            $count = $stmt->fetchColumn(0);
            return $count !== false ? (int) $count : 0;
        } catch (PDOException $e) {
            $this->logWarning('Count user plans failed', $e);
            return 0;
        }
    }

    /**
     * Fetch a single plan if it is associated with the given user.
     *
     * @return array{id: string, title: string, goal: string, duration_minutes: int, status: string, created_at: string, updated_at: string, data: ?string}|null
     */
    public function getPlanForUser(string $userId, string $planId): ?array
    {
        if (!$this->isValidUuidV4($userId) || !$this->isValidUuidV4($planId)) {
            return null;
        }
        try {
            $stmt = $this->db->prepare(
                'SELECT p.id, p.title, p.goal, p.duration_minutes, p.status, p.created_at, p.updated_at, p.data
                 FROM plans p
                 JOIN user_plans up ON p.id = up.plan_id
                 WHERE up.user_id = :user_id AND p.id = :plan_id
                 LIMIT 1'
            );
            $stmt->execute([':user_id' => $userId, ':plan_id' => $planId]);
            return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        } catch (PDOException $e) {
            $this->logWarning('getPlanForUser failed', $e);
            return null;
        }
    }

    /**
     * Delete a plan and its associations. Only succeeds if the plan is
     * associated with the calling user (authorization check).
     *
     * @return array{success: bool, error?: string}
     */
    public function deletePlanForUser(string $userId, string $planId): array
    {
        if (!$this->isValidUuidV4($userId) || !$this->isValidUuidV4($planId)) {
            return ['success' => false, 'error' => 'Invalid user or plan ID.'];
        }
        try {
            $this->db->beginTransaction();

            // Authorization: confirm ownership before deleting.
            $check = $this->db->prepare(
                'SELECT 1 FROM user_plans WHERE user_id = :user_id AND plan_id = :plan_id FOR UPDATE'
            );
            $check->execute([':user_id' => $userId, ':plan_id' => $planId]);
            if ($check->fetchColumn() === false) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'Plan not found for this user.'];
            }

            $delPlan = $this->db->prepare('DELETE FROM plans WHERE id = :plan_id');
            $delPlan->execute([':plan_id' => $planId]);

            $this->db->commit();
            return ['success' => true];
        } catch (PDOException $e) {
            $this->safeRollBack();
            $this->logWarning('deletePlanForUser failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }
    }

    /**
     * Sync plans for a user: upsert each plan and associate it with the user.
     *
     * @param list<array<string, mixed>> $plans
     * @return array{success: bool, synced_count: int, failed_count: int, errors: list<string>, error?: string, errors_truncated: bool}
     */
    public function syncPlans(string $userId, array $plans): array
    {
        $inputCount = count($plans);
        if ($inputCount > self::SYNC_PLANS_MAX_INPUT) {
            return [
                'success'           => false,
                'synced_count'      => 0,
                'failed_count'      => $inputCount,
                'errors'            => ['Too many plans in a single sync request.'],
                'errors_truncated'  => false,
            ];
        }

        if ($plans === []) {
            return [
                'success'          => true,
                'synced_count'     => 0,
                'failed_count'     => 0,
                'errors'           => [],
                'errors_truncated' => false,
            ];
        }

        if (!$this->isValidUuidV4($userId)) {
            return [
                'success'          => false,
                'synced_count'     => 0,
                'failed_count'     => $inputCount,
                'errors'           => ['Invalid user ID.'],
                'errors_truncated' => false,
            ];
        }

        $errors            = [];
        $errorsTruncated   = false;
        $failedCount       = 0;
        $validEntries      = [];
        $seenIds           = [];
        $currentTime       = $this->dateTimeString();

        $appendError = function (string $msg) use (&$errors, &$errorsTruncated): void {
            if (count($errors) < self::SYNC_PLANS_MAX_ERRORS) {
                $errors[] = $msg;
            } else {
                $errorsTruncated = true;
            }
        };

        // Phase 1: validate everything in memory; deduplicate by plan ID.
        foreach ($plans as $index => $plan) {
            $planId = $plan['id'] ?? null;
            if (!is_string($planId) || !$this->isValidUuidV4($planId)) {
                $failedCount++;
                $appendError("Plan at index {$index}: missing or invalid UUID ID.");
                continue;
            }
            if (isset($seenIds[$planId])) {
                $failedCount++;
                $appendError("Plan at index {$index} ({$planId}): duplicate plan ID in input.");
                continue;
            }
            $seenIds[$planId] = true;
            try {
                $normalized = $this->normalizePlan($plan, $currentTime);
                $validEntries[] = [$planId, $normalized];
            } catch (JsonException | InvalidArgumentException $e) {
                $failedCount++;
                $appendError("Plan at index {$index} ({$planId}): " . $e->getMessage());
            }
        }

        if ($validEntries === []) {
            return [
                'success'          => true,
                'synced_count'     => 0,
                'failed_count'     => $failedCount,
                'errors'           => $errors,
                'errors_truncated' => $errorsTruncated,
            ];
        }

        // Phase 2: transactional DB sync.
        try {
            $this->db->beginTransaction();

            $stmtPlan = $this->db->prepare(
                'INSERT INTO plans
                    (id, title, goal, duration_minutes, status, created_at, data)
                 VALUES
                    (:id, :title, :goal, :duration, :status, :created_at, :data) AS new
                 ON DUPLICATE KEY UPDATE
                     title            = new.title,
                     goal             = new.goal,
                     duration_minutes = new.duration_minutes,
                     status           = new.status,
                     data             = new.data,
                     updated_at       = CURRENT_TIMESTAMP'
            );

            $planIds = [];
            foreach ($validEntries as [$planId, $normalized]) {
                $stmtPlan->execute([
                    ':id'         => $planId,
                    ':title'      => $normalized['title'],
                    ':goal'       => $normalized['goal'],
                    ':duration'   => $normalized['duration'],
                    ':status'     => $normalized['status'],
                    ':created_at' => $normalized['created_at'],
                    ':data'       => $normalized['data'],
                ]);
                $planIds[] = $planId;
            }

            $this->bulkAssociatePlans($userId, $planIds);

            $this->db->commit();
        } catch (PDOException $e) {
            $this->safeRollBack();
            $this->logWarning('Plans sync transaction failed', $e);
            return [
                'success'          => false,
                'synced_count'     => 0,
                'failed_count'     => $inputCount,
                'errors'           => $errors,
                'error'            => 'Database transaction failed.',
                'errors_truncated' => $errorsTruncated,
            ];
        }

        return [
            'success'          => true,
            'synced_count'     => count($validEntries),
            'failed_count'     => $failedCount,
            'errors'           => $errors,
            'errors_truncated' => $errorsTruncated,
        ];
    }

    /**
     * @param list<string> $planIds
     */
    private function bulkAssociatePlans(string $userId, array $planIds): void
    {
        if ($planIds === []) {
            return;
        }
        foreach (array_chunk($planIds, self::BULK_BATCH_SIZE) as $chunk) {
            $placeholders = implode(', ', array_fill(0, count($chunk), '(?, ?)'));
            $params       = [];
            foreach ($chunk as $planId) {
                $params[] = $userId;
                $params[] = $planId;
            }
            $stmt = $this->db->prepare(
                "INSERT IGNORE INTO user_plans (user_id, plan_id) VALUES {$placeholders}"
            );
            $stmt->execute($params);
        }
    }

    // ==================================================================
    // User lookup
    // ==================================================================

    /** @return array{id: string, username: string, email: string, created_at: string}|null */
    public function getUserById(string $userId): ?array
    {
        if (!$this->isValidUuidV4($userId)) {
            return null;
        }
        try {
            $stmt = $this->db->prepare(
                'SELECT id, username, email, created_at FROM users WHERE id = :id LIMIT 1'
            );
            $stmt->execute([':id' => $userId]);
            return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        } catch (PDOException $e) {
            $this->logWarning('getUserById failed', $e);
            return null;
        }
    }

    /** @return array{id: string, username: string, email: string, created_at: string}|null */
    public function getUserByEmail(string $email): ?array
    {
        $email = mb_strtolower(trim($email), 'UTF-8');
        try {
            $stmt = $this->db->prepare(
                'SELECT id, username, email, created_at FROM users WHERE email = :email LIMIT 1'
            );
            $stmt->execute([':email' => $email]);
            return $stmt->fetch(\PDO::FETCH_ASSOC) ?: null;
        } catch (PDOException $e) {
            $this->logWarning('getUserByEmail failed', $e);
            return null;
        }
    }

    /**
     * Fetch a user's password hash by ID — shared by changePassword and deleteUser.
     * Returns null on error or not-found (caller cannot distinguish, which is
     * intentional for security).
     *
     * @throws PDOException Propagates to callers within transactions.
     */
    private function fetchPasswordHash(string $userId): ?string
    {
        $stmt = $this->db->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $userId]);
        $hash = $stmt->fetchColumn(0);
        return $hash !== false ? (string) $hash : null;
    }

    /**
     * Update username. Distinguishes "not found" from "unchanged" by checking
     * existence first — avoids relying on rowCount() semantics that vary by driver.
     *
     * @return array{success: bool, error?: string}
     */
    public function updateUsername(string $userId, string $username): array
    {
        if (!$this->isValidUuidV4($userId)) {
            return ['success' => false, 'error' => 'Invalid user ID.'];
        }
        try {
            $username = $this->validateUsername($username);
        } catch (InvalidArgumentException $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        try {
            $this->db->beginTransaction();

            $exists = $this->db->prepare('SELECT 1 FROM users WHERE id = :id FOR UPDATE');
            $exists->execute([':id' => $userId]);
            if ($exists->fetchColumn() === false) {
                $this->db->rollBack();
                return ['success' => false, 'error' => 'User not found.'];
            }

            $stmt = $this->db->prepare('UPDATE users SET username = :username WHERE id = :id');
            $stmt->execute([':username' => $username, ':id' => $userId]);

            $this->db->commit();
            return ['success' => true];
        } catch (PDOException $e) {
            $this->safeRollBack();
            if ($this->isDuplicateKeyError($e)) {
                return ['success' => false, 'error' => 'Username already exists.'];
            }
            $this->logWarning('updateUsername failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }
    }

    /**
     * Update email. Requires current password for re-verification.
     *
     * @return array{success: bool, error?: string}
     */
    public function updateEmail(
        string $userId,
        string $newEmail,
        #[\SensitiveParameter] string $currentPassword,
    ): array {
        if (!$this->isValidUuidV4($userId)) {
            return ['success' => false, 'error' => 'Invalid user ID.'];
        }
        try {
            $newEmail = $this->validateEmail($newEmail);
        } catch (InvalidArgumentException $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        try {
            $currentHash = $this->fetchPasswordHash($userId);
        } catch (PDOException $e) {
            $this->logWarning('updateEmail lookup failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }

        if ($currentHash === null || !password_verify($currentPassword, $currentHash)) {
            return ['success' => false, 'error' => 'Current password is incorrect.'];
        }

        try {
            $this->db->beginTransaction();
            $stmt = $this->db->prepare('UPDATE users SET email = :email WHERE id = :id');
            $stmt->execute([':email' => $newEmail, ':id' => $userId]);
            $this->db->commit();
            return ['success' => true];
        } catch (PDOException $e) {
            $this->safeRollBack();
            if ($this->isDuplicateKeyError($e)) {
                return ['success' => false, 'error' => 'Email already in use.'];
            }
            $this->logWarning('updateEmail failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }
    }

    /**
     * Change a user's password and revoke all active sessions atomically.
     *
     * @return array{success: bool, error?: string}
     */
    public function changePassword(
        string $userId,
        #[\SensitiveParameter] string $currentPassword,
        #[\SensitiveParameter] string $newPassword,
    ): array {
        if (!$this->isValidUuidV4($userId)) {
            return ['success' => false, 'error' => 'Invalid user ID.'];
        }

        try {
            $currentHash = $this->fetchPasswordHash($userId);
        } catch (PDOException $e) {
            $this->logWarning('changePassword lookup failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }

        if ($currentHash === null || !password_verify($currentPassword, $currentHash)) {
            return ['success' => false, 'error' => 'Current password is incorrect.'];
        }

        if (hash_equals($currentPassword, $newPassword)) {
            return ['success' => false, 'error' => 'New password must be different from the current password.'];
        }

        try {
            $newPassword = $this->validatePassword($newPassword);
        } catch (InvalidArgumentException $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }

        $newHash = $this->hashPassword($newPassword);
        if ($newHash === null) {
            return ['success' => false, 'error' => 'Failed to hash password.'];
        }

        try {
            $this->db->beginTransaction();

            $update = $this->db->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
            $update->execute([':hash' => $newHash, ':id' => $userId]);

            // Delete sessions inside the transaction — any failure rolls back the
            // password change too, preventing a "password changed but old sessions
            // still valid" state.
            $delSessions = $this->db->prepare('DELETE FROM user_sessions WHERE user_id = :user_id');
            $delSessions->execute([':user_id' => $userId]);

            $this->db->commit();
            return ['success' => true];
        } catch (PDOException $e) {
            $this->safeRollBack();
            $this->logWarning('changePassword update failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }
    }

    /**
     * Delete a user account. Related rows removed via ON DELETE CASCADE.
     * Plans themselves are NOT deleted (may be shared with other users).
     *
     * @return array{success: bool, error?: string}
     */
    public function deleteUser(
        string $userId,
        #[\SensitiveParameter] string $currentPassword,
    ): array {
        if (!$this->isValidUuidV4($userId)) {
            return ['success' => false, 'error' => 'Invalid user ID.'];
        }

        try {
            $currentHash = $this->fetchPasswordHash($userId);
        } catch (PDOException $e) {
            $this->logWarning('deleteUser lookup failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }

        if ($currentHash === null || !password_verify($currentPassword, $currentHash)) {
            return ['success' => false, 'error' => 'Current password is incorrect.'];
        }

        try {
            $stmt = $this->db->prepare('DELETE FROM users WHERE id = :id');
            $stmt->execute([':id' => $userId]);
            return ['success' => true];
        } catch (PDOException $e) {
            $this->logWarning('deleteUser failed', $e);
            return ['success' => false, 'error' => 'An unexpected error occurred.'];
        }
    }

    // ==================================================================
    // Admin / aggregate helpers
    // ==================================================================

    /** @return int Total number of registered users. */
    public function countAllUsers(): int
    {
        try {
            $count = $this->db->query('SELECT COUNT(*) FROM users')->fetchColumn(0);
            return $count !== false ? (int) $count : 0;
        } catch (PDOException $e) {
            $this->logWarning('countAllUsers failed', $e);
            return 0;
        }
    }

    /** @return int Total number of plans. */
    public function countAllPlans(): int
    {
        try {
            $count = $this->db->query('SELECT COUNT(*) FROM plans')->fetchColumn(0);
            return $count !== false ? (int) $count : 0;
        } catch (PDOException $e) {
            $this->logWarning('countAllPlans failed', $e);
            return 0;
        }
    }

    // ==================================================================
    // Utilities
    // ==================================================================

    private static function normalizeLimit(int $limit, int $default, int $max): int
    {
        return ($limit < 1 || $limit > $max) ? $default : $limit;
    }
}