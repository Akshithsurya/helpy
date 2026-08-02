<?php
declare(strict_types=1);

/**
 * 企业级安全服务 - 加密、哈希、签名及 Web 安全防护。
 *
 * 主要改进点：
 *  - 使用 HKDF 从主密钥派生子密钥（加密 / MAC / Pepper），实现密钥隔离。
 *  - 缓存二进制密钥，避免每次加解密重复 hex2bin。
 *  - 引入 __debugInfo 防止密钥在调试输出中泄露。
 *  - Pepper 策略改为 HMAC 预哈希，提升离线破解难度并规避潜在边界问题。
 *  - 加解密支持 AAD (附加认证数据)，实现上下文绑定。
 *  - 对签名数据使用“规范化 JSON”（递归 ksort），避免键顺序差异导致验证失败。
 *  - 正确解析 X-Forwarded-Proto（可能是逗号分隔的多级代理链）。
 *  - HSTS 仅在 HTTPS 下发送，避免在 HTTP 上“自爆”。
 *  - 密码哈希引入 Pepper，进一步提升离线破解难度。
 *  - 类标记为 final，防止子类绕过安全控制。
 */

final class SecurityService
{
    private const DEFAULT_CIPHER       = 'aes-256-gcm';
    private const GCM_TAG_LENGTH       = 16;
    private const KEY_HEX_LENGTH       = 64;          // 32 bytes
    private const KEY_BIN_LENGTH       = 32;          // 256 bits
    private const TOKEN_MIN_BYTES      = 16;
    private const TOKEN_DEFAULT_BYTES  = 32;
    private const HKDF_INFO_ENCRYPTION = 'security|encryption|v1';
    private const HKDF_INFO_MAC        = 'security|mac|v1';
    private const HKDF_INFO_PEPPER     = 'security|pepper|v1';

    private readonly string $encryptionKey; // binary
    private readonly string $macKey;        // binary
    private readonly string $pepperKey;     // binary
    private readonly string $cipherMethod;
    private readonly int $ivLength;

    /**
     * @param string|null $secretKey     64 位十六进制字符串（32 字节熵）；留空则从环境变量读取
     * @param string $cipherMethod  必须存在于 openssl_get_cipher_methods()
     */
    public function __construct(?string $secretKey = null, string $cipherMethod = self::DEFAULT_CIPHER)
    {
        if ($secretKey === null || $secretKey === '') {
            $envKey = getenv('APP_SECRET_KEY');
            if (is_string($envKey) && ctype_xdigit($envKey) && strlen($envKey) === self::KEY_HEX_LENGTH) {
                $secretKey = $envKey;
            } else {
                // 非 CLI 环境下强制要求配置，防止使用临时密钥导致线上数据无法恢复
                if (PHP_SAPI !== 'cli') {
                    throw new RuntimeException(
                        'No APP_SECRET_KEY configured. SecurityService requires a persistent key in production.'
                    );
                }
                $secretKey = self::generateSecretKey();
                error_log('[Helpy] WARNING: No APP_SECRET_KEY configured. Generated an ephemeral key for CLI usage.');
            }
        }

        if (!ctype_xdigit($secretKey) || strlen($secretKey) !== self::KEY_HEX_LENGTH) {
            throw new InvalidArgumentException(
                'Secret key must be exactly 64 hexadecimal characters (32 bytes).'
            );
        }

        $available = openssl_get_cipher_methods(true);
        if (!in_array(strtolower($cipherMethod), array_map('strtolower', $available), true)) {
            throw new InvalidArgumentException(sprintf('Unsupported cipher method: %s', $cipherMethod));
        }

        $ivLength = openssl_cipher_iv_length($cipherMethod);
        if ($ivLength === false || $ivLength < 1) {
            throw new InvalidArgumentException(sprintf('Cannot determine IV length for: %s', $cipherMethod));
        }

        $this->cipherMethod = $cipherMethod;
        $this->ivLength     = $ivLength;

        $rawKey              = hex2bin($secretKey);
        // 显式指定派生 32 字节密钥
        $this->encryptionKey = hash_hkdf('sha256', $rawKey, self::KEY_BIN_LENGTH, self::HKDF_INFO_ENCRYPTION);
        $this->macKey        = hash_hkdf('sha256', $rawKey, self::KEY_BIN_LENGTH, self::HKDF_INFO_MAC);
        $this->pepperKey     = hash_hkdf('sha256', $rawKey, self::KEY_BIN_LENGTH, self::HKDF_INFO_PEPPER);
    }

