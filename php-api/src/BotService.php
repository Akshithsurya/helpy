<?php

declare(strict_types=1);

final class BotService
{
    private const MAX_STORED_ACTIONS       = 100;
    private const RECENT_ACTION_LIMIT      = 10;
    private const DEFAULT_STORAGE_FILE     = __DIR__ . '/../data/bot_memory.json';

    public const ACTION_TASK_COMPLETED    = 'task_completed';
    public const ACTION_TIMER_COMPLETED   = 'timer_completed';
    public const ACTION_FOCUS_STARTED     = 'focus_started';
    public const ACTION_HABIT_LOGGED      = 'habit_logged';

    /** @var list<string> */
    private const VALID_ACTIONS = [
        self::ACTION_TASK_COMPLETED,
        self::ACTION_TIMER_COMPLETED,
        self::ACTION_FOCUS_STARTED,
        self::ACTION_HABIT_LOGGED,
    ];

    /** @var array<string, int> */
    private const DEFAULT_ACTION_COUNTS = [
        self::ACTION_TASK_COMPLETED  => 0,
        self::ACTION_TIMER_COMPLETED => 0,
        self::ACTION_FOCUS_STARTED   => 0,
        self::ACTION_HABIT_LOGGED    => 0,
    ];

    /** @var list<string> */
    private static array $facts = [
        "The Pomodoro Technique was created in the late 1980s by Francesco Cirillo using a tomato-shaped kitchen timer.",
        "Taking a short 5-minute break every 25 minutes helps improve long-term memory consolidation and mental clarity.",
        "Writing down your goals increases the probability of achieving them by up to 42%.",
        "Erlang was created at Ericsson Computer Science Laboratory in 1986 to support fault-tolerant telecommunication systems.",
        "PHP was created by Rasmus Lerdorf in 1994 as a set of Common Gateway Interface (CGI) binaries written in C.",
        "Multitasking can reduce productivity by up to 40% due to cognitive context switching costs.",
        "The 'Zeigarnik Effect' states that people remember uncompleted or interrupted tasks better than completed ones.",
        "Small daily improvements of 1% compound to a 37x improvement over the course of a single year.",
        "The human brain uses about 20% of the body's total energy despite accounting for only 2% of its mass.",
        "Dopamine is released not just when achieving a goal, but in anticipation of completing a task."
    ];

    /** @var array<string, list<string>> */
    private static array $motivations = [
        'high_activity' => [
            "You are on absolute fire! Keep pushing boundaries and conquer your goals!",
            "Phenomenal work today! Your focus and discipline are inspiring.",
            "You're making incredible progress! Remember how far you've come."
        ],
        'medium_activity' => [
            "Great consistency! Every single completed task brings you closer to mastery.",
            "Solid progress! Step by step, you are turning goals into reality.",
            "Keep up the momentum! You're doing great work."
        ],
        'low_activity' => [
            "Every journey begins with a single small step. Pick one quick task and win today!",
            "Don't worry about being perfect; focus on taking action right now.",
            "A fresh start is always available. You've got this!"
        ]
    ];

    // Comprehensive emoji regex (includes supplementary multilingual planes, flags, and variation selectors)
    private const EMOJI_REGEX = '/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE00}-\x{FE0F}\x{1F1E6}-\x{1F1FF}\x{1F900}-\x{1F9FF}]/u';

    private string $storageFile;

    public function __construct(?string $storageFile = null)
    {
        $this->storageFile = $storageFile ?? self::DEFAULT_STORAGE_FILE;
    }

    // ---------- Memory structure helpers ----------

    /** @return array<string, mixed> */
    private function getDefaultMemory(): array
    {
        return [
            'total_actions'   => 0,
            'actions'         => [],
            'action_counts'   => self::DEFAULT_ACTION_COUNTS,
        ];
    }

    /**
     * Merge stored memory with defaults so new keys always exist for older files.
     *
     * @param array<string, mixed> $stored
     * @return array<string, mixed>
     */
    private function mergeMemory(array $stored): array
    {
        $defaults = $this->getDefaultMemory();
        $merged   = array_merge($defaults, $stored);

        $storedCounts = is_array($stored['action_counts'] ?? null) ? $stored['action_counts'] : [];
        $merged['action_counts'] = array_merge($defaults['action_counts'], $storedCounts);

        if (!is_array($merged['actions'] ?? null)) {
            $merged['actions'] = [];
        }

        return $merged;
    }

    // ---------- Storage I/O ----------

