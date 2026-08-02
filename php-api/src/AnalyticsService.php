<?php
/**
 * 分析服务类 - 处理用户行为分析和统计
 *
 * 职责：
 * 1. 记录用户行为事件
 * 2. 提供统计摘要和趋势分析
 */

class AnalyticsService
{
    /** 表名 */
    private const TABLE_EVENTS = 'events';

    /** 列名 - 集中管理，避免 SQL 中散落字符串 */
    private const COL_ID         = 'id';
    private const COL_TYPE       = 'type';
    private const COL_TIMESTAMP  = 'timestamp';
    private const COL_SESSION_ID = 'session_id';
    private const COL_PAYLOAD    = 'payload';

    /** 已知事件类型 — 防止任意字符串入库 */
    public const EVENT_TYPE_PLAN_ACTION = 'plan_action';
    public const EVENT_TYPE_PAGE_VIEW   = 'page_view';
    public const EVENT_TYPE_CLICK       = 'click';

    /** @var list<string> */
    private const VALID_EVENT_TYPES = [
        self::EVENT_TYPE_PLAN_ACTION,
        self::EVENT_TYPE_PAGE_VIEW,
        self::EVENT_TYPE_CLICK,
    ];

    /** 默认统计周期（天） */
    private const DEFAULT_PERIOD_DAYS = 7;

    /** 趋势天数（默认） */
    private const TREND_DAYS = 7;

    /** 最小 / 最大统计周期限制 */
    private const MIN_PERIOD_DAYS = 1;
    private const MAX_PERIOD_DAYS = 365;

    private PDO $pdo;

    public function __construct(Database $db)
    {
        $this->pdo = $db->getConnection();
    }

    // ─── 写入 ────────────────────────────────────────────

