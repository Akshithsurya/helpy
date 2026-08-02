<?php

declare(strict_types=1);

/**
 * Custom exception for music source operations.
 */
final class MusicSourceException extends RuntimeException
{
    public static function adapterUnavailable(string $sourceType): self
    {
        return new self(sprintf('Music source adapter "%s" is not available.', $sourceType));
    }

    public static function trackNotFound(string $externalId): self
    {
        return new self(sprintf('Track with external ID "%s" was not found.', $externalId));
    }
}

/**
 * Value DTO describing a single track as returned or accepted by a source adapter.
 */
final class MusicTrackDTO implements JsonSerializable
{
    public function __construct(
        public readonly string $title,
        public readonly ?string $artist = null,
        public readonly ?string $album = null,
        public readonly ?int $durationSec = null,
        public readonly ?string $genre = null,
        public readonly ?string $url = null,
        public readonly ?string $localPath = null,
        public readonly ?string $coverUrl = null,
        public readonly ?int $year = null,
        public readonly ?string $externalId = null,
        public readonly ?string $sourceType = null,
    ) {
        if ($durationSec !== null && $durationSec < 0) {
            throw new InvalidArgumentException(
                sprintf('durationSec must be non-negative, got %d.', $durationSec)
            );
        }
        if ($year !== null && ($year < 0 || $year > 9999)) {
            throw new InvalidArgumentException(
                sprintf('year must be between 0 and 9999, got %d.', $year)
            );
        }
    }

    /**
     * Return a copy with the given source type applied, unless already set.
     */
    public function withSourceType(string $sourceType): self
    {
        if ($this->sourceType !== null) {
            return $this;
        }
        return new self(
            title:       $this->title,
            artist:      $this->artist,
            album:       $this->album,
            durationSec: $this->durationSec,
            genre:       $this->genre,
            url:         $this->url,
            localPath:   $this->localPath,
            coverUrl:    $this->coverUrl,
            year:        $this->year,
            externalId:  $this->externalId,
            sourceType:  $sourceType,
        );
    }

    public static function fromArray(array $data): self
    {
        return new self(
            title:       self::extractString($data, 'title')
                         ?? self::extractString($data, 'name')
                         ?? 'Untitled',
            artist:      self::extractString($data, 'artist'),
            album:       self::extractString($data, 'album'),
            durationSec: self::extractInt($data, 'durationSec')
                         ?? self::extractInt($data, 'duration'),
            genre:       self::extractString($data, 'genre'),
            url:         self::extractString($data, 'url'),
            localPath:   self::extractString($data, 'localPath'),
            coverUrl:    self::extractString($data, 'coverUrl'),
            year:        self::extractInt($data, 'year'),
            externalId:  self::extractString($data, 'externalId'),
            sourceType:  self::extractString($data, 'sourceType'),
        );
    }

    public function toArray(): array
    {
        return [
            'title'       => $this->title,
            'artist'      => $this->artist,
            'album'       => $this->album,
            'durationSec' => $this->durationSec,
            'genre'       => $this->genre,
            'url'         => $this->url,
            'localPath'   => $this->localPath,
            'coverUrl'    => $this->coverUrl,
            'year'        => $this->year,
            'externalId'  => $this->externalId,
            'sourceType'  => $this->sourceType,
        ];
    }

    public function jsonSerialize(): array
    {
        return $this->toArray();
    }

    private static function extractString(array $data, string $key): ?string
    {
        if (!array_key_exists($key, $data) || $data[$key] === null) {
            return null;
        }
        $value = trim((string) $data[$key]);
        return $value !== '' ? $value : null;
    }

    private static function extractInt(array $data, string $key): ?int
    {
        if (!array_key_exists($key, $data) || $data[$key] === null) {
            return null;
        }
        $value = filter_var($data[$key], FILTER_VALIDATE_INT);
        return $value !== false ? $value : null;
    }
}

/**
 * Query DTO passed into adapters for searching / listing tracks.
 */
