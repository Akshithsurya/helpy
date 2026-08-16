<?php

declare(strict_types=1);

/**
 * Orchestrates the music subsystem:
 *   - CRUD for tracks / playlists / favorites
 *   - Cross-adapter search with dedupe
 *   - Playback state + history with plan linkage
 *   - Plan-seeded recommendations
 *
 * All PDO access is funneled through $this->musicDb (which provides identifier
 * sanitization + prepared-statement helpers) or its raw PDO handle.
 */
final class MusicService
{
    // ── Configuration ──────────────────────────────────────────────────

    private const DEFAULT_AUTOPLAYLIST_SIZE            = 30;
    private const DEFAULT_HISTORY_LIMIT                = 100;
    private const MAX_SEARCH_LIMIT                     = 200;
    private const MAX_LIBRARY_LIMIT                    = 500;
    private const MIN_PLAY_DURATION_FOR_COUNT          = 30;
    private const REPEAT_MODES                         = ['off', 'one', 'all'];

    private const PLAYBACK_STATE_DIR  = __DIR__ . '/../data';
    private const PLAYBACK_STATE_FILE = self::PLAYBACK_STATE_DIR . '/playback_state.json';

    private const VOLUME_MIN       = 0.0;
    private const VOLUME_MAX       = 1.0;
    private const ID_RANDOM_BYTES  = 9;
    private const ID_PREFIX_TRACK  = 'trk_';
    private const ID_PREFIX_PLAYLIST = 'pl_';
    private const ID_PREFIX_ITEM   = 'pi_';
    private const ID_PREFIX_HISTORY = 'ph_';

    // ── Constructor ────────────────────────────────────────────────────

    public function __construct(
        private readonly MusicDatabase $musicDb,
        private readonly MusicSourceAdapterRegistry $registry,
    ) {}

    // ═══════════════════════════════════════════════════════════════════
    //  Sources
    // ═══════════════════════════════════════════════════════════════════

