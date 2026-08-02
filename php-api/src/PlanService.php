<?php

declare(strict_types=1);

/**
 * Service for creating, managing, persisting, and exporting session plans.
 *
 * Plans represent a timed work session broken into chunked tasks with optional
 * breaks. This service handles the full lifecycle: parsing input, generating
 * task breakdowns, CRUD via a database backend, and export to multiple formats.
 */
class PlanService
{
    public const STATUS_PENDING      = 'pending';
    public const STATUS_IN_PROGRESS  = 'in_progress';
    public const STATUS_COMPLETED    = 'completed';
    public const STATUS_CANCELLED    = 'cancelled';

    /** @var string[] */
    private const VALID_STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_IN_PROGRESS,
        self::STATUS_COMPLETED,
        self::STATUS_CANCELLED,
    ];

    private const TASK_DESCRIPTORS = [
        'Start strong',
        'Keep going',
        'Making progress',
        'Almost there',
        'Final push',
    ];

    private const DEFAULT_SESSION_TITLE = 'Planned session';
    private const DEFAULT_FALLBACK_TITLE = 'Untitled Plan';
    private const DEFAULT_DURATION_MINUTES = 30;
    private const DEFAULT_BREAK_MINUTES = 5;

    /** Cached emoji regex — built once per process */
    private static ?string $emojiRegex = null;

    public function __construct(
        private readonly Database $db
    ) {}

    // ─── Parsing & Creation ───────────────────────────────────────────────

    public function parsePlan(string $args): array
    {
        return PlanParser::parse($args);
    }

    /**
     * Build a complete plan array from a raw input string and optional overrides.
     */
    public function createPlan(string $args, array $options = []): array
    {
        $parsed = $this->parsePlan($args);

        $durationMinutes = $this->resolveOption('durationMinutes', $options, $parsed, self::DEFAULT_DURATION_MINUTES);
        $chunkSizeMinutes = $this->resolveOption('chunkSizeMinutes', $options, $parsed, $durationMinutes);
        $breakMinutes     = $this->resolveOption('breakMinutes', $options, $parsed, self::DEFAULT_BREAK_MINUTES);
        $includeBreaks    = $this->resolveOption('includeBreaks', $options, $parsed, false);
        $createdAt        = $this->resolveOption('createdAt', $options, $parsed, date('c'));
        $source           = $this->resolveOption('source', $options, $parsed, 'php-api');
        $nextQueue        = $this->resolveOption('nextQueue', $options, $parsed, []);

        $title = $this->sanitizeTitle(
            $this->resolveOption('title', $options, $parsed, ''),
            self::DEFAULT_SESSION_TITLE
        );
        $goal = $this->sanitizeText($this->resolveOption('goal', $options, $parsed, ''));
        $tags = $this->sanitizeTags($this->resolveOption('tags', $options, $parsed, []));

        $tasks = $this->breakDownIntoTasks(
            $goal,
            $durationMinutes,
            $chunkSizeMinutes,
            $breakMinutes,
            $includeBreaks
        );

        return [
            'id'               => $this->generateId(),
            'title'            => $title,
            'goal'             => $goal,
            'durationMinutes'  => $durationMinutes,
            'tasks'            => $tasks,
            'chunkSizeMinutes' => $chunkSizeMinutes,
            'breakMinutes'     => $breakMinutes,
            'nextQueue'        => $nextQueue,
            'source'           => $source,
            'createdAt'        => $createdAt,
            'status'           => self::STATUS_PENDING,
            'tags'             => $tags,
        ];
    }

    /**
     * Resolve a configuration value by checking options, then parsed input, then default
     */
    private function resolveOption(string $key, array $options, array $parsed, mixed $default): mixed
    {
        return $options[$key] ?? $parsed[$key] ?? $default;
    }

    /**
     * Create a plan with validation guard. Returns a structured result envelope.
     *
     * @return array{success: bool, plan?: array, errors?: string[]}
     */
    public function createPlanSafe(string $args, array $options = []): array
    {
        $plan       = $this->createPlan($args, $options);
        $validation = PlanValidator::validate($plan);

        if (!$validation['valid']) {
            return [
                'success' => false,
                'errors'  => $validation['errors'],
            ];
        }

        return [
            'success' => true,
            'plan'    => $plan,
        ];
    }

    // ─── Task Breakdown ───────────────────────────────────────────────────

    /**
     * Split a total duration into chunked focus tasks, optionally interleaving breaks.
     */
    private function breakDownIntoTasks(
        string $goal,
        int    $durationMinutes,
        int    $chunkSizeMinutes,
        int    $breakMinutes,
        bool   $includeBreaks
    ): array {
        if ($durationMinutes <= 0) {
            return [];
        }

        $chunkSizeMinutes = max(1, $chunkSizeMinutes);
        $breakMinutes = max(0, $breakMinutes);

        $tasks     = [];
        $remaining = $durationMinutes;
        $descriptorCount = count(self::TASK_DESCRIPTORS);

        for ($chunkIndex = 0; $remaining > 0; $chunkIndex++) {
            $chunkDuration = min($chunkSizeMinutes, $remaining);
            $descriptor    = self::TASK_DESCRIPTORS[min($chunkIndex, $descriptorCount - 1)];

            $taskTitle = $goal !== ''
                ? "{$descriptor}: {$goal}"
                : "{$descriptor} – Part " . ($chunkIndex + 1);

            $tasks[]    = $this->buildTask($taskTitle, $chunkDuration, false);
            $remaining -= $chunkDuration;

            if ($includeBreaks && $remaining > 0 && $breakMinutes > 0) {
                $breakDuration = min($breakMinutes, $remaining);
                $tasks[]       = $this->buildTask('Break', $breakDuration, true);
                $remaining    -= $breakDuration;
            }
        }

        return $tasks;
    }

    /**
     * Build a standard task or a break task.
     */
    private function buildTask(string $title, int $durationMinutes, bool $isBreak = false): array
    {
        return [
            'id'              => $this->generateId($isBreak ? 'task-break-' : 'task-'),
            'title'           => $title,
            'durationMinutes' => $durationMinutes,
            'completed'       => false,
            'completedAt'     => null,
            'isBreak'         => $isBreak,
        ];
    }

    // ─── ID Generation ────────────────────────────────────────────────────

    private function generateId(string $prefix = 'plan-'): string
    {
        return $prefix . bin2hex(random_bytes(8));
    }

    // ─── Lifecycle Transitions ────────────────────────────────────────────

    /**
     * @throws \InvalidArgumentException If plan is already completed or cancelled
     */
    public function startPlan(array $plan): array
    {
        if (!in_array($plan['status'] ?? '', [self::STATUS_PENDING, self::STATUS_IN_PROGRESS], true)) {
            throw new \InvalidArgumentException('Cannot start a plan that is already completed or cancelled');
        }

        return array_merge($plan, [
            'status'    => self::STATUS_IN_PROGRESS,
            'startedAt' => date('c'),
        ]);
    }

    /**
     * @throws \InvalidArgumentException If plan is already cancelled
     */
    public function completePlan(array $plan): array
    {
        if (($plan['status'] ?? '') === self::STATUS_CANCELLED) {
            throw new \InvalidArgumentException('Cannot complete a cancelled plan');
        }

        $now = date('c');

        return array_merge($plan, [
            'status'      => self::STATUS_COMPLETED,
            'completedAt' => $now,
            'tasks'       => $this->markAllTasksCompleted($plan['tasks'] ?? [], $now),
        ]);
    }

    /**
     * @throws \InvalidArgumentException If plan is already completed
     */
    public function cancelPlan(array $plan): array
    {
        if (($plan['status'] ?? '') === self::STATUS_COMPLETED) {
            throw new \InvalidArgumentException('Cannot cancel a completed plan');
        }

        return array_merge($plan, [
            'status'      => self::STATUS_CANCELLED,
            'cancelledAt' => date('c'),
        ]);
    }

    /**
     * @throws \InvalidArgumentException If task ID not found in plan
     */
    public function completeTask(array $plan, string $taskId): array
    {
        $taskExists = false;
        $now = date('c');

        $updatedTasks = array_map(
            function(array $task) use ($taskId, $now, &$taskExists): array {
                if (($task['id'] ?? null) === $taskId) {
                    $taskExists = true;
                    return [...$task, 'completed' => true, 'completedAt' => $now];
                }
                return $task;
            },
            $plan['tasks'] ?? []
        );

        if (!$taskExists) {
            throw new \InvalidArgumentException("Task with ID {$taskId} not found in plan");
        }

        return array_merge($plan, ['tasks' => $updatedTasks]);
    }

    // ─── Statistics ────────────────────────────────────────────────────────

    /**
     * Compute aggregate stats for a plan's current task state.
     * Optimized to a single-pass loop over the tasks array.
     *
     * @return array{
     *     totalFocusMinutes: int,
     *     totalTasks: int,
     *     tasksCompleted: int,
     *     completionPercentage: int,
     *     estimatedDurationMinutes: int
     * }
     */
    public function calculateSessionStats(array $plan): array
    {
        $tasks = $plan['tasks'] ?? [];
        
        $totalTasks = 0;
        $tasksCompleted = 0;
        $focusMinutes = 0;

        foreach ($tasks as $task) {
            if (!empty($task['isBreak'])) {
                continue;
            }

            $totalTasks++;
            $focusMinutes += (int)($task['durationMinutes'] ?? 0);

            if (!empty($task['completed'])) {
                $tasksCompleted++;
            }
        }
        
        $completionPct = $totalTasks > 0
            ? (int) round(($tasksCompleted / $totalTasks) * 100)
            : 0;

        return [
            'totalFocusMinutes'        => $focusMinutes,
            'totalTasks'               => $totalTasks,
            'tasksCompleted'           => $tasksCompleted,
            'completionPercentage'     => $completionPct,
            'estimatedDurationMinutes' => $plan['durationMinutes'] ?? 0,
        ];
    }

    // ─── Export ────────────────────────────────────────────────────────────

    /**
     * Render a plan in the requested format.
     *
     * @param array{format?: string, includeTasks?: bool, includeMetadata?: bool} $options
     */
    public function exportPlan(array $plan, array $options = []): string
    {
        $format          = $options['format']          ?? 'json';
        $includeTasks    = $options['includeTasks']    ?? true;
        $includeMetadata = $options['includeMetadata'] ?? true;

        return match ($format) {
            'markdown' => $this->exportPlanMarkdown($plan, $includeTasks),
            'text'     => $this->exportPlanText($plan, $includeTasks),
            default    => $this->exportPlanJson($plan, $includeTasks, $includeMetadata),
        };
    }

    private function exportPlanJson(array $plan, bool $includeTasks, bool $includeMetadata): string
    {
        $export = $plan;

        if (!$includeTasks) {
            unset($export['tasks']);
        }
        if (!$includeMetadata) {
            unset($export['createdAt'], $export['source'], $export['nextQueue'], $export['updatedAt']);
        }

        return json_encode($export, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private function exportPlanMarkdown(array $plan, bool $includeTasks): string
    {
        $header = $this->buildExportHeader($plan, '# ', '## ');
        $body   = $includeTasks ? $this->buildTaskList($plan['tasks'] ?? [], "## Tasks\n\n") : '';

        return $header . $body;
    }

    private function exportPlanText(array $plan, bool $includeTasks): string
    {
        $header = $this->buildExportHeader($plan, '', '');
        $body   = $includeTasks ? $this->buildTaskList($plan['tasks'] ?? [], "\nTasks:\n") : '';

        return $header . $body;
    }

    private function buildExportHeader(array $plan, string $headingPrefix, string $subPrefix): string
    {
        $title    = $this->sanitizeTitle($plan['title'] ?? '', self::DEFAULT_FALLBACK_TITLE);
        $goal     = $this->sanitizeText($plan['goal'] ?? '');
        $duration = $plan['durationMinutes'] ?? 0;

        $parts = ["{$headingPrefix}{$title}\n\n"];

        if ($goal !== '') {
            $parts[] = "{$subPrefix}Goal\n{$goal}\n\n";
        }

        $parts[] = "{$subPrefix}Duration\n{$duration} minutes\n\n";
        $parts[] = "{$subPrefix}Status\n" . ucwords(str_replace('_', ' ', $plan['status'] ?? 'unknown')) . "\n\n";

        return implode('', $parts);
    }

    private function buildTaskList(array $tasks, string $heading): string
    {
        if (empty($tasks)) {
            return '';
        }
        $lines = [$heading];
        foreach ($tasks as $task) {
            $mark  = !empty($task['completed']) ? '[x]' : '[ ]';
            $title = $this->sanitizeText($task['title'] ?? '');
            $dur   = (int) ($task['durationMinutes'] ?? 0);
            $prefix = !empty($task['isBreak']) ? '  *' : '-';
            $lines[] = "{$prefix} {$mark} {$title} ({$dur} min)\n";
        }

        return implode('', $lines);
    }

    // ─── Database CRUD ────────────────────────────────────────────────────

    /** @return list<array> */
    public function getAllPlans(): array
    {
        $rows = $this->db->fetchAll('SELECT * FROM plans ORDER BY created_at DESC');
        return array_map($this->unserializePlan(...), $rows);
    }

    /**
     * @return list<array>
     */
    public function getPlansByStatus(string $status): array
    {
        if (!in_array($status, self::VALID_STATUSES, true)) {
            throw new \InvalidArgumentException('Invalid plan status provided');
        }

        $rows = $this->db->fetchAll('SELECT * FROM plans WHERE status = ? ORDER BY created_at DESC', [$status]);
        return array_map($this->unserializePlan(...), $rows);
    }

    public function getPlan(string $id): ?array
    {
        $row = $this->db->fetchOne('SELECT * FROM plans WHERE id = ?', [$id]);
        return $row !== null ? $this->unserializePlan($row) : null;
    }

    public function savePlan(array $planData): array
    {
        $id  = $planData['id'] ?? $this->generateId();
        $now = date('c');

        // Initialize cleanedData array before use to fix undefined variable warning
        $cleanedData = [
            'title' => $this->sanitizeTitle($planData['title'] ?? '', self::DEFAULT_FALLBACK_TITLE),
            'goal'  => $this->sanitizeText($planData['goal'] ?? ''),
            'id'    => $id,
        ];
        
        // Preserve explicitly passed properties, filtering out nulls to avoid accidental overwrites
        $cleanedData = array_merge(
            array_filter($planData, fn($v) => $v !== null), 
            $cleanedData
        );

        if (isset($cleanedData['tags'])) {
            $cleanedData['tags'] = $this->sanitizeTags($cleanedData['tags']);
        }

        $existing = $this->getPlan($id);

        if ($existing !== null) {
            $cleanedData = array_merge($existing, $cleanedData);
            unset($cleanedData['updatedAt']);
        }

        $row = [
            'id'               => $id,
            'title'            => $cleanedData['title'],
            'goal'             => $cleanedData['goal'],
            'duration_minutes' => (int) ($cleanedData['durationMinutes'] ?? self::DEFAULT_DURATION_MINUTES),
            'status'           => $cleanedData['status'] ?? self::STATUS_PENDING,
            'created_at'       => $cleanedData['createdAt'] ?? $now,
            'updated_at'       => $now,
            'data'             => json_encode($cleanedData, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
        ];

        if ($existing !== null) {
            unset($row['created_at']);
            $this->db->update('plans', $row, 'id = ?', [$id]);
        } else {
            $this->db->insert('plans', $row);
        }

        return $this->unserializePlan($row);
    }

    public function deletePlan(string $id): void
    {
        $this->db->delete('plans', 'id = ?', [$id]);
    }

    /**
     * Partially update an existing plan's whitelisted fields.
     *
     * @return array{success: bool, plan?: array, error?: string, errors?: string[]}
     */
    public function updatePlan(string $planId, array $updates): array
    {
        $existing = $this->getPlan($planId);

        if ($existing === null) {
            return ['success' => false, 'error' => 'Plan not found'];
        }

        $rowUpdates = [];
        $mergedPlan = $existing;

        // Map array keys to database columns for straightforward updates
        $allowedUpdates = [
            'title'           => 'title',
            'goal'            => 'goal',
            'durationMinutes' => 'duration_minutes',
            'status'          => 'status',
        ];

        // Validate status if being updated
        if (isset($updates['status']) && !in_array($updates['status'], self::VALID_STATUSES, true)) {
            return ['success' => false, 'error' => 'Invalid status value provided'];
        }

        foreach ($allowedUpdates as $arrayKey => $dbColumn) {
            if (!array_key_exists($arrayKey, $updates)) {
                continue;
            }

            $value = $updates[$arrayKey];

            if ($arrayKey === 'title') {
                $value = $this->sanitizeTitle((string) $value, self::DEFAULT_FALLBACK_TITLE);
            } elseif ($arrayKey === 'goal') {
                $value = $this->sanitizeText((string) $value);
            } elseif ($arrayKey === 'durationMinutes') {
                $value = max(1, (int) $value);
            }

            $mergedPlan[$arrayKey]   = $value;
            $rowUpdates[$dbColumn]   = $value;
        }

        // Handle tags (stored purely in JSON)
        if (array_key_exists('tags', $updates)) {
            $mergedPlan['tags'] = $this->sanitizeTags($updates['tags']);
        }

        // Handle tasks (stored purely in JSON)
        if (array_key_exists('tasks', $updates)) {
            if (!is_array($updates['tasks'])) {
                return ['success' => false, 'error' => 'Tasks must be an array'];
            }
            $mergedPlan['tasks'] = $updates['tasks'];
        }

        // Validate entire merged plan before saving
        $validation = PlanValidator::validate($mergedPlan);
        if (!$validation['valid']) {
            return ['success' => false, 'errors' => $validation['errors'];
        }

        $rowUpdates['data']       = json_encode($mergedPlan, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $rowUpdates['updated_at'] = date('c');

        $this->db->update('plans', $rowUpdates, 'id = ?', [$planId]);

        return ['success' => true, 'plan' => $this->getPlan($planId)];
    }

    // ─── Persistence Serialization ────────────────────────────────────────
    private function unserializePlan(array $row): array
    {
        $plan = [
            'id'              => $row['id'],
            'title'           => $row['title'],
            'goal'            => $row['goal'],
            'durationMinutes' => (int) $row['duration_minutes'],
            'status'          => $row['status'],
            'createdAt'       => $row['created_at'],
            'updatedAt'       => $row['updated_at'],
        ];

        try {
            $jsonData = json_decode($row['data'] ?? '', true, 512, JSON_THROW_ON_ERROR);
            if (is_array($jsonData)) {
                $plan = array_merge($jsonData, $plan);
            }
        } catch (\JsonException $e) {
            // Fallback gracefully to relational fields if JSON is corrupted
        }

        // Ensure tasks are always a valid array
        if (!isset($plan['tasks']) || !is_array($plan['tasks'])) {
            $plan['tasks'] = [];
        }

        // Ensure tags are always a valid array
        if (!isset($plan['tags']) || !is_array($plan['tags'])) {
            $plan['tags'] = [];
        }

        return $plan;
    }

    // ─── Text Sanitization ────────────────────────────────────────────────

    private function sanitizeTitle(string $raw, string $default): string
    {
        $cleaned = self::stripEmojis($raw);
        $cleaned = trim(preg_replace('/\s+/', ' ', $cleaned) ?? $cleaned);
        $cleaned = mb_substr($cleaned, 0, 100);
        return $cleaned !== '' ? $cleaned : $default;
    }

    private function sanitizeText(string $raw): string
    {
        $cleaned = self::stripEmojis($raw);
        $cleaned = trim(preg_replace('/\s+/', ' ', $cleaned) ?? $cleaned);
        return mb_substr($cleaned, 0, 1000);
    }

    /**
     * Strip emojis from each tag, removing any that become empty.
     *
     * @param mixed $rawTags
     * @return string[]
     */
    private function sanitizeTags(mixed $rawTags): array
    {
        if (is_string($rawTags)) {
            $rawTags = array_map('trim', explode(',', $rawTags));
        }
        
        if (!is_array($rawTags)) {
            return [];
        }

        $sanitized = array_values(array_filter(
            array_map(fn($t) => self::stripEmojis(strtolower((string) $t)), $rawTags),
            fn($t) => $t !== ''
        ));

        return array_unique(array_slice($sanitized, 0, 20));
    }

    /**
     * Remove Unicode emoji, flags, dingbat, and variant-selector characters;
     * collapse repeated whitespace; trim. Regex built once and cached.
     */
    private static function stripEmojis(string $value): string
    {
        if ($value === '') {
            return '';
        }

        // Expanded regex to capture flags and standard pictographs
        $regex = self::$emojiRegex ??= '/['
            . '\x{1F1E6}-\x{1F1FF}'   // Regional indicator pairs (flags)
            . '\x{1F300}-\x{1FAFF}'   // Emoji, pictographs, symbols extended-A
            . '\x{2600}-\x{27BF}'     // Misc symbols + dingbats (contiguous)
            . '\x{FE00}-\x{FE0F}'     // Variation selectors
            . ']/u';

        $cleaned = preg_replace($regex, '', $value);

        if ($cleaned === null) {
            return $value;
        }

        $collapsed = preg_replace('/\s{2,}/u', ' ', $cleaned);

        return trim($collapsed ?? $value);
    }

    // ─── Task Helpers ──────────────────────────────────────────────────────

    private function markAllTasksCompleted(array $tasks, string $timestamp): array
    {
        return array_map(
            fn(array $task): array => empty($task['completed']) 
                ? [...$task, 'completed' => true, 'completedAt' => $timestamp]
                : $task,
            $tasks
        );
    }
}