final class MusicQuery
{
    public function __construct(
        public readonly string $text = '',
        public readonly int $limit = 50,
        public readonly int $offset = 0,
        public readonly ?string $genre = null,
        public readonly ?string $artist = null,
        public readonly ?string $album = null,
    ) {
        if ($limit < 1) {
            throw new InvalidArgumentException(
                sprintf('limit must be at least 1, got %d.', $limit)
            );
        }
        if ($limit > 500) {
            throw new InvalidArgumentException(
                sprintf('limit must not exceed 500, got %d.', $limit)
            );
        }
        if ($offset < 0) {
            throw new InvalidArgumentException(
                sprintf('offset must be non-negative, got %d.', $offset)
            );
        }
    }
}

/**
 * Contract for all music source adapters.
 */
interface MusicSourceAdapterInterface
{
    public function getSourceType(): string;
    public function isAvailable(): bool;
    /** @return MusicTrackDTO[] */
    public function search(MusicQuery $query): array;
    public function resolveStreamUrl(string $externalId): ?string;
    public function getTrackById(string $externalId): ?MusicTrackDTO;
}

/**
 * Abstract base for music source adapters.
 *
 * Each adapter knows only how to fetch / search / stream-enable tracks for
 * its source. Business persistence goes through MusicService, not here.
 */
abstract class AbstractMusicSourceAdapter implements MusicSourceAdapterInterface
{
    /**
     * Normalize a raw data row into a MusicTrackDTO, ensuring sourceType is set.
     */
    protected function normalize(array $row): MusicTrackDTO
    {
        return MusicTrackDTO::fromArray($row)->withSourceType($this->getSourceType());
    }
}

/**
 * Local filesystem adapter. Scans directories for audio files and catalogues
 * metadata derived from filenames. Supports recursive scanning and basic
 * text search against cached results.
 */
final class LocalFileAdapter extends AbstractMusicSourceAdapter
{
    private const EXTS = ['mp3', 'm4a', 'flac', 'ogg', 'wav', 'aac', 'opus', 'webm'];
    private const MAX_SCAN = 5000;

    /** @var array<string, MusicTrackDTO> Indexed by externalId */
    private array $trackIndex = [];

    /** @var string[] */
    private readonly array $folders;

    public function __construct(array $folders = [])
    {
        $this->folders = array_values(array_filter(
            $folders,
            static fn(mixed $f): bool => is_string($f) && is_dir($f),
        ));
    }

    public function getSourceType(): string { return 'local'; }

    public function isAvailable(): bool { return true; }

    public function search(MusicQuery $query): array
    {
        $tracks = $this->getIndexedTracks();
        $results = [];

        foreach ($tracks as $track) {
            if ($this->matchesQuery($track, $query)) {
                $results[] = $track;
            }
        }

        return array_slice($results, $query->offset, $query->limit);
    }

    public function getTrackById(string $externalId): ?MusicTrackDTO
    {
        return $this->getIndexedTracks()[$externalId] ?? null;
    }

    public function resolveStreamUrl(string $externalId): ?string
    {
        return null; // Use localPath from the DTO directly
    }

    /**
     * Scan configured folders for audio files and return DTOs.
     *
     * @return MusicTrackDTO[]
     */
    public function scanFolders(int $limit = 1000): array
    {
        $out = [];
        foreach ($this->folders as $folder) {
            $this->scanDirectory($folder, $out, $limit);
            if (count($out) >= $limit) break;
        }
        return $out;
    }

    /**
     * Clear the internal track cache so the next operation re-scans.
     */
    public function invalidateCache(): void
    {
        $this->trackIndex = [];
    }

    /** @return array<string, MusicTrackDTO> */
    private function getIndexedTracks(): array
    {
        if (!empty($this->trackIndex)) {
            return $this->trackIndex;
        }
        foreach ($this->scanFolders(self::MAX_SCAN) as $track) {
            if ($track->externalId !== null) {
                $this->trackIndex[$track->externalId] = $track;
            }
        }
        return $this->trackIndex;
    }

