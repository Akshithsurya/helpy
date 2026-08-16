<?php

declare(strict_types=1);

/**
 * 数据库操作异常 — 封装 PDOException，提供统一的异常类型
 */
class DatabaseException extends RuntimeException
{
    public static function fromPDOException(PDOException $e, string $context = ''): self
    {
        $message = $context !== '' ? "$context: {$e->getMessage()}" : $e->getMessage();
        return new self($message, (int) $e->getCode(), $e);
    }
}

/**
 * 安全且优化的 SQLite 数据库包装类
 *
 * - 参数化查询防 SQL 注入
 * - 标识符严格校验防表名/列名注入
 * - 事务快捷方法防遗忘提交/回滚 (支持 Savepoint 嵌套)
 * - 批量插入自动分块 & UPSERT 支持
 */
class Database
{
    private readonly PDO $connection;
    private bool $tablesInitialized = false;
    private int $transactionDepth = 0;

    private const DEFAULT_BUSY_TIMEOUT = 5000;
    private const DEFAULT_CACHE_SIZE = -2000;
    private const MAX_VARIABLES_LIMIT = 999;
    private const IDENTIFIER_PATTERN = '/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/';
    private const DEFAULT_CHUNK_SCALE = 0.5; // Use 50% of max variables to be conservative

    /**
     * @param string $dbPath       数据库文件路径
     * @param bool   $autoInitTables 是否自动初始化数据表
     */
    public function __construct(
        string $dbPath = __DIR__ . '/../data/helpy.db',
        bool $autoInitTables = true,
    ) {
        $dataDir = dirname($dbPath);
        if (!is_dir($dataDir)) {
            // 严格检查目录创建是否成功
            if (!mkdir($dataDir, 0755, true) && !is_dir($dataDir)) {
                throw new RuntimeException(sprintf('Directory "%s" was not created', $dataDir));
            }
        }

        try {
            $this->connection = new PDO('sqlite:' . $dbPath);
        } catch (PDOException $e) {
            throw DatabaseException::fromPDOException($e, 'Connection failed');
        }

        $this->configureConnection();

        if ($autoInitTables) {
            $this->ensureTablesInitialized();
        }
    }

    // ──────────────────────────────────────────────
    //  连接配置
    // ──────────────────────────────────────────────

    private function configureConnection(): void
    {
        $this->connection->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->connection->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->connection->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);

        // 核心安全 & 性能 PRAGMA
        $pragmas = [
            'journal_mode = WAL',       // 并发读写
            'synchronous = NORMAL',     // 安全与性能平衡
            'foreign_keys = ON',        // 外键约束
            'busy_timeout = ' . self::DEFAULT_BUSY_TIMEOUT,      // 锁等待 5 秒
            'cache_size = ' . self::DEFAULT_CACHE_SIZE,       // 2 MB 页缓存
            'temp_store = MEMORY',      // 临时表存内存
        ];

