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
    /**
     * Mark all tasks in a plan as completed with the provided timestamp
     */
    private function markAllTasksCompleted(array $tasks, string $now): array
    {
        return array_map(
            fn(array $task) => [...$task, 'completed' => true, 'completedAt' => $now],
            $tasks
        );
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
    // ─── Sanitization Helpers ─────────────────────────────────────────────
    /**
     * Sanitize plan title, trim whitespace and limit length, fall back to default if empty
     */
    private function sanitizeTitle(string $input, string $fallback): string
    {
        $sanitized = trim(strip_tags($input));
        $sanitized = mb_substr($sanitized, 0, 100);
        
        return $sanitized !== '' ? $sanitized : $fallback;
    }
    /**
     * Sanitize free-form text input, strip tags and limit length
     */
    private function sanitizeText(string $input): string
    {
        $sanitized = trim(strip_tags($input));
        return mb_substr($sanitized, 0, 500);
    }
    /**