    private function matchesQuery(MusicTrackDTO $track, MusicQuery $query): bool
    {
        if ($query->text !== '') {
            $needle = mb_strtolower($query->text);
            $haystack = mb_strtolower(
                $track->title . ' ' . ($track->artist ?? '') . ' ' . ($track->album ?? '')
            );
            if (!str_contains($haystack, $needle)) {
                return false;
            }
        }

        if ($query->genre !== null
            && mb_strtolower($track->genre ?? '') !== mb_strtolower($query->genre)) {
            return false;
        }
        if ($query->artist !== null
            && mb_strtolower($track->artist ?? '') !== mb_strtolower($query->artist)) {
            return false;
        }
        if ($query->album !== null
            && mb_strtolower($track->album ?? '') !== mb_strtolower($query->album)) {
            return false;
        }

        return true;
    }

    /**
     * @param MusicTrackDTO[] $out
     */
    private function scanDirectory(string $folder, array &$out, int $limit): void
    {
        $pattern = rtrim(str_replace('\\', '/', $folder), '/') . '/*';
        $matches = glob($pattern);
        if ($matches === false) return;

        foreach ($matches as $path) {
            if (count($out) >= $limit) return;

            if (is_dir($path)) {
                $this->scanDirectory($path, $out, $limit);
                continue;
            }

            $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
            if (!in_array($ext, self::EXTS, true)) continue;

            $out[] = $this->pathToTrack($path);
        }
    }

    private function pathToTrack(string $path): MusicTrackDTO
    {
        $filename = pathinfo($path, PATHINFO_FILENAME);
        $title = $filename;
        $artist = null;

        if (str_contains($filename, ' - ')) {
            [$artist, $title] = explode(' - ', $filename, 2);
        }

        return new MusicTrackDTO(
            title:      trim($title),
            artist:     $artist !== null ? trim($artist) : null,
            localPath:  $path,
            externalId: 'loc_' . substr(hash('sha256', $path), 0, 16),
            sourceType: $this->getSourceType(),
        );
    }
}

/**
 * YouTube adapter — returns stub metadata entries for development.
 * No API calls are made; callers should supplement their own proxy to
 * yt-dlp or similar for real functionality.
 */
final class YouTubeAdapter extends AbstractMusicSourceAdapter
{
    public function getSourceType(): string { return 'youtube'; }

    public function isAvailable(): bool { return true; }

    public function search(MusicQuery $query): array
    {
        if ($query->text === '') return [];
        $results = [];
        $count = min($query->limit, 10);
        for ($i = 0; $i < $count; $i++) {
            $results[] = new MusicTrackDTO(
                title:      sprintf('%s (YouTube result %d)', $query->text, $i + 1),
                artist:     'YouTube Artist',
                durationSec: 180 + (crc32($query->text) + $i) % 300,
                genre:      $query->genre,
                url:        'https://www.youtube.com/results?search_query=' . urlencode($query->text),
                externalId: 'yt_' . substr(hash('sha256', $query->text . $i), 0, 16),
                sourceType: $this->getSourceType(),
            );
        }
        return $results;
    }

    public function resolveStreamUrl(string $externalId): ?string { return null; }
    public function getTrackById(string $externalId): ?MusicTrackDTO { return null; }
}

/**
 * Spotify adapter. Without credentials, isAvailable() returns false and all
 * search calls short-circuit to empty. A real integration would inject a
 * client wrapper here.
 */
final class SpotifyAdapter extends AbstractMusicSourceAdapter
{
    public function __construct(
        private readonly ?string $accessToken = null,
    ) {}

    public function getSourceType(): string { return 'spotify'; }

    public function isAvailable(): bool
    {
        return $this->accessToken !== null && $this->accessToken !== '';
    }

