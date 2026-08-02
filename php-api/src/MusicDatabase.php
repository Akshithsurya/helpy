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
        $pdo->beginTransaction();
        try {
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS tracks (
                    id TEXT PRIMARY KEY,
                    source_type TEXT NOT NULL,
                    external_id TEXT,
                    title TEXT NOT NULL,
                    artist TEXT,
                    album TEXT,
                    duration_sec INTEGER DEFAULT 0,
                    genre TEXT,
                    url TEXT,
                    local_path TEXT,
                    cover_url TEXT,
                    year INTEGER,
                    is_favorite INTEGER DEFAULT 0,
                    play_count INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime(\'now\', \'localtime\')),
                    updated_at TEXT DEFAULT (datetime(\'now\', \'localtime\'))
                )'
            );
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    cover_url TEXT,
                    created_at TEXT DEFAULT (datetime(\'now\', \'localtime\')),
                    updated_at TEXT DEFAULT (datetime(\'now\', \'localtime\'))
                )'
            );
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS playlist_items (
                    id TEXT PRIMARY KEY,
                    playlist_id TEXT NOT NULL,
                    track_id TEXT NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0,
                    added_at TEXT DEFAULT (datetime(\'now\', \'localtime\')),
                    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                    FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE
                )'
            );
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS playback_history (
                    id TEXT PRIMARY KEY,
                    track_id TEXT,
                    started_at TEXT DEFAULT (datetime(\'now\', \'localtime\')),
                    ended_at TEXT,
                    duration_played_sec INTEGER DEFAULT 0,
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
                    enabled INTEGER DEFAULT 1,
                    last_scanned_at TEXT,
                    scan_status TEXT DEFAULT \'idle\'
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

            $pdo->exec(
                'CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source_type);
                 CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
                 CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
                 CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);
                 CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);

                 CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
                 CREATE INDEX IF NOT EXISTS idx_playlist_items_track ON playlist_items(track_id);
                 CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlist_id, position);

                 CREATE INDEX IF NOT EXISTS idx_history_started ON playback_history(started_at);
                 CREATE INDEX IF NOT EXISTS idx_history_track ON playback_history(track_id);
                 CREATE INDEX IF NOT EXISTS idx_history_plan ON playback_history(plan_id);'
            );

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    public function inTransaction(callable $fn): mixed
    {
        $pdo = $this->db->getConnection();
        if ($pdo->inTransaction()) {
            return $fn($this);
        }
        $pdo->beginTransaction();
        try {
            $result = $fn($this);
            $pdo->commit();
            return $result;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }
}
