<?php

declare(strict_types=1);

/**
 * Music subsystem database management.
 *
 * Manages six tables for the music feature:
 *   tracks                - song metadata across all sources
 *   playlists             - user playlists
 *   playlist_items        - playlist/track join with ordering
 *   playback_history      - play events with optional plan linkage
 *   library_folders       - local filesystem watch roots
 *   source_credentials    - per-source OAuth/credential storage
 *
 * Schema & indexes are applied inside the constructor (idempotent via
 * CREATE TABLE IF NOT EXISTS) so this class is safe to new() repeatedly.
 */
final class MusicDatabase
{
    // List of valid scan statuses for library folders, enforced via application logic
    public const LIBRARY_SCAN_STATUS_IDLE = 'idle';
    public const LIBRARY_SCAN_STATUS_SCANNING = 'scanning';
    public const LIBRARY_SCAN_STATUS_ERROR = 'error';

    public function __construct(
        private readonly Database $db,
    ) {
        $this->ensureSchema();
    }

    public function getDb(): Database
    {
        return $this->db;
    }

    public function getPdo(): PDO
    {
        return $this->db->getConnection();
    }

    private function ensureSchema(): void
    {
        $pdo = $this->db->getConnection();
        $originalErrorMode = $pdo->getAttribute(PDO::ATTR_ERRMODE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        
        $pdo->beginTransaction();
        try {
            // Create core tables with improved constraints and composite unique indexes
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS tracks (
                    id TEXT PRIMARY KEY,
                    source_type TEXT NOT NULL,
                    external_id TEXT,
                    title TEXT NOT NULL,
                    artist TEXT,
                    album TEXT,
                    duration_sec INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
                    genre TEXT,
                    url TEXT,
                    local_path TEXT UNIQUE,
                    cover_url TEXT,
                    year INTEGER CHECK (year IS NULL OR (year >= 1870 AND year <= strftime(\'%Y\', \'now\'))),
                    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
                    play_count INTEGER NOT NULL DEFAULT 0 CHECK (play_count >= 0),
                    created_at TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\')),
                    updated_at TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\')),
                    UNIQUE(source_type, external_id)
                )'
            );

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    cover_url TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\')),
                    updated_at TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))
                )'
            );

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS playlist_items (
                    id TEXT PRIMARY KEY,
                    playlist_id TEXT NOT NULL,
                    track_id TEXT NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
                    added_at TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\')),
                    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                    FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE,
                    UNIQUE(playlist_id, track_id)
                )'
            );

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS playback_history (
                    id TEXT PRIMARY KEY,
                    track_id TEXT,
                    started_at TEXT NOT NULL DEFAULT (datetime(\'now\', \'localtime\')),
                    ended_at TEXT,
                    duration_played_sec INTEGER NOT NULL DEFAULT 0 CHECK (duration_played_sec >= 0),
                    session_id TEXT,
                    plan_id TEXT,
                    source_type TEXT,
                    FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE SET NULL
                )'
            );

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS library_folders (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE,
                    display_name TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                    last_scanned_at TEXT,
                    scan_status TEXT NOT NULL DEFAULT \'idle\' CHECK (scan_status IN (\'idle\', \'scanning\', \'error\'))
                )'
            );

            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS source_credentials (
                    id TEXT PRIMARY KEY,
                    source_type TEXT NOT NULL UNIQUE,
                    credential_json TEXT,
                    user_display_name TEXT,
                    connected_at TEXT,
                    expires_at TEXT
                )'
            );

            // Create indexes with additional performance-optimized composite indexes
            $pdo->exec(
                'CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source_type);
                 CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
                 CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
                 CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
                 CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
                 CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
                 CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count DESC);
                 CREATE INDEX IF NOT EXISTS idx_tracks_local_path ON tracks(local_path);
                 CREATE INDEX IF NOT EXISTS idx_tracks_source_external ON tracks(source_type, external_id);

                 CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
                 CREATE INDEX IF NOT EXISTS idx_playlist_items_track ON playlist_items(track_id);
                 CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlist_id, position);

                 CREATE INDEX IF NOT EXISTS idx_history_started ON playback_history(started_at DESC);
                 CREATE INDEX IF NOT EXISTS idx_history_track ON playback_history(track_id);
                 CREATE INDEX IF NOT EXISTS idx_history_plan ON playback_history(plan_id);
                 CREATE INDEX IF NOT EXISTS idx_history_session ON playback_history(session_id);
                 CREATE INDEX IF NOT EXISTS idx_history_recent ON playback_history(started_at, track_id);'
            );

            // Add trigger to auto-update updated_at timestamp for tracks
            $this->createUpdateTrigger($pdo, 'tracks');
            // Add trigger to auto-update updated_at timestamp for playlists
            $this->createUpdateTrigger($pdo, 'playlists');

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        } finally {
            // Restore original error mode to avoid breaking existing database behavior
            $pdo->setAttribute(PDO::ATTR_ERRMODE, $originalErrorMode);
        }
    }

    /**
     * Helper method to create a trigger that auto-updates the updated_at column
     * whenever a row is modified, ensuring timestamp consistency
     */
    private function createUpdateTrigger(PDO $pdo, string $tableName): void
    {
        $triggerName = sprintf('trg_%s_update_timestamp', $tableName);
        $pdo->exec(sprintf(
            'CREATE TRIGGER IF NOT EXISTS %s AFTER UPDATE ON %s
             BEGIN
                 UPDATE %s SET updated_at = datetime(\'now\', \'localtime\') WHERE id = OLD.id;
             END',
            $triggerName,
            $tableName,
            $tableName
        ));
    }

    /**
     * Execute a callable within a database transaction, handling commit/rollback automatically
     * Supports nested transactions by reusing the existing active transaction if one exists
     */
    public function inTransaction(callable $fn): mixed
    {
        $pdo = $this->db->getConnection();
        if ($pdo->inTransaction()) {
            return $fn($this);
        }

        $originalErrorMode = $pdo->getAttribute(PDO::ATTR_ERRMODE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        
        $pdo->beginTransaction();
        try {
            $result = $fn($this);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        } finally {
            $pdo->setAttribute(PDO::ATTR_ERRMODE, $originalErrorMode);
        }
    }
}