    public function search(MusicQuery $query): array
    {
        if (!$this->isAvailable() || $query->text === '') return [];
        $results = [];
        $count = min($query->limit, 5);
        for ($i = 0; $i < $count; $i++) {
            $results[] = new MusicTrackDTO(
                title:      sprintf('%s (Spotify %d)', $query->text, $i + 1),
                artist:     'Spotify Artist',
                album:      'Spotify Album',
                durationSec: 200 + $i * 10,
                genre:      $query->genre,
                url:        'https://open.spotify.com/search/' . urlencode($query->text),
                externalId: 'sp_' . substr(hash('sha256', $query->text . $i), 0, 16),
                sourceType: $this->getSourceType(),
            );
        }
        return $results;
    }

    public function resolveStreamUrl(string $externalId): ?string { return null; }
    public function getTrackById(string $externalId): ?MusicTrackDTO { return null; }
}

/**
 * SoundCloud adapter. Same design as Spotify: safe to call without credentials.
 */
final class SoundCloudAdapter extends AbstractMusicSourceAdapter
{
    public function getSourceType(): string { return 'soundcloud'; }

    public function isAvailable(): bool { return true; }

    public function search(MusicQuery $query): array
    {
        if ($query->text === '') return [];
        $results = [];
        $count = min($query->limit, 5);
        for ($i = 0; $i < $count; $i++) {
            $results[] = new MusicTrackDTO(
                title:      sprintf('%s (SoundCloud %d)', $query->text, $i + 1),
                artist:     'SoundCloud Creator',
                durationSec: 240 + $i * 7,
                genre:      $query->genre,
                url:        'https://soundcloud.com/search?q=' . urlencode($query->text),
                externalId: 'sc_' . substr(hash('sha256', $query->text . $i), 0, 16),
                sourceType: $this->getSourceType(),
            );
        }
        return $results;
    }

    public function resolveStreamUrl(string $externalId): ?string { return null; }
    public function getTrackById(string $externalId): ?MusicTrackDTO { return null; }
}

/**
 * Registry for all music source adapters. Not a singleton — construct fresh
 * instances in tests or per-request as needed.
 */
final class MusicSourceAdapterRegistry
{
    /** @var array<string, MusicSourceAdapterInterface> */
    private array $adapters = [];

    public static function withDefaults(
        ?string $spotifyToken = null,
        array $localFolders = [],
    ): self {
        $registry = new self();
        $registry->register(new LocalFileAdapter($localFolders));
        $registry->register(new YouTubeAdapter());
        $registry->register(new SpotifyAdapter($spotifyToken));
        $registry->register(new SoundCloudAdapter());
        return $registry;
    }

    public function register(MusicSourceAdapterInterface $adapter): void
    {
        $this->adapters[$adapter->getSourceType()] = $adapter;
    }

    public function unregister(string $sourceType): void
    {
        unset($this->adapters[$sourceType]);
    }

    public function has(string $sourceType): bool
    {
        return isset($this->adapters[$sourceType]);
    }

    public function get(string $sourceType): ?MusicSourceAdapterInterface
    {
        return $this->adapters[$sourceType] ?? null;
    }

    /** @return array<string, MusicSourceAdapterInterface> */
    public function all(): array
    {
        return $this->adapters;
    }

    /** @return array<string, bool> sourceType => isAvailable */
    public function availability(): array
    {
        return array_map(
            static fn(MusicSourceAdapterInterface $a): bool => $a->isAvailable(),
            $this->adapters,
        );
    }

    /**
     * Search across all available adapters and merge results.
     *
     * Note: each adapter applies the query limit independently, so the total
     * may exceed MusicQuery::$limit. The caller should slice if needed.
     *
     * @return MusicTrackDTO[]
     */
    public function searchAll(MusicQuery $query): array
    {
        $results = [];
        foreach ($this->adapters as $adapter) {
            if ($adapter->isAvailable()) {
                $results = [...$results, ...$adapter->search($query)];
            }
        }
        return $results;
    }
}