        try {
            $this->connection->exec('PRAGMA ' . implode('; PRAGMA ', $pragmas) . ';');
        } catch (PDOException $e) {
            throw DatabaseException::fromPDOException($e, 'PRAGMA configuration failed');
        }
    }

    // ──────────────────────────────────────────────
    //  建表
    // ──────────────────────────────────────────────

    /**
     * 延迟初始化：只在首次调用时执行 DDL
     */
    private function ensureTablesInitialized(): void
    {
        if ($this->tablesInitialized) {
            return;
        }

        $this->connection->beginTransaction();
        try {
            $this->connection->exec("
                CREATE TABLE IF NOT EXISTS plans (
                    id               TEXT PRIMARY KEY,
                    title            TEXT NOT NULL,
                    goal             TEXT,
                    duration_minutes INTEGER NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'pending',
                    created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    data             TEXT
                )
            ");

            $this->connection->exec("
                CREATE TABLE IF NOT EXISTS events (
                    id         TEXT PRIMARY KEY,
                    type       TEXT NOT NULL,
                    timestamp  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    session_id TEXT,
                    data       TEXT
                )
            ");

            // Add created index to plans for performance
            $this->connection->exec('CREATE INDEX IF NOT EXISTS idx_plans_updated ON plans(updated_at)');

            // 拆分为独立 exec()，避免多语句在 PDO SQLite 中不可靠
            $this->connection->exec('CREATE INDEX IF NOT EXISTS idx_plans_created ON plans(created_at)');
            $this->connection->exec('CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)');
            $this->connection->exec('CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)');
            $this->connection->exec('CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)');

            $this->connection->commit();
            $this->tablesInitialized = true;
        } catch (PDOException $e) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw DatabaseException::fromPDOException($e, 'Table initialization failed');
        }
    }

    // ──────────────────────────────────────────────
    //  底层访问
    // ──────────────────────────────────────────────

    /**
     * @internal 仅在包装方法无法满足需求时使用，优先使用包装方法
     */
    public function getConnection(): PDO
    {
        return $this->connection;
    }

    /**
     * 严格校验标识符（表名/列名）。
     * 必须以字母或下划线开头，只允许字母、数字、下划线，长度限制 64。
     */
    private function sanitizeIdentifier(string $identifier): string
    {
        if (!preg_match(self::IDENTIFIER_PATTERN, $identifier)) {
            throw new InvalidArgumentException("Invalid identifier: $identifier");
        }
        return $identifier;
    }

    // ──────────────────────────────────────────────
    //  通用查询
    // ──────────────────────────────────────────────

    public function query(string $sql, array $params = []): PDOStatement
    {
        try {
            $stmt = $this->connection->prepare($sql);
            $stmt->execute($params);
            return $stmt;
        } catch (PDOException $e) {
            throw DatabaseException::fromPDOException($e, 'Query failed');
        }
    }

    public function prepare(string $sql): PDOStatement
    {
        try {
            return $this->connection->prepare($sql);
        } catch (PDOException $e) {
            throw DatabaseException::fromPDOException($e, 'Prepare failed');
        }
    }

    public function execute(string $sql, array $params = []): int
    {
        return $this->query($sql, $params)->rowCount();
    }

    /**
     * 执行原始 SQL（仅用于 DDL 等无参数语句）
     */
    public function exec(string $sql): int
    {
        try {
            return $this->connection->exec($sql);
        } catch (PDOException $e) {
            throw DatabaseException::fromPDOException($e, 'Exec failed');
        }
    }

    public function fetchOne(string $sql, array $params = []): ?array
    {
        $result = $this->query($sql, $params)->fetch();
        return $result !== false ? $result : null;
    }

    public function fetchAll(string $sql, array $params = []): array
    {
        return $this->query($sql, $params)->fetchAll();
    }

    /**
     * 获取单个标量值（第一行指定列）
     */
    public function fetchColumn(string $sql, array $params = [], int $column = 0): mixed
    {
        $result = $this->query($sql, $params)->fetchColumn($column);
        return $result !== false ? $result : null;
    }

    /**
     * Fetch all records as a list of objects of the specified class
     * @template T
     * @param class-string<T> $className
     * @return list<T>
     */
    public function fetchAllInto(string $className, string $sql, array $params = []): array
    {
        $stmt = $this->query($sql, $params);
        return $stmt->fetchAll(PDO::FETCH_CLASS, $className);
    }

    /**
     * Fetch a single record into an object of the specified class
     * @template T
     * @param class-string<T> $className
     * @return T|null
     */
    public function fetchOneInto(string $className, string $sql, array $params = []): ?object
    {
        $stmt = $this->query($sql, $params);
        $result = $stmt->fetchObject($className);
        return $result !== false ? $result : null;
    }

    // ──────────────────────────────────────────────
    //  内部辅助方法
    // ──────────────────────────────────────────────

    /**
     * 构建 SET 子句和对应参数 (用于 INSERT, UPDATE, UPSERT)
     */
    private function buildSetClauses(array $data, string $prefix = 'val_'): array
    {
        $columns = [];
        $placeholders = [];
        $params = [];

        foreach ($data as $col => $value) {
            $safeCol = $this->sanitizeIdentifier($col);
            $columns[] = $safeCol;
            $key = $prefix . $safeCol;
            $placeholders[] = ":$key";
            $params[$key] = $value;
        }

        return [
            'columns'       => $columns,
            'placeholders'  => $placeholders,
            'params'        => $params,
        ];
    }

    // ──────────────────────────────────────────────
    //  插入
    // ──────────────────────────────────────────────

    /**
     * 插入单行
     * @return int 受影响行数（TEXT 主键请从 $data 中读取 ID）
     */
    public function insert(string $table, array $data): int
    {
        if (empty($data)) {
            throw new InvalidArgumentException('Insert data cannot be empty.');
        }

        $table = $this->sanitizeIdentifier($table);
        $build = $this->buildSetClauses($data);

        $columnStr = implode(', ', $build['columns']);
        $placeholderStr = implode(', ', $build['placeholders']);

        $sql = "INSERT INTO $table ($columnStr) VALUES ($placeholderStr)";
        return $this->query($sql, $build['params'])->rowCount();
    }

    /**
     * 批量插入（自动分块以规避 SQLITE_MAX_VARIABLE_NUMBER 限制）
     *
     * 注意：所有行必须具有相同的列结构；
     */
    public function insertMany(string $table, array $rows): int
    {
        if (empty($rows)) {
            return 0;
        }

        $table = $this->sanitizeIdentifier($table);
        $columns = array_map($this->sanitizeIdentifier(...), array_keys($rows[0]));
        $columnStr = implode(', ', $columns);
        $numColumns = count($columns);

        // SQLite 默认变量限制通常为 999，保守设置为 500 以兼容旧版本
        $maxVariables = (int) (self::MAX_VARIABLES_LIMIT * self::DEFAULT_CHUNK_SCALE);
        $chunkSize = max(1, (int) floor($maxVariables / $numColumns));

        $totalAffected = 0;

        foreach (array_chunk($rows, $chunkSize) as $chunk) {
            $params = [];
            $rowPlaceholders = [];

            foreach ($chunk as $i => $row) {
                $placeholders = [];
                foreach ($columns as $col) {
                    $key = "r{$i}_$col";
                    $placeholders[] = ":$key";
                    $params[$key] = $row[$col] ?? null;
                }
                $rowPlaceholders[] = '(' . implode(', ', $placeholders) . ')';
            }

            $sql = "INSERT INTO $table ($columnStr) VALUES " . implode(', ', $rowPlaceholders);
            $totalAffected += $this->query($sql, $params)->rowCount();
        }

        return $totalAffected;
    }

    /**
     * 插入或更新（SQLite UPSERT — ON CONFLICT DO UPDATE）
     *
     * @param array $conflictColumns 冲突检测列（通常是主键列名）
     */
    public function upsert(string $table, array $data, array $conflictColumns): int
    {
        if (empty($data)) {
            throw new InvalidArgumentException('Upsert data cannot be empty.');
        }

        $table = $this->sanitizeIdentifier($table);
        $conflictCols = array_map($this->sanitizeIdentifier(...), $conflictColumns);
        $build = $this->buildSetClauses($data);

        $columnStr = implode(', ', $build['columns']);
        $placeholderStr = implode(', ', $build['placeholders']);

        // 冲突时更新非冲突列
        $updateClauses = [];
        foreach ($build['columns'] as $col) {
            if (!in_array($col, $conflictCols, true)) {
                $updateClauses[] = "$col = excluded.$col";
            }
        }

        $conflictStr = implode(', ', $conflictCols);

        if (empty($updateClauses)) {
            $sql = "INSERT INTO $table ($columnStr) VALUES ($placeholderStr) ON CONFLICT($conflictStr) DO NOTHING";
        } else {
            $updateStr = implode(', ', $updateClauses);
            $sql = "INSERT INTO $table ($columnStr) VALUES ($placeholderStr) ON CONFLICT($conflictStr) DO UPDATE SET $updateStr";
        }

        return $this->query($sql, $build['params'])->rowCount();
    }

    /**
     * 返回最后插入行的 ID（对 INTEGER 主键有用；TEXT 主键返回 "0"）
     */
    public function lastInsertId(): string
    {
        return $this->connection->lastInsertId();
    }

    // ──────────────────────────────────────────────
    //  更新
    // ──────────────────────────────────────────────

    /**
     * 更新（自定义 WHERE 子句）
     */
    public function update(string $table, array $data, string $where, array $whereParams = []): int
    {
        if (empty($data)) {
            throw new InvalidArgumentException('Update data cannot be empty.');
        }

        $table = $this->sanitizeIdentifier($table);
        $build = $this->buildSetClauses($data, 'set_');

        $setStr = implode(', ', array_map(fn($col) => "$col = :set_$col", $build['columns']));
        
        $sql = sprintf('UPDATE %s SET %s WHERE %s', $table, $setStr, $where);
        $params = array_merge($build['params'], $whereParams);

        return $this->query($sql, $params)->rowCount();
    }

    /**
     * 基于等值条件安全更新（无需手写 WHERE 子句，完全防注入）
     *
     * @param array $conditions 等值条件，如 ['id' => '123', 'status' => 'active']
     */
    public function updateBy(string $table, array $data, array $conditions): int
    {
        if (empty($data)) {
            throw new InvalidArgumentException('Update data cannot be empty.');
        }
        if (empty($conditions)) {
            throw new InvalidArgumentException('Conditions cannot be empty (prevents accidental full-table update).');
        }

        $table = $this->sanitizeIdentifier($table);
        $build = $this->buildSetClauses($data, 'set_');

        $setStr = implode(', ', array_map(fn($col) => "$col = :set_$col", $build['columns']));
        
        $whereClauses = [];
        foreach ($conditions as $column => $value) {
            $col = $this->sanitizeIdentifier($column);
            $whereClauses[] = "$col = :where_$col";
            $build['params']["where_$col"] = $value;
        }

        $sql = sprintf(
            'UPDATE %s SET %s WHERE %s',
            $table,
            $setStr,
            implode(' AND ', $whereClauses),
        );

        return $this->query($sql, $build['params'])->rowCount();
    }

    // ──────────────────────────────────────────────
    //  删除
    // ──────────────────────────────────────────────

    public function delete(string $table, string $where, array $params = []): int
    {
        $table = $this->sanitizeIdentifier($table);
        return $this->query("DELETE FROM $table WHERE $where", $params)->rowCount();
    }

    /**
     * 基于 ID 安全删除
     */
    public function deleteById(string $table, string $id): bool
    {
        $table = $this->sanitizeIdentifier($table);
        $stmt = $this->query("DELETE FROM $table WHERE id = :id", ['id' => $id]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Delete multiple records by array of IDs
     * @param list<string> $ids
     */
    public function deleteByIds(string $table, array $ids): int
    {
        if (empty($ids)) {
            throw new InvalidArgumentException('IDs array cannot be empty');
        }
        
        $table = $this->sanitizeIdentifier($table);
        $placeholders = [];
        $params = [];
        
        foreach ($ids as $index => $id) {
            $key = "id$index";
            $placeholders[] = ":$key";
            $params[$key] = $id;
        }
        
        $placeholdersStr = implode(', ', $placeholders);
        return $this->query("DELETE FROM $table WHERE id IN ($placeholdersStr)", $params)->rowCount();
    }

    // ──────────────────────────────────────────────
    //  查询快捷方法
    // ──────────────────────────────────────────────

    /**
     * 基于 ID 查找单条记录
     */
    public function findById(string $table, string $id): ?array
    {
        $table = $this->sanitizeIdentifier($table);
        return $this->fetchOne("SELECT * FROM $table WHERE id = :id", ['id' => $id]);
    }

    /**
     * 检查记录是否存在（SELECT EXISTS — 比 COUNT 更高效）
     */
    public function exists(string $table, string $where, array $params = []): bool
    {
        $table = $this->sanitizeIdentifier($table);
        $sql = "SELECT EXISTS(SELECT 1 FROM $table WHERE $where LIMIT 1)";
        return (bool) $this->fetchColumn($sql, $params);
    }

    /**
     * 统计记录数
     */
    public function count(string $table, string $where = '1=1', array $params = []): int
    {
        $table = $this->sanitizeIdentifier($table);
        $sql = "SELECT COUNT(*) FROM $table WHERE $where";
        return (int) $this->fetchColumn($sql, $params);
    }

    /**
     * Paginate results with limit and offset
     * @return array{total: int, items: array<array<string, mixed>>, page: int, perPage: int, totalPages: int}
     */
    public function paginate(string $table, int $page = 1, int $perPage = 20, string $where = '1=1', array $params = [], string $orderBy = 'created_at DESC'): array
    {
        $table = $this->sanitizeIdentifier($table);
        $orderBy = $this->sanitizeOrderBy($orderBy);
        
        $total = $this->count($table, $where, $params);
        $totalPages = (int) ceil($total / $perPage);
        $page = max(1, min($page, $totalPages));
        $offset = ($page - 1) * $perPage;
        
        $sql = "SELECT * FROM $table WHERE $where ORDER BY $orderBy LIMIT :limit OFFSET :offset";
        $mergeParams = array_merge($params, [':limit' => $perPage, ':offset' => $offset]);
        $items = $this->fetchAll($sql, $mergeParams);
        
        return compact('total', 'items', 'page', 'perPage', 'totalPages');
    }

    /**
     * Sanitize ORDER BY clause to prevent SQL injection
     */
    private function sanitizeOrderBy(string $orderBy): string
    {
        $parts = explode(' ', trim($orderBy));
        $column = $this->sanitizeIdentifier($parts[0]);
        $direction = strtoupper($parts[1] ?? 'DESC');
        
        if (!in_array($direction, ['ASC', 'DESC'], true)) {
            $direction = 'DESC';
        }
        
        return "$column $direction";
    }

    // ──────────────────────────────────────────────
    //  事务
    // ──────────────────────────────────────────────

    public function inTransaction(): bool
    {
        return $this->connection->inTransaction();
    }

    /**
     * 事务快捷方法：自动提交/回滚，支持安全嵌套（通过 SAVEPOINT 实现）
     *
     *   $db->transaction(function (Database $db) {
     *       $db->insert('plans', $plan);
     *       $db->transaction(function (Database $db) {
     *           $db->insert('events', $event);
     *           throw new Exception('Test rollback nested'); // 仅回滚嵌套事务
     *       });
     *   });
     *
     * @template T
     * @param callable(self):T $callback
     * @return T
     */
    public function transaction(callable $callback): mixed
    {
        $this->transactionDepth++;
        
        if ($this->connection->inTransaction()) {
            $savepoint = 'sp_' . bin2hex(random_bytes(4));
            $this->exec("SAVEPOINT $savepoint");

            try {
                $result = $callback($this);
                $this->exec("RELEASE SAVEPOINT $savepoint");
                $this->transactionDepth--;
                return $result;
            } catch (Throwable $e) {
                $this->exec("ROLLBACK TO SAVEPOINT $savepoint");
                $this->exec("RELEASE SAVEPOINT $savepoint");
                $this->transactionDepth--;
                throw $e;
            }
        }

        // 顶层事务处理
        $this->connection->beginTransaction();
        try {
            $result = $callback($this);
            $this->connection->commit();
            $this->transactionDepth--;
            return $result;
        } catch (Throwable $e) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            $this->transactionDepth--;
            throw $e;
        }
    }

    public function beginTransaction(): void
    {
        if ($this->connection->inTransaction()) {
            throw new DatabaseException('Already in a transaction. Use transaction() for nested transactions.');
        }
        $this->connection->beginTransaction();
    }

    public function commit(): void
    {
        $this->connection->commit();
    }

    public function rollBack(): void
    {
        if ($this->connection->inTransaction()) {
            $this->connection->rollBack();
        }
    }

    // ──────────────────────────────────────────────
    //  调试
    // ──────────────────────────────────────────────

    public function __debugInfo(): array
    {
        return [
            'driver'            => $this->connection->getAttribute(PDO::ATTR_DRIVER_NAME),
            'inTransaction'     => $this->connection->inTransaction(),
            'tablesInitialized' => $this->tablesInitialized,
            'transactionDepth'  => $this->transactionDepth,
        ];
    }
}