    /**
     * 防止密钥在调试过程中意外泄露 (var_dump / print_r / Xdebug)。
     */
    public function __debugInfo(): array
    {
        return [
            'cipherMethod' => $this->cipherMethod,
            'ivLength'     => $this->ivLength,
            'encryptionKey' => '[REDACTED]',
            'macKey'        => '[REDACTED]',
            'pepperKey'     => '[REDACTED]',
        ];
    }

    /**
     * 生成主密钥（仅用于初始化配置，不应在每次实例化时调用）。
     */
    public static function generateSecretKey(): string
    {
        return bin2hex(random_bytes(self::KEY_BIN_LENGTH));
    }

    /**
     * 加密数据（默认 AES-256-GCM，认证加密）。
     *
     * @param mixed  $data           要加密的数据
     * @param string $associatedData 附加认证数据 (AAD)，用于上下文绑定，解密时需一致
     *
     * @throws JsonException
     * @throws RuntimeException
     */
    public function encrypt(mixed $data, string $associatedData = ''): string
    {
        $payload = json_encode(
            $data,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        $iv      = random_bytes($this->ivLength);
        $authTag = '';

        $encrypted = openssl_encrypt(
            $payload,
            $this->cipherMethod,
            $this->encryptionKey,
            OPENSSL_RAW_DATA,
            $iv,
            $authTag,
            $associatedData,
            self::GCM_TAG_LENGTH
        );

        if ($encrypted === false) {
            throw new RuntimeException('Encryption failed: ' . (openssl_error_string() ?: 'unknown'));
        }

        // Layout: IV || AuthTag || Ciphertext
        return base64_encode($iv . $authTag . $encrypted);
    }

    /**
     * 解密数据。
     *
     * @param string $encryptedData 加密字符串
     * @param string $associatedData 附加认证数据 (AAD)，必须与加密时一致
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException
     * @throws JsonException
     */
    public function decrypt(string $encryptedData, string $associatedData = ''): mixed
    {
        $raw = base64_decode($encryptedData, true);
        if ($raw === false) {
            throw new InvalidArgumentException('Invalid base64 encoded data.');
        }

        $minLen = $this->ivLength + self::GCM_TAG_LENGTH;
        if (strlen($raw) < $minLen) {
            throw new InvalidArgumentException('Invalid encrypted payload length.');
        }

        $iv         = substr($raw, 0, $this->ivLength);
        $authTag    = substr($raw, $this->ivLength, self::GCM_TAG_LENGTH);
        $ciphertext = substr($raw, $this->ivLength + self::GCM_TAG_LENGTH);

        $decrypted = openssl_decrypt(
            $ciphertext,
            $this->cipherMethod,
            $this->encryptionKey,
            OPENSSL_RAW_DATA,
            $iv,
            $authTag,
            $associatedData
        );

        if ($decrypted === false) {
            // 清理 OpenSSL 错误队列，防止污染后续操作
            while (openssl_error_string() !== false) {}
            throw new RuntimeException('Decryption failed or authentication tag mismatch (tampering suspected).');
        }

        try {
            return json_decode($decrypted, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new RuntimeException('Decrypted payload is not valid JSON.', 0, $e);
        }
    }

    /**
     * 生成密码哈希（优先 Argon2id，附带服务器端 Pepper）。
     *
     * 注意：使用 HMAC 预哈希处理 Pepper，而不是简单拼接。
     * 这能防止长度扩展攻击，并解决 bcrypt 72 字节截断的历史遗留问题。
     */
    public function hashPassword(string $password): string
    {
        $pepperedPassword = hash_hmac('sha256', $password, $this->pepperKey);

        if (defined('PASSWORD_ARGON2ID')) {
            $hash = password_hash($pepperedPassword, PASSWORD_ARGON2ID, [
                'memory_cost' => 65536, // 64 MB
                'time_cost'   => 4,
                'threads'     => 3,
            ]);
        } else {
            $hash = password_hash($pepperedPassword, PASSWORD_BCRYPT, ['cost' => 12]);
        }

        if ($hash === false || $hash === null) {
            throw new RuntimeException('Password hashing failed.');
        }

        return $hash;
    }

    /**
     * 验证密码哈希。
     */
    public function verifyPassword(string $password, string $hashedPassword): bool
    {
        $pepperedPassword = hash_hmac('sha256', $password, $this->pepperKey);
        return password_verify($pepperedPassword, $hashedPassword);
    }

    /**
     * 生成 HMAC-SHA256（使用独立 MAC 子密钥）。
     */
    public function generateMac(string $data): string
    {
        return hash_hmac('sha256', $data, $this->macKey);
    }

    /**
     * 验证 HMAC（恒定时间比较）。
     */
    public function verifyMac(string $data, string $expectedMac): bool
    {
        return hash_equals($this->generateMac($data), $expectedMac);
    }

    /**
     * 生成 URL 安全的随机令牌。
     *
     * @param int $bytes 原始字节数（不是字符数）
     */
    public function generateToken(int $bytes = self::TOKEN_DEFAULT_BYTES): string
    {
        if ($bytes < self::TOKEN_MIN_BYTES) {
            throw new InvalidArgumentException(
                sprintf('Token length must be at least %d bytes.', self::TOKEN_MIN_BYTES)
            );
        }
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    /**
     * 对数据数组进行签名。
     */
    public function signData(array $data): array
    {
        return [
            'data'      => $data,
            'signature' => $this->generateMac($this->canonicalJson($data)),
        ];
    }

    /**
     * 验证签名数据（对键顺序无关）。
     */
    public function verifySignedData(array $signedData): bool
    {
        if (!isset($signedData['data'], $signedData['signature'])
            || !is_array($signedData['data'])
            || !is_string($signedData['signature'])
        ) {
            return false;
        }

        try {
            $payload = $this->canonicalJson($signedData['data']);
        } catch (JsonException) {
            return false;
        }

        return $this->verifyMac($payload, $signedData['signature']);
    }

    /**
     * 输出 HTML 转义（防止 XSS）。
     */
    public function escapeOutput(array|string $input): array|string
    {
        if (is_array($input)) {
            $out = [];
            foreach ($input as $k => $v) {
                $out[$k] = $this->escapeOutput($v);
            }
            return $out;
        }

        return htmlspecialchars(
            (string)$input,
            ENT_QUOTES | ENT_HTML5 | ENT_SUBSTITUTE,
            'UTF-8'
        );
    }

    /**
     * 判断当前请求是否通过 HTTPS。
     *
     * @param array $trustedProxies 可信反向代理 IP 列表
     */
    public function isRequestSecure(array $trustedProxies = []): bool
    {
        $remoteAddr     = $_SERVER['REMOTE_ADDR'] ?? '';
        $isTrustedProxy = empty($trustedProxies) || in_array($remoteAddr, $trustedProxies, true);

        if ($isTrustedProxy && !empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
            // 链式代理可能产生 "https, http" 形式；取最左侧（最原始客户端）的协议。
            $protos = array_map('trim', explode(',', (string)$_SERVER['HTTP_X_FORWARDED_PROTO']));
            $first  = strtolower($protos[0] ?? '');
            if ($first === 'https') {
                return true;
            }
            if ($first === 'http') {
                return false;
            }
        }

        $https = $_SERVER['HTTPS'] ?? '';
        if (!empty($https) && strtolower($https) !== 'off') {
            return true;
        }

        return isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443;
    }

    /**
     * 输出现代 Web 安全响应头。
     *
     * @param string|null $csp 自定义 Content-Security-Policy，留空使用默认严格策略
     */
    public function setSecurityHeaders(?string $csp = null): void
    {
        if (headers_sent()) {
            return;
        }

        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Embedder-Policy: require-corp');
        header('Cross-Origin-Resource-Policy: same-origin');

        // HSTS 仅在 HTTPS 下发送，否则会让浏览器“拒绝”访问 HTTP 资源。
        if ($this->isRequestSecure()) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains; preload');
        }

        header('Content-Security-Policy: ' . (
            $csp ?? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                 . "img-src 'self' data: https:; connect-src 'self'; font-src 'self'; "
                 . "object-src 'none'; base-uri 'self'; form-action 'self';"
        ));

        header('Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    }

    /**
     * 规范化 JSON：递归 ksort + 紧凑输出，使签名与键顺序无关。
     */
    private function canonicalJson(array $data): string
    {
        $sort = static function (array &$arr) use (&$sort): void {
            foreach ($arr as &$v) {
                if (is_array($v)) {
                    $sort($v);
                }
            }
            unset($v);
            ksort($arr, SORT_STRING);
        };
        $sort($data);

        return json_encode(
            $data,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
    }
}