    /**
     * 记录一个用户行为事件
     *
     * @param  array $input  必须包含 'type'，可选 'sessionId' 和 'payload'
     * @throws InvalidArgumentException  type 不合法时抛出
     * @throws RuntimeException          数据库写入失败或 payload 无法序列化时抛出
     * @return string 生成的事件 ID
     */
    public function recordEvent(array $input): string
    {
        $type = $input['type'] ?? null;

        if ($type === null) {
            throw new InvalidArgumentException('Event type is required.');
        }

        if (!in_array($type, self::VALID_EVENT_TYPES, true)) {
            throw new InvalidArgumentException(
                sprintf('Invalid event type "%s". Allowed: %s', $type, implode(', ', self::VALID_EVENT_TYPES))
            );
        }

        $eventId = self::generateEventId();
        $payload = $input['payload'] ?? null;
        $payloadJson = $this->encodePayload($payload);

        $sql = sprintf(
            'INSERT INTO %s (%s, %s, %s, %s, %s) VALUES (?, ?, ?, ?, ?)',
            self::TABLE_EVENTS,
            self::COL_ID,
            self::COL_TYPE,
            self::COL_TIMESTAMP,
            self::COL_SESSION_ID,
            self::COL_PAYLOAD
        );

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                $eventId,
                $type,
                self::nowIso(),
                $input['sessionId'] ?? null,
                $payloadJson,
            ]);
        } catch (PDOException $e) {
            throw new RuntimeException('Failed to record event: ' . $e->getMessage(), 0, $e);
        }

        return $eventId;
    }

    // ─── 读取 ────────────────────────────────────────────

    /**
     * 获取统计摘要
     *
     * 使用一条 GROUP BY 查询替代原来 4 条独立查询，
     * 数据库只扫描一次 events 表。
     *
     * @param  int $days  统计天数 (1–365)
     * @throws InvalidArgumentException  天数越界时抛出
     * @throws RuntimeException          查询失败时抛出
     * @return array{periodDays:int,totalEvents:int,planEvents:int,sessions:int,hourlyActivity:int[]}
     */
    public function getSummary(int $days = self::DEFAULT_PERIOD_DAYS): array
    {
        $days   = self::assertDays($days);
        $since  = self::daysAgoIso($days);

        // ── 单条聚合查询 ────────────────────────────────
        $summarySql = sprintf(
            <<<'SQL'
            SELECT
                COUNT(*)                                        AS total_events,
                SUM(CASE WHEN type = ? THEN 1 ELSE 0 END)      AS plan_events,
                COUNT(DISTINCT session_id)                      AS distinct_sessions
            FROM %s
            WHERE timestamp >= ?
            SQL,
            self::TABLE_EVENTS
        );

        try {
            $summaryStmt = $this->pdo->prepare($summarySql);
            $summaryStmt->execute([self::EVENT_TYPE_PLAN_ACTION, $since]);
            $stats = $summaryStmt->fetch(PDO::FETCH_ASSOC) ?: [];
        } catch (PDOException $e) {
            throw new RuntimeException('Failed to fetch summary: ' . $e->getMessage(), 0, $e);
        }

        // ── 每小时活跃度（一次 GROUP BY）──────────────
        $hourlySql = sprintf(
            <<<'SQL'
            SELECT
                EXTRACT(HOUR FROM timestamp) AS hour,
                COUNT(*)                     AS cnt
            FROM %s
            WHERE timestamp >= ?
            GROUP BY EXTRACT(HOUR FROM timestamp)
            ORDER BY hour
            SQL,
            self::TABLE_EVENTS
        );

        try {
            $hourStmt = $this->pdo->prepare($hourlySql);
            $hourStmt->execute([$since]);
            $hourRows = $hourStmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            throw new RuntimeException('Failed to fetch hourly activity: ' . $e->getMessage(), 0, $e);
        }

        $hourlyActivity = array_fill(0, 24, 0);
        foreach ($hourRows as $hr) {
            $hourlyActivity[(int) $hr['hour']] = (int) $hr['cnt'];
        }

        return [
            'periodDays'     => $days,
            'totalEvents'    => (int) ($stats['total_events'] ?? 0),
            'planEvents'     => (int) ($stats['plan_events'] ?? 0),
            'sessions'       => (int) ($stats['distinct_sessions'] ?? 0),
            'hourlyActivity' => $hourlyActivity,
        ];
    }

    /**
     * 获取每日趋势及最活跃日
     *
     * 用一条 GROUP BY DATE 查询替代原来 7 次循环查询。
     *
     * @param  int $days  趋势天数，默认 7
     * @throws InvalidArgumentException  天数越界时抛出
     * @throws RuntimeException          查询失败时抛出
     * @return array{dailyTrends:list<array{date:string,events:int}>,mostActiveDay:?array{date:string,events:int}}
     */
    public function getTrends(int $days = self::TREND_DAYS): array
    {
        $days  = self::assertDays($days);
        $since = self::daysAgoIso($days);

        $sql = sprintf(
            <<<'SQL'
            SELECT
                DATE(timestamp) AS day,
                COUNT(*)        AS events
            FROM %s
            WHERE timestamp >= ?
            GROUP BY DATE(timestamp)
            ORDER BY day ASC
            SQL,
            self::TABLE_EVENTS
        );

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([$since]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            throw new RuntimeException('Failed to fetch trends: ' . $e->getMessage(), 0, $e);
        }

        // ── 填充无数据的日期为 0 ─────────────────────────
        $dailyTrends = [];
        $dateIndex   = []; // date => position in $dailyTrends

        for ($i = $days - 1; $i >= 0; $i--) {
            $dateStr = date('Y-m-d', strtotime("-{$i} days"));
            $dateIndex[$dateStr] = count($dailyTrends);
            $dailyTrends[] = ['date' => $dateStr, 'events' => 0];
        }

        foreach ($rows as $row) {
            $key = $row['day'];
            if (isset($dateIndex[$key])) {
                $dailyTrends[$dateIndex[$key]]['events'] = (int) $row['events'];
            }
        }

        return [
            'dailyTrends'   => $dailyTrends,
            'mostActiveDay' => self::findMostActiveDay($dailyTrends),
        ];
    }

    // ─── 私有辅助 ────────────────────────────────────────

    /**
     * 从趋势列表中找最活跃日（事件数最大的一天）
     * 如果所有天都是 0 则返回 null。
     *
     * @param  list<array{date:string,events:int}> $trends
     * @return ?array{date:string,events:int}
     */
    private static function findMostActiveDay(array $trends): ?array
    {
        $max  = 0;
        $best = null;

        foreach ($trends as $day) {
            if ($day['events'] > $max) {
                $max  = $day['events'];
                $best = $day;
            }
        }

        return $best;
    }

    /**
     * 安全序列化 payload，失败时抛出 RuntimeException
     */
    private static function encodePayload(mixed $payload): ?string
    {
        if ($payload === null) {
            return null;
        }
        try {
            return json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        } catch (JsonException $e) {
            throw new RuntimeException('Failed to encode event payload: ' . $e->getMessage(), 0, $e);
        }
    }

    /**
     * 生成事件 ID — 唯一性由 random_bytes 保证，不再依赖 time()
     */
    private static function generateEventId(): string
    {
        return 'evt_' . bin2hex(random_bytes(12));
    }

    /**
     * ISO 8601 当前时间
     */
    private static function nowIso(): string
    {
        return date('c');
    }

    /**
     * N 天前的 ISO 8601 时间
     */
    private static function daysAgoIso(int $days): string
    {
        return date('c', strtotime("-{$days} days"));
    }

    /**
     * 校验天数范围。语义上"断言合法"，不再用 clamp 的歧义命名。
     *
     * @throws InvalidArgumentException
     */
    private static function assertDays(int $days): int
    {
        if ($days < self::MIN_PERIOD_DAYS) {
            throw new InvalidArgumentException(
                sprintf('Period must be at least %d days.', self::MIN_PERIOD_DAYS)
            );
        }
        if ($days > self::MAX_PERIOD_DAYS) {
            throw new InvalidArgumentException(
                sprintf('Period cannot exceed %d days.', self::MAX_PERIOD_DAYS)
            );
        }
        return $days;
    }
}