    public function listSources(): array
    {
        return $this->registry->availability();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Track CRUD & Search
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Search across adapters (and the local DB), then merge + dedupe.
     * Pure read: never mutates DB; callers must save from results explicitly.
     *
     * @return list<array{track: array, source: string}>
     */
    public function searchTracks(string $text, ?string $sourceType = null, int $limit = 50): array
    {
        $text = trim($text);
        if ($text === '') {
            return [];
        }

        $cappedLimit = self::clampInt($limit, 1, self::MAX_SEARCH_LIMIT);
        $results     = $this->fetchSearchResultsFromAdapters(
            $this->getRelevantAdapters($sourceType),
            $text,
            $cappedLimit,
        );

        if (count($results) < $cappedLimit) {
            $results = $this->mergeLocalSearchResults(
                $results,
                $text,
                $cappedLimit - count($results),
            );
        }

        return $results;
    }

    /**
     * List library tracks with optional filters.
     *
     * @return list<array>
     */
    public function getLibrary(
        ?string $sourceType = null,
        ?string $genre = null,
        bool $favoriteOnly = false,
        ?string $searchText = null,
        int $limit = 200,
        int $offset = 0,
    ): array {
        $cappedLimit = self::clampInt($limit, 1, self::MAX_LIBRARY_LIMIT);
        $offset      = max(0, $offset);

        [$sql, $params] = $this->buildLibraryQuery($sourceType, $genre, $favoriteOnly, $searchText);

        $stmt = $this->musicDb->getPdo()->prepare($sql);
        $this->bindParams($stmt, $params);
        $stmt->bindValue(':lim', $cappedLimit, PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset, PDO::PARAM_INT);
        $stmt->execute();

        return array_map(self::rowToTrackArray(...), $stmt->fetchAll() ?: []);
    }

    public function getTrack(string $id): ?array
    {
        $row = $this->musicDb->getDb()->fetchOne(
            'SELECT * FROM tracks WHERE id = ? LIMIT 1',
            [$id],
        );

        return $row !== null ? self::rowToTrackArray($row) : null;
    }

    /**
     * Persist a MusicTrackDTO as a library track; dedupes by
     * (source_type, external_id) or by local_path for local files.
     */
    public function upsertTrackFromDto(MusicTrackDTO $dto): array
    {
        $pdo        = $this->musicDb->getPdo();
        $sourceType = $dto->sourceType ?? 'local';
        $now        = date('c');

        $existing = $this->findExistingTrack($pdo, $dto, $sourceType);
        $trackId  = $existing !== null
            ? $this->updateExistingTrack($pdo, $dto, (string)$existing['id'], $now)
            : $this->createNewTrack($pdo, $dto, $sourceType, $now);

        return $this->reloadTrack($trackId);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Playlists
    // ═══════════════════════════════════════════════════════════════════

    public function createPlaylist(string $name, string $description = ''): array
    {
        $trimmedName = trim($name);
        if ($trimmedName === '') {
            throw HttpException::badRequest('Playlist name is required');
        }

        $trimmedDesc = trim($description);
        $now         = date('c');
        $id          = $this->generateUniqueId(self::ID_PREFIX_PLAYLIST);

        $this->musicDb->getPdo()->prepare(
            'INSERT INTO playlists (id, name, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)'
        )->execute([$id, $trimmedName, $trimmedDesc, $now, $now]);

        return $this->getPlaylist($id, true)
            ?? $this->buildPlaylistResponse([
                'id'          => $id,
                'name'        => $trimmedName,
                'description' => $trimmedDesc,
                'created_at'  => $now,
                'updated_at'  => $now,
                'track_count' => 0,
            ], includeTracks: true);
    }

    public function listPlaylists(int $limit = 100): array
    {
        $cappedLimit = self::clampInt($limit, 1, self::MAX_LIBRARY_LIMIT);
        $pdo  = $this->musicDb->getPdo();
        $stmt = $pdo->prepare(
            'SELECT p.*,
                    (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count
             FROM playlists p
             ORDER BY p.updated_at DESC
             LIMIT ?'
        );
        $stmt->bindValue(1, $cappedLimit, PDO::PARAM_INT);
        $stmt->execute();

        return array_map(
            fn(array $r): array => $this->buildPlaylistResponse($r, includeTracks: false),
            $stmt->fetchAll() ?: [],
        );
    }

    public function getPlaylist(string $id, bool $withTracks = true): ?array
    {
        $row = $this->musicDb->getDb()->fetchOne(
            'SELECT p.*,
                    (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count
             FROM playlists p
             WHERE p.id = ?
             LIMIT 1',
            [$id],
        );

        if ($row === null) {
            return null;
        }

        $playlist = $this->buildPlaylistResponse($row, includeTracks: $withTracks);
        if ($withTracks) {
            $playlist['tracks'] = $this->fetchPlaylistTracks($id);
        }

        return $playlist;
    }

    public function deletePlaylist(string $id): bool
    {
        return $this->transactional(function (PDO $pdo) use ($id): bool {
            $pdo->prepare('DELETE FROM playlist_items WHERE playlist_id = ?')->execute([$id]);

            $stmt = $pdo->prepare('DELETE FROM playlists WHERE id = ?');
            $stmt->execute([$id]);

            return $stmt->rowCount() > 0;
        });
    }

    public function addToPlaylist(string $playlistId, string $trackId, ?int $position = null): array
    {
        $this->ensurePlaylistExists($playlistId);
        $this->ensureTrackExists($trackId);

        $pdo = $this->musicDb->getPdo();

        $this->transactional(function (PDO $pdo) use ($playlistId, $trackId, $position): void {
            // Tolerate optional UNIQUE(playlist_id, track_id) constraint —
            // if it exists and is violated, treat as "already added".
            $exists = $pdo->prepare(
                'SELECT 1 FROM playlist_items WHERE playlist_id = ? AND track_id = ? LIMIT 1'
            );
            $exists->execute([$playlistId, $trackId]);
            if ($exists->fetchColumn() !== false) {
                return;
            }

            $resolved = $position ?? $this->getNextPlaylistPosition($pdo, $playlistId);
            $pdo->prepare(
                'INSERT INTO playlist_items (id, playlist_id, track_id, position, added_at)
                 VALUES (?, ?, ?, ?, ?)'
            )->execute([
                $this->generateUniqueId(self::ID_PREFIX_ITEM),
                $playlistId,
                $trackId,
                $resolved,
                date('c'),
            ]);
        });

        return $this->requirePlaylist($playlistId);
    }

    public function removeFromPlaylist(string $playlistId, string $itemId): array
    {
        $stmt = $this->musicDb->getPdo()->prepare(
            'DELETE FROM playlist_items WHERE id = ? AND playlist_id = ?'
        );
        $stmt->execute([$itemId, $playlistId]);

        if ($stmt->rowCount() === 0) {
            throw HttpException::notFound('Playlist item not found');
        }

        return $this->requirePlaylist($playlistId);
    }

    /**
     * Reorder items. $order is itemId => position pairs.
     *
     * @param array<string, int> $order
     */
    public function reorderPlaylist(string $playlistId, array $order): array
    {
        $this->ensurePlaylistExists($playlistId);

        if ($order === []) {
            return $this->requirePlaylist($playlistId);
        }

        $pdo = $this->musicDb->getPdo();
        $ids = array_map('strval', array_keys($order));

        // Pre-flight existence check — rowCount() returns 0 when the row
        // exists but the value didn't change, so it can't be relied upon.
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $countStmt = $pdo->prepare(
            "SELECT COUNT(*) FROM playlist_items
             WHERE playlist_id = ? AND id IN ($placeholders)"
        );
        $countStmt->execute(array_merge([$playlistId], $ids));

        if ((int)$countStmt->fetchColumn() !== count($ids)) {
            throw HttpException::notFound('One or more playlist items not found');
        }

        // CASE WHEN is atomic & typically faster than per-row UPDATEs.
        $this->transactional(function (PDO $pdo) use ($order, $playlistId): void {
            $case  = 'CASE id ';
            $binds = [];
            foreach ($order as $itemId => $position) {
                $case  .= 'WHEN ? THEN ? ';
                $binds[] = (string)$itemId;
                $binds[] = (int)$position;
            }
            $case .= 'END';

            $sql = "UPDATE playlist_items
                    SET position = $case
                    WHERE playlist_id = ?";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([...$binds, $playlistId]);
        });

        return $this->requirePlaylist($playlistId);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Favorites
    // ═══════════════════════════════════════════════════════════════════

    public function toggleFavorite(string $trackId, ?bool $forceState = null): array
    {
        $track = $this->getTrack($trackId);
        if ($track === null) {
            throw HttpException::notFound('Track not found');
        }

        $newState = $forceState ?? !$track['isFavorite'];

        $this->musicDb->getPdo()
            ->prepare('UPDATE tracks SET is_favorite = ?, updated_at = ? WHERE id = ?')
            ->execute([$newState ? 1 : 0, date('c'), $trackId]);

        return $this->reloadTrack($trackId);
    }

    public function getFavorites(int $limit = 200): array
    {
        return $this->getLibrary(favoriteOnly: true, limit: $limit);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Playback state & history
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Volatile playback state persisted to a singleton JSON file.
     * Reads use a shared lock; writes use atomic temp-file + rename.
     */
    public function getPlaybackState(): array
    {
        $raw = $this->readPlaybackStateFile();
        if ($raw === null) {
            return $this->getDefaultPlaybackState();
        }

        try {
            $decoded = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            // Corrupt or partially-written file — start fresh.
            return $this->getDefaultPlaybackState();
        }

        return is_array($decoded)
            ? $this->validatePlaybackState($decoded)
            : $this->getDefaultPlaybackState();
    }

    public function setPlaybackState(array $patch): array
    {
        $next = $this->applyPlaybackPatch($this->getPlaybackState(), $patch);
        $this->persistPlaybackState($next);
        return $next;
    }

    public function clearPlaybackState(): void
    {
        if (!is_file(self::PLAYBACK_STATE_FILE)) {
            return;
        }

        if (@unlink(self::PLAYBACK_STATE_FILE) === false && is_file(self::PLAYBACK_STATE_FILE)) {
            throw new RuntimeException(sprintf(
                'Failed to remove playback state file "%s".',
                self::PLAYBACK_STATE_FILE,
            ));
        }
    }

    public function recordPlayback(array $event): array
    {
        $trackId    = self::extractNullableString($event, 'trackId');
        $sourceType = self::extractNullableString($event, 'sourceType');
        $duration   = isset($event['durationSec']) ? max(0, (int)$event['durationSec']) : 0;
        $planId     = self::extractNullableString($event, 'planId');
        $sessionId  = self::extractNullableString($event, 'sessionId');
        $ended      = self::extractNullableString($event, 'endedAt');
        $started    = self::extractNullableString($event, 'startedAt') ?? date('c');
        $id         = $this->generateUniqueId(self::ID_PREFIX_HISTORY);

        $this->transactional(function (PDO $pdo) use (
            $id, $trackId, $started, $ended, $duration, $sessionId, $planId, $sourceType,
        ): void {
            $pdo->prepare(
                'INSERT INTO playback_history
                    (id, track_id, started_at, ended_at, duration_played_sec,
                     session_id, plan_id, source_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$id, $trackId, $started, $ended, $duration, $sessionId, $planId, $sourceType]);

            if ($trackId !== null && $duration >= self::MIN_PLAY_DURATION_FOR_COUNT) {
                $pdo->prepare(
                    'UPDATE tracks SET play_count = play_count + 1, updated_at = ? WHERE id = ?'
                )->execute([date('c'), $trackId]);
            }
        });

        return [
            'id'                => $id,
            'trackId'           => $trackId,
            'startedAt'         => $started,
            'endedAt'           => $ended,
            'durationPlayedSec' => $duration,
            'sessionId'         => $sessionId,
            'planId'            => $planId,
            'sourceType'        => $sourceType,
        ];
    }

    /**
     * Get playback history records with optional filters.
     *
     * @return list<array>
     */
    public function getHistory(int $limit = 100, ?string $trackId = null, ?string $planId = null): array
    {
        $cappedLimit = self::clampInt($limit, 1, self::MAX_LIBRARY_LIMIT);
        $pdo         = $this->musicDb->getPdo();

        $where  = [];
        $params = [];

        if ($trackId !== null) {
            $where[]            = 'track_id = :trackId';
            $params[':trackId'] = $trackId;
        }
        if ($planId !== null) {
            $where[]          = 'plan_id = :planId';
            $params[':planId'] = $planId;
        }

        $sql  = 'SELECT * FROM playback_history';
        $sql .= $where !== [] ? ' WHERE ' . implode(' AND ', $where) : '';
        $sql .= ' ORDER BY started_at DESC LIMIT :lim';

        $stmt = $pdo->prepare($sql);
        $this->bindParams($stmt, $params);
        $stmt->bindValue(':lim', $cappedLimit, PDO::PARAM_INT);
        $stmt->execute();

        return array_map(self::rowToHistoryArray(...), $stmt->fetchAll() ?: []);
    }

    public function getTopTracks(int $limit = 50, ?string $since = null): array
    {
        $cappedLimit = self::clampInt($limit, 1, self::MAX_LIBRARY_LIMIT);
        $pdo         = $this->musicDb->getPdo();

        if ($since === null) {
            $stmt = $pdo->prepare(
                'SELECT * FROM tracks ORDER BY play_count DESC, title ASC LIMIT ?'
            );
            $stmt->bindValue(1, $cappedLimit, PDO::PARAM_INT);
            $stmt->execute();
            return array_map(self::rowToTrackArray(...), $stmt->fetchAll() ?: []);
        }

        // Tracks actually played in the window, ranked by play count.
        $stmt = $pdo->prepare(
            'SELECT t.*, COUNT(h.id) AS plays_in_window
             FROM tracks t
             INNER JOIN playback_history h
                 ON h.track_id = t.id AND h.started_at >= :since
             GROUP BY t.id
             ORDER BY plays_in_window DESC, t.title ASC
             LIMIT :lim'
        );
        $stmt->bindValue(':since', $since);
        $stmt->bindValue(':lim', $cappedLimit, PDO::PARAM_INT);
        $stmt->execute();

        return array_map(self::rowToTrackArray(...), $stmt->fetchAll() ?: []);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Recommendations & auto-playlists
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Recommend tracks given a seed: planId, genre, or random favorites fallback.
     *
     * @return list<array>
     */
    public function getRecommendations(?string $planId = null, ?string $genre = null, int $limit = 30): array
    {
        $cappedLimit = self::clampInt($limit, 1, self::MAX_SEARCH_LIMIT);
        $pdo         = $this->musicDb->getPdo();

        $rows = $this->tryFetchSeededRecommendations($pdo, $planId, $genre, $cappedLimit);

        if ($rows === []) {
            $rows = $this->fetchFallbackRecommendations($pdo, $cappedLimit);
        }

        return array_map(self::rowToTrackArray(...), $rows);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Transaction & mutation-reload helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Execute a callback inside a DB transaction with automatic rollback.
     *
     * @template T
     * @param callable(PDO): T $callback
     * @return T
     */
    private function transactional(callable $callback): mixed
    {
        $pdo = $this->musicDb->getPdo();
        $pdo->beginTransaction();
        try {
            $result = $callback($pdo);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    private function reloadTrack(string $trackId): array
    {
        $track = $this->getTrack($trackId);
        if ($track === null) {
            throw new RuntimeException(sprintf('Track "%s" not found after mutation.', $trackId));
        }
        return $track;
    }

    private function requirePlaylist(string $playlistId): array
    {
        $playlist = $this->getPlaylist($playlistId, true);
        if ($playlist === null) {
            throw new RuntimeException(sprintf('Playlist "%s" not found after mutation.', $playlistId));
        }
        return $playlist;
    }

    private function ensurePlaylistExists(string $id): void
    {
        $stmt = $this->musicDb->getPdo()->prepare('SELECT 1 FROM playlists WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        if ($stmt->fetchColumn() === false) {
            throw HttpException::notFound('Playlist not found');
        }
    }

    private function ensureTrackExists(string $id): void
    {
        $stmt = $this->musicDb->getPdo()->prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        if ($stmt->fetchColumn() === false) {
            throw HttpException::notFound('Track not found');
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Search helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @return list<MusicSourceAdapter>
     */
    private function getRelevantAdapters(?string $sourceType): array
    {
        if ($sourceType !== null && $sourceType !== '') {
            $adapter = $this->registry->get($sourceType);
            return $adapter !== null ? [$adapter] : [];
        }
        return $this->registry->list();
    }

    /**
     * @param list<MusicSourceAdapter> $adapters
     *
     * @return list<array{track: array, source: string}>
     */
    private function fetchSearchResultsFromAdapters(array $adapters, string $text, int $limit): array
    {
        $query   = new MusicQuery(text: $text, limit: $limit);
        $results = [];
        $seen    = [];

        foreach ($adapters as $adapter) {
            if (!$adapter->isAvailable()) {
                continue;
            }
            foreach ($adapter->search($query) as $dto) {
                $key = $this->trackDedupeKey(
                    $dto->sourceType ?? 'local',
                    $dto->externalId ?? null,
                    $dto->localPath  ?? null,
                    $dto->url        ?? null,
                );
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $results[]  = [
                    'track'  => $dto->toArray(),
                    'source' => $adapter->getSourceType(),
                ];
                if (count($results) >= $limit) {
                    return $results;
                }
            }
        }

        return $results;
    }

    /**
     * @param list<array{track: array, source: string}> $results
     *
     * @return list<array{track: array, source: string}>
     */
    private function mergeLocalSearchResults(array $results, string $text, int $remaining): array
    {
        if ($remaining <= 0) {
            return $results;
        }

        $likePattern = '%' . self::escapeLike($text) . '%';
        $stmt = $this->musicDb->getPdo()->prepare(
            "SELECT * FROM tracks
             WHERE title LIKE :q ESCAPE '\\'
                OR artist LIKE :q ESCAPE '\\'
                OR album LIKE :q ESCAPE '\\'
             LIMIT :lim"
        );
        $stmt->bindValue(':q', $likePattern);
        $stmt->bindValue(':lim', $remaining, PDO::PARAM_INT);
        $stmt->execute();

        // Build dedupe set from existing results
        $seen = [];
        foreach ($results as $r) {
            $t   = $r['track'];
            $key = $this->trackDedupeKey(
                $t['sourceType'] ?? 'local',
                $t['externalId'] ?? null,
                $t['localPath']  ?? null,
                $t['url']        ?? null,
            );
            $seen[$key] = true;
        }

        // Merge in local matches that aren't already present
        foreach ($stmt->fetchAll() ?: [] as $row) {
            $track = self::rowToTrackArray($row);
            $key   = $this->trackDedupeKey(
                $track['sourceType'],
                $track['externalId'],
                $track['localPath'],
                $track['url'],
            );
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $results[]  = [
                'track'  => $track,
                'source' => $track['sourceType'],
            ];
        }

        return $results;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Library query builder
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @return array{0: string, 1: array<string, scalar|null>}
     */
    private function buildLibraryQuery(?string $sourceType, ?string $genre, bool $favoriteOnly, ?string $searchText): array
    {
        $where  = [];
        $params = [];

        if ($sourceType !== null && $sourceType !== '') {
            $where[]        = 'source_type = :src';
            $params[':src'] = $sourceType;
        }
        if ($genre !== null && $genre !== '') {
            $where[]      = 'genre = :g';
            $params[':g'] = $genre;
        }
        if ($favoriteOnly) {
            $where[] = 'is_favorite = 1';
        }
        if ($searchText !== null && $searchText !== '') {
            $where[]       = "(title LIKE :st ESCAPE '\\'
                                OR artist LIKE :st ESCAPE '\\'
                                OR album LIKE :st ESCAPE '\\')";
            $params[':st'] = '%' . self::escapeLike($searchText) . '%';
        }

        $sql  = 'SELECT * FROM tracks';
        $sql .= $where !== [] ? ' WHERE ' . implode(' AND ', $where) : '';
        $sql .= ' ORDER BY play_count DESC, title ASC LIMIT :lim OFFSET :off';

        return [$sql, $params];
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Track upsert helpers
    // ═══════════════════════════════════════════════════════════════════

    private function findExistingTrack(PDO $pdo, MusicTrackDTO $dto, string $sourceType): ?array
    {
        if ($dto->externalId !== null && $dto->externalId !== '') {
            $stmt = $pdo->prepare(
                'SELECT * FROM tracks WHERE source_type = ? AND external_id = ? LIMIT 1'
            );
            $stmt->execute([$sourceType, $dto->externalId]);
            $match = $stmt->fetch();
            if ($match !== false) {
                return $match;
            }
        }

        if ($dto->localPath !== null && $dto->localPath !== '') {
            $stmt = $pdo->prepare(
                'SELECT * FROM tracks WHERE source_type = ? AND local_path = ? LIMIT 1'
            );
            $stmt->execute([$sourceType, $dto->localPath]);
            $match = $stmt->fetch();
            if ($match !== false) {
                return $match;
            }
        }

        return null;
    }

    private function updateExistingTrack(PDO $pdo, MusicTrackDTO $dto, string $trackId, string $now): string
    {
        $pdo->prepare(
            'UPDATE tracks
                SET title = ?, artist = ?, album = ?, duration_sec = ?, genre = ?,
                    url = ?, local_path = ?, cover_url = ?, year = ?, updated_at = ?
              WHERE id = ?'
        )->execute([
            $dto->title, $dto->artist, $dto->album,
            $dto->durationSec ?? 0, $dto->genre,
            $dto->url, $dto->localPath, $dto->coverUrl, $dto->year,
            $now, $trackId,
        ]);

        return $trackId;
    }

    private function createNewTrack(PDO $pdo, MusicTrackDTO $dto, string $sourceType, string $now): string
    {
        $id = $this->generateUniqueId(self::ID_PREFIX_TRACK);
        $pdo->prepare(
            'INSERT INTO tracks
                (id, source_type, external_id, title, artist, album, duration_sec, genre,
                 url, local_path, cover_url, year, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $id, $sourceType, $dto->externalId,
            $dto->title, $dto->artist, $dto->album,
            $dto->durationSec ?? 0, $dto->genre,
            $dto->url, $dto->localPath, $dto->coverUrl, $dto->year,
            $now, $now,
        ]);

        return $id;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Playlist helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @return list<array>
     */
    private function fetchPlaylistTracks(string $playlistId): array
    {
        $rows = $this->musicDb->getDb()->fetchAll(
            'SELECT t.*, i.position, i.id AS item_id
             FROM playlist_items i
             INNER JOIN tracks t ON t.id = i.track_id
             WHERE i.playlist_id = ?
             ORDER BY i.position ASC, i.added_at ASC',
            [$playlistId],
        );

        return array_map($this->mapPlaylistItemRow(...), $rows);
    }

    private function getNextPlaylistPosition(PDO $pdo, string $playlistId): int
    {
        $stmt = $pdo->prepare(
            'SELECT COALESCE(MAX(position), -1) FROM playlist_items WHERE playlist_id = ?'
        );
        $stmt->execute([$playlistId]);
        return (int)$stmt->fetchColumn() + 1;
    }

    private function buildPlaylistResponse(array $row, bool $includeTracks): array
    {
        $response = [
            'id'          => (string)$row['id'],
            'name'        => (string)$row['name'],
            'description' => (string)($row['description'] ?? ''),
            'coverUrl'    => $row['cover_url'] ?? null,
            'trackCount'  => (int)($row['track_count'] ?? 0),
            'createdAt'   => (string)$row['created_at'],
            'updatedAt'   => (string)$row['updated_at'],
        ];
        if ($includeTracks) {
            $response['tracks'] = [];
        }
        return $response;
    }

    private function mapPlaylistItemRow(array $r): array
    {
        $t = self::rowToTrackArray($r);
        $t['itemId']   = isset($r['item_id']) ? (string)$r['item_id'] : null;
        $t['position'] = isset($r['position']) ? (int)$r['position'] : 0;
        return $t;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Playback state helpers
    // ═══════════════════════════════════════════════════════════════════

    private function getDefaultPlaybackState(): array
    {
        return [
            'trackId'     => null,
            'playlistId'  => null,
            'isPlaying'   => false,
            'positionSec' => 0.0,
            'volume'      => 0.8,
            'shuffle'     => false,
            'repeatMode'  => 'off',
            'updatedAt'   => date('c'),
        ];
    }

    private function validatePlaybackState(array $state): array
    {
        $defaults = $this->getDefaultPlaybackState();
        $valid    = array_intersect_key($state, $defaults);
        return array_replace($defaults, $valid);
    }

    private function applyPlaybackPatch(array $current, array $patch): array
    {
        $patchable = ['trackId', 'playlistId', 'isPlaying', 'positionSec', 'volume', 'shuffle', 'repeatMode'];

        foreach ($patchable as $key) {
            if (!array_key_exists($key, $patch)) {
                continue;
            }
            $value = $patch[$key];
            $current[$key] = match ($key) {
                'isPlaying', 'shuffle' => (bool)$value,
                'positionSec'          => max(0.0, (float)$value),
                'volume'               => self::clampFloat((float)$value, self::VOLUME_MIN, self::VOLUME_MAX),
                'repeatMode'           => in_array((string)$value, self::REPEAT_MODES, true)
                                            ? (string)$value
                                            : 'off',
                default                => $value === null ? null : (string)$value,
            };
        }

        $current['updatedAt'] = date('c');
        return $current;
    }

    private function readPlaybackStateFile(): ?string
    {
        if (!is_file(self::PLAYBACK_STATE_FILE)) {
            return null;
        }

        $fp = @fopen(self::PLAYBACK_STATE_FILE, 'rb');
        if ($fp === false) {
            return null;
        }

        try {
            flock($fp, LOCK_SH);
            $raw = stream_get_contents($fp) ?: '';
        } finally {
            fclose($fp);
        }

        return $raw !== '' ? $raw : null;
    }

    private function persistPlaybackState(array $state): void
    {
        $dir = self::PLAYBACK_STATE_DIR;
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new RuntimeException(sprintf(
                'Cannot create playback state directory "%s".',
                $dir,
            ));
        }

        try {
            $json = json_encode(
                $state,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
            );
        } catch (JsonException $e) {
            throw new RuntimeException('Failed to encode playback state: ' . $e->getMessage(), 0, $e);
        }

        // PID + random bytes in temp name avoids collisions across processes.
        $tmp = sprintf(
            '%s.tmp.%s.%d',
            self::PLAYBACK_STATE_FILE,
            bin2hex(random_bytes(4)),
            getmypid(),
        );

        if (file_put_contents($tmp, $json, LOCK_EX) === false) {
            throw new RuntimeException('Failed to write playback state temp file.');
        }

        if (!@rename($tmp, self::PLAYBACK_STATE_FILE)) {
            @unlink($tmp);
            throw new RuntimeException(sprintf(
                'Failed to persist playback state at "%s".',
                self::PLAYBACK_STATE_FILE,
            ));
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Recommendation helpers
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Attempt to fetch seeded recommendations.
     *
     * @return list<array>
     */
    private function tryFetchSeededRecommendations(PDO $pdo, ?string $planId, ?string $genre, int $limit): array
    {
        $where  = [];
        $params = [];

        if ($genre !== null && $genre !== '') {
            $where[]  = 'genre = ?';
            $params[] = $genre;
        }

        if ($planId !== null && $planId !== '') {
            $seed = $this->collectPlanSeeds($pdo, $planId);
            if ($seed['genres'] !== [] || $seed['artists'] !== []) {
                $clauses = [];
                if ($seed['genres'] !== []) {
                    $ph = implode(',', array_fill(0, count($seed['genres']), '?'));
                    $clauses[] = "genre IN ($ph)";
                    array_push($params, ...$seed['genres']);
                }
                if ($seed['artists'] !== []) {
                    $ph = implode(',', array_fill(0, count($seed['artists']), '?'));
                    $clauses[] = "artist IN ($ph)";
                    array_push($params, ...$seed['artists']);
                }
                $where[] = '(' . implode(' OR ', $clauses) . ')';
            }
        }

        $sql  = 'SELECT * FROM tracks';
        $sql .= $where !== [] ? ' WHERE ' . implode(' AND ', $where) : '';
        $sql .= ' ORDER BY play_count ASC, RANDOM() LIMIT ?';
        $params[] = $limit;

        $stmt = $pdo->prepare($sql);
        foreach ($params as $i => $value) {
            $stmt->bindValue($i + 1, $value);
        }
        $stmt->execute();

        return $stmt->fetchAll() ?: [];
    }

    /**
     * @return array{genres: list<string>, artists: list<string>}
     */
    private function collectPlanSeeds(PDO $pdo, string $planId): array
    {
        $stmt = $pdo->prepare(
            'SELECT DISTINCT genre, artist
             FROM tracks t
             INNER JOIN playback_history h ON h.track_id = t.id
             WHERE h.plan_id = ?
             LIMIT 50'
        );
        $stmt->execute([$planId]);
        $rows = $stmt->fetchAll() ?: [];

        $genres  = array_values(array_filter(array_unique(array_map(
            static fn($r) => isset($r['genre']) ? (string)$r['genre'] : '',
            $rows,
        ))));
        $artists = array_values(array_filter(array_unique(array_map(
            static fn($r) => isset($r['artist']) ? (string)$r['artist'] : '',
            $rows,
        ))));

        return ['genres' => $genres, 'artists' => $artists];
    }

    /**
     * Fallback recommendations: favorites first, then any tracks.
     * A single query with priority ordering — one round-trip, no partial loss.
     *
     * @return list<array>
     */
    private function fetchFallbackRecommendations(PDO $pdo, int $limit): array
    {
        $stmt = $pdo->prepare(
            'SELECT * FROM tracks
             ORDER BY is_favorite DESC, RANDOM()
             LIMIT ?'
        );
        $stmt->bindValue(1, $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll() ?: [];
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Private: Utilities
    // ═══════════════════════════════════════════════════════════════════

    private function generateUniqueId(string $prefix): string
    {
        return $prefix . bin2hex(random_bytes(self::ID_RANDOM_BYTES));
    }

    private function trackDedupeKey(string $sourceType, ?string $externalId, ?string $localPath, ?string $url): string
    {
        return $sourceType . '|' . ($externalId ?? $localPath ?? $url ?? '');
    }

    /**
     * Bind a map of named parameters to a statement.
     *
     * @param array<string, scalar|null> $params
     */
    private function bindParams(PDOStatement $stmt, array $params): void
    {
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value);
        }
    }

    private static function extractNullableString(array $data, string $key): ?string
    {
        if (!array_key_exists($key, $data) || $data[$key] === null) {
            return null;
        }
        return (string)$data[$key];
    }

    private static function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }

    private static function clampInt(int $value, int $min, int $max): int
    {
        return max($min, min($value, $max));
    }

    private static function clampFloat(float $value, float $min, float $max): float
    {
        return max($min, min($value, $max));
    }

    private static function rowToTrackArray(array $row): array
    {
        return [
            'id'          => (string)($row['id'] ?? ''),
            'sourceType'  => (string)($row['source_type'] ?? 'local'),
            'externalId'  => $row['external_id'] ?? null,
            'title'       => (string)($row['title'] ?? ''),
            'artist'      => (string)($row['artist'] ?? ''),
            'album'       => (string)($row['album'] ?? ''),
            'durationSec' => (int)($row['duration_sec'] ?? 0),
            'genre'       => $row['genre'] ?? null,
            'url'         => $row['url'] ?? null,
            'localPath'   => $row['local_path'] ?? null,
            'coverUrl'    => $row['cover_url'] ?? null,
            'year'        => $row['year'] ?? null,
            'isFavorite'  => (bool)($row['is_favorite'] ?? false),
            'playCount'   => (int)($row['play_count'] ?? 0),
            'createdAt'   => (string)($row['created_at'] ?? ''),
            'updatedAt'   => (string)($row['updated_at'] ?? ''),
        ];
    }

    private static function rowToHistoryArray(array $row): array
    {
        return [
            'id'                => (string)($row['id'] ?? ''),
            'trackId'           => $row['track_id'] ?? null,
            'startedAt'         => (string)($row['started_at'] ?? ''),
            'endedAt'           => $row['ended_at'] ?? null,
            'durationPlayedSec' => (int)($row['duration_played_sec'] ?? 0),
            'sessionId'         => $row['session_id'] ?? null,
            'planId'            => $row['plan_id'] ?? null,
            'sourceType'        => $row['source_type'] ?? null,
        ];
    }
}