    /** @return array<string, mixed> */
    private function readMemory(): array
    {
        if (!is_file($this->storageFile)) {
            return $this->getDefaultMemory();
        }

        $fp = @fopen($this->storageFile, 'r');
        if ($fp === false) {
            return $this->getDefaultMemory();
        }

        try {
            if (!flock($fp, LOCK_SH)) {
                return $this->getDefaultMemory();
            }

            $raw = stream_get_contents($fp);
            flock($fp, LOCK_UN);

            if ($raw === false || $raw === '') {
                return $this->getDefaultMemory();
            }

            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                return $this->getDefaultMemory();
            }

            return $this->mergeMemory($decoded);
        } finally {
            fclose($fp);
        }
    }

    /** @param array<string, mixed> $memory */
    private function saveMemory(array $memory): void
    {
        $this->ensureStorageDir();

        $fp = @fopen($this->storageFile, 'c+');
        if ($fp === false) {
            throw new \RuntimeException(
                sprintf('Unable to open storage file "%s" for writing.', $this->storageFile)
            );
        }

        try {
            if (!flock($fp, LOCK_EX)) {
                throw new \RuntimeException(
                    sprintf('Unable to acquire exclusive lock on "%s".', $this->storageFile)
                );
            }

            ftruncate($fp, 0);
            rewind($fp);

            $payload = json_encode(
                $memory,
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
            );

            if ($payload === false) {
                throw new \RuntimeException('Failed to encode bot memory to JSON.');
            }

            fwrite($fp, $payload);
            fflush($fp);
            flock($fp, LOCK_UN);
        } finally {
            fclose($fp);
        }
    }

    private function ensureStorageDir(): void
    {
        $dir = dirname($this->storageFile);

        if (is_dir($dir)) {
            if (!is_writable($dir)) {
                throw new \RuntimeException(sprintf('Directory "%s" is not writable.', $dir));
            }
            return;
        }

        if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException(sprintf('Directory "%s" was not created.', $dir));
        }
    }

    // ---------- Sanitization ----------

    private static function removeEmojis(string $value): string
    {
        if ($value === '') {
            return '';
        }

        $cleaned = preg_replace(self::EMOJI_REGEX, '', $value);
        $cleaned = preg_replace('/\s{2,}/u', ' ', (string)$cleaned);

        return trim($cleaned);
    }

    /**
     * Recursively sanitizes strings and arrays to remove emojis.
     *
     * @param mixed $data
     * @return mixed
     */
    private function sanitizeData(mixed $data): mixed
    {
        if (is_string($data)) {
            return self::removeEmojis($data);
        }

        if (is_array($data)) {
            $cleaned = [];
            foreach ($data as $key => $value) {
                $cleanKey          = is_string($key) ? self::removeEmojis($key) : $key;
                $cleaned[$cleanKey] = $this->sanitizeData($value);
            }
            return $cleaned;
        }

        return $data;
    }

    // ---------- Public API ----------

    /**
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    public function logAction(string $actionType, string $detail, array $meta = []): array
    {
        $this->assertValidActionType($actionType);

        $memory = $this->readMemory();

        $actionEntry = [
            'id'        => 'act_' . bin2hex(random_bytes(8)),
            'type'      => $actionType,
            'detail'    => self::removeEmojis($detail),
            'meta'      => $this->sanitizeData($meta),
            'timestamp' => (new \DateTimeImmutable())->format(\DateTimeInterface::ATOM),
        ];

        array_unshift($memory['actions'], $actionEntry);
        $memory['actions'] = array_slice($memory['actions'], 0, self::MAX_STORED_ACTIONS);

        $memory['total_actions'] = ($memory['total_actions'] ?? 0) + 1;
        $memory['action_counts'][$actionType] = ($memory['action_counts'][$actionType] ?? 0) + 1;

        $this->saveMemory($memory);

        return [
            'success'       => true,
            'action'        => $actionEntry,
            'total_actions' => $memory['total_actions'],
        ];
    }

    /** @return array<string, mixed> */
    public function getMemory(): array
    {
        $memory = $this->readMemory();
        $total  = (int)($memory['total_actions'] ?? 0);
        $counts = is_array($memory['action_counts'] ?? null) ? $memory['action_counts'] : [];
        $recent = array_slice($memory['actions'] ?? [], 0, self::RECENT_ACTION_LIMIT);

        $summaryParts = ["Helpy Bot remembers {$total} actions recorded so far."];

        $tasksCompleted = (int)($counts[self::ACTION_TASK_COMPLETED] ?? 0);
        if ($tasksCompleted > 0) {
            $summaryParts[] = "You have completed {$tasksCompleted} tasks!";
        }

        $focusSessions = (int)($counts[self::ACTION_FOCUS_STARTED] ?? 0)
                       + (int)($counts[self::ACTION_TIMER_COMPLETED] ?? 0);
        if ($focusSessions > 0) {
            $summaryParts[] = "You ran {$focusSessions} focus sessions.";
        }

        return [
            'success'         => true,
            'total_actions'   => $total,
            'action_counts'   => $counts,
            'recent_actions'  => $recent,
            'summary'         => implode(' ', $summaryParts),
        ];
    }

    /** @return array<string, mixed> */
    public function getRandomFact(): array
    {
        $fact = self::selectRandom(self::$facts);

        return [
            'success'  => true,
            'fact'     => $fact,
            'category' => 'productivity & tech',
        ];
    }

    /** @return array<string, mixed> */
    public function getMotivation(): array
    {
        $memory   = $this->readMemory();
        $total    = (int)($memory['total_actions'] ?? 0);
        $category = $this->categorizeActivity($total);
        $selected = self::selectRandom(self::$motivations[$category]);

        return [
            'success'        => true,
            'motivation'     => $selected,
            'activity_level' => $category,
            'total_actions'  => $total,
        ];
    }

    /** @return array<string, mixed> */
    public function getGreeting(): array
    {
        $hour = (int)(new \DateTimeImmutable())->format('G');
        $now  = new \DateTimeImmutable();

        if ($hour < 12) {
            $greeting = 'Good morning';
        } elseif ($hour < 18) {
            $greeting = 'Good afternoon';
        } else {
            $greeting = 'Good evening';
        }

        return [
            'success'  => true,
            'greeting' => $greeting,
            'time'     => $now->format(\DateTimeInterface::ATOM),
        ];
    }

    // ---------- Internal helpers ----------

    private function assertValidActionType(string $actionType): void
    {
        if (!in_array($actionType, self::VALID_ACTIONS, true)) {
            throw new \InvalidArgumentException(
                sprintf('Unknown action type "%s".', $actionType)
            );
        }
    }

    private function categorizeActivity(int $total): string
    {
        if ($total >= 10) {
            return 'high_activity';
        }
        if ($total >= 3) {
            return 'medium_activity';
        }
        return 'low_activity';
    }

    /**
     * @param list<string> $items
     */
    private static function selectRandom(array $items): string
    {
        if ($items === []) {
            return '';
        }
        return $items[array_rand($items)];
    }
}