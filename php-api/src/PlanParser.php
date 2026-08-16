<?php

declare(strict_types=1);

/**
 * Immutable DTO representing a parsed plan configuration.
 * Replaces the original loose array with type-safe, named properties.
 */
final class PlanResult
{
    /**
     * @param string       $title            Display title for the session
     * @param string       $goal             Session goal description
     * @param int          $durationMinutes  Total session duration (clamped 5–240)
     * @param string|null  $usedPreset       Key of the matched preset, if any
     * @param int          $chunkSizeMinutes Work-interval length (clamped 1–120)
     * @param int          $breakMinutes     Break length (clamped 0–30)
     * @param list<string> $tags             Session tags
     * @param string|null  $musicPreset      Music preset identifier
     * @param string|null  $playlistId       External playlist identifier
     * @param string|null  $musicSource      Music source platform
     * @param string|null  $genre            Music genre filter
     */
    public function __construct(
        public readonly string $title = 'Planned session',
        public readonly string $goal = '',
        public readonly int $durationMinutes = 30,
        public readonly ?string $usedPreset = null,
        public readonly int $chunkSizeMinutes = 15,
        public readonly int $breakMinutes = 5,
        public readonly array $tags = [],
        public readonly ?string $musicPreset = null,
        public readonly ?string $playlistId = null,
        public readonly ?string $musicSource = null,
        public readonly ?string $genre = null,
    ) {}

    /** Backward-compatible bridge for code expecting the old array format. */
    public function toArray(): array
    {
        return get_object_vars($this);
    }
}

/**
 * Immutable definition of a single plan preset.
 */
final class PresetDefinition
{
    public function __construct(
        public readonly string $title,
        public readonly int $duration,
        public readonly string $goal = '',
        public readonly ?string $musicPreset = null,
        public readonly ?string $genre = null,
    ) {}
}

/**
 * Internal DTO for strictly typed intermediate flag parsing state.
 */
final class ParsedFlags
{
    public function __construct(
        public readonly string $goal = '',
        public readonly ?int $chunk = null,
        public readonly ?int $break = null,
        public readonly array $tags = [],
        public readonly string $music = '',
        public readonly string $playlist = '',
        public readonly string $source = '',
        public readonly string $genre = '',
        public readonly string $remaining = '',
    ) {}
}

/**
 * Parses natural-language plan strings into structured PlanResult objects.
 *
 * Processing phases (applied in order):
 *   1. Extract --flag values (--goal, --chunk, --break, --tags, --music, --playlist, --source, --genre)
 *   2. Match a preset keyword at the head of remaining text
 *   3. Extract a duration expression (hours, minutes, or bare number)
 *   4. Whatever is left becomes the custom title
 */
final class PlanParser
{
    // ─── Preset catalogue ────────────────────────────────────────────────

    private const PRESET_RAW_DATA = [
        'work'             => ['title' => 'Work Session',       'duration' => 60,  'goal' => 'Focus on work tasks'],
        'study'            => ['title' => 'Study Session',      'duration' => 45,  'goal' => 'Focus on studying'],
        'focus'            => ['title' => 'Deep Focus',         'duration' => 25,  'goal' => 'Deep focus session'],
        'code'             => ['title' => 'Coding Session',     'duration' => 90,  'goal' => 'Write code and solve problems'],
        'design'           => ['title' => 'Design Session',     'duration' => 60,  'goal' => 'Create and refine designs'],
        'write'            => ['title' => 'Writing Session',    'duration' => 45,  'goal' => 'Write articles, docs, or content'],
        'read'             => ['title' => 'Reading Session',    'duration' => 30,  'goal' => 'Read and learn new things'],
        'exercise'         => ['title' => 'Exercise Session',   'duration' => 45,  'goal' => 'Physical activity or workout'],
        'meditate'         => ['title' => 'Meditation Session', 'duration' => 15,  'goal' => 'Practice mindfulness and meditation'],
        'clean'            => ['title' => 'Cleaning Session',   'duration' => 30,  'goal' => 'Clean and organize space'],
        'review'           => ['title' => 'Review Session',     'duration' => 45,  'goal' => 'Review work or materials'],
        'plan'             => ['title' => 'Planning Session',   'duration' => 30,  'goal' => 'Plan and organize tasks'],
        'sprint'           => ['title' => 'Quick Focus Sprint', 'duration' => 25,  'goal' => 'Short, focused burst of work'],
        'blitz'            => ['title' => 'Task Blitz',         'duration' => 15,  'goal' => 'Knock out small tasks quickly'],
        'micro'            => ['title' => 'Micro Focus',        'duration' => 10,  'goal' => 'Ultra-short focus session'],
        'deep'             => ['title' => 'Deep Dive',          'duration' => 45,  'goal' => 'Extended focused work'],
        'quick task'       => ['title' => 'Quick Task Blitz',   'duration' => 10,  'goal' => 'Tackle one small task'],
        'lofi-focus'       => ['title' => 'Lo-fi Focus',        'duration' => 90,  'goal' => 'Deep focus with lo-fi beats',        'musicPreset' => 'lofi',      'genre' => 'ambient'],
        'classical-study'  => ['title' => 'Classical Study',    'duration' => 60,  'goal' => 'Study with classical music',       'musicPreset' => 'classical', 'genre' => 'classical'],
        'white-noise'      => ['title' => 'White Noise Session','duration' => 120, 'goal' => 'Focus masking',                   'musicPreset' => 'noise',     'genre' => 'noise'],
        'binaural'         => ['title' => 'Binaural Focus',     'duration' => 45,  'goal' => 'Binaural beats focus session',   'musicPreset' => 'binaural',  'genre' => 'binaural'],
        'ambient-code'     => ['title' => 'Ambient Coding',     'duration' => 120, 'goal' => 'Coding with ambient backdrop',   'musicPreset' => 'ambient',   'genre' => 'electronic'],
        'energize'         => ['title' => 'Energize Sprint',    'duration' => 25,  'goal' => 'High-energy sprint',            'musicPreset' => 'upbeat',    'genre' => 'electronic'],
    ];

    // ─── Constraints ──────────────────────────────────────────────────────

    public const MIN_DURATION     = 5;
    public const MAX_DURATION     = 240;
    public const DEFAULT_DURATION = 30;
    public const DEFAULT_CHUNK    = 15;
    public const DEFAULT_BREAK    = 5;
    public const MIN_CHUNK        = 1;
    public const MAX_CHUNK        = 120;
    public const MIN_BREAK        = 0;
    public const MAX_BREAK        = 30;

    /** @var list<string> Allowed --source values (case-insensitive). */
    private const ALLOWED_SOURCES = ['local', 'youtube', 'spotify', 'soundcloud', 'all'];

    // ─── Regex building blocks ────────────────────────────────────────────

    private const QUOTED_OR_BARE = '(?:"([^"]+)"|\'([^\']+)\'|(\S+))';
    private const FLAG_SEP = '(?:\s+|[=:]\s*)';

    // ─── Instance state ───────────────────────────────────────────────────

    /** @var array<string, PresetDefinition> Preset key → typed definition. */
    private readonly array $presets;

    /** @var array<string, string> mb_strtolower(key) → original key, sorted longest-first. */
    private readonly array $presetLookup;

    /** @var string Pre-compiled master regex for all presets */
    private readonly string $presetMasterPattern;

    /** @var array<string, string> Flag name → compiled extraction regex. */
    private readonly array $flagPatterns;

    /** @var array<string, callable> Pre-compiled duration regex patterns and their calculators */
    private readonly array $durationPatterns;

    public function __construct(?array $customPresets = null)
    {
        $raw = $customPresets ?? self::PRESET_RAW_DATA;

        $this->presets = [];
        $presetLookup = [];

        foreach ($raw as $key => $def) {
            $this->presets[$key] = new PresetDefinition(
                title:       $def['title'],
                duration:    $def['duration'],
                goal:        $def['goal'] ?? '',
                musicPreset: $def['musicPreset'] ?? null,
                genre:       $def['genre'] ?? null,
            );
            $presetLookup[mb_strtolower($key)] = $key;
        }

        // Sort longest first to prevent partial overlaps (e.g. "quick" vs "quick task")
        uksort($presetLookup, fn(string $a, string $b): int => strlen($b) - strlen($a));
        $this->presetLookup = $presetLookup;

        // Build single master regex for blazing fast O(1) preset matching
        $parts = [];
        foreach ($this->presetLookup as $lowerKey => $_) {
            $escaped  = preg_quote($lowerKey, '/');
            $parts[]  = str_replace(' ', '\s+', $escaped);
        }
        $this->presetMasterPattern = '/^(' . implode('|', $parts) . ')\b/iu';

        $this->flagPatterns = self::buildFlagPatterns();
        
        $this->durationPatterns = [
            '/\b(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?/i' => fn(array $m): int => (int)$m[1] * 60 + (int)$m[2],
            '/\b(\d+)\s*h(?:ours?)?\s*(\d+)/i'                      => fn(array $m): int => (int)$m[1] * 60 + (int)$m[2],
            '/\b(\d+)\s*h(?:ours?)?/i'                              => fn(array $m): int => (int)$m[1] * 60,
            '/\b(\d+)\s*m(?:in(?:utes?)?)?/i'                       => fn(array $m): int => (int)$m[1],
        ];
    }

    // ─── Public API ───────────────────────────────────────────────────────

    public static function parse(string $input): PlanResult
    {
        return (new self())->parseString($input);
    }

    public function parseString(string $input): PlanResult
    {
        $input = self::stripEmojis($input);
        $input = trim($input);

        if ($input === '') {
            return new PlanResult();
        }

        // ── Phase 1: Extract --flag values ──
        $flags = $this->extractFlags($input);

        // ── Phase 2: Match preset keyword ──
        $presetMatch = $this->matchPreset($flags->remaining);
        $preset      = $presetMatch['preset'] ?? null;
        $afterPreset = $presetMatch['remaining'] ?? $flags->remaining;

        // ── Phase 3: Extract duration ──
        $durationResult  = $this->extractDuration($afterPreset);
        $durationMinutes = $durationResult['minutes'] ?? null;
        $afterDuration   = $durationResult['remaining'] ?? $afterPreset;

        // ── Phase 4: Leftover text → custom title ──
        $rawTitle      = trim(self::stripEmojis($afterDuration));
        $fallbackTitle = $preset?->title ?? 'Planned session';
        $finalTitle    = $rawTitle !== '' ? $rawTitle : $fallbackTitle;

        // ── Merge: explicit flags take precedence over preset defaults ──
        $goal        = $flags->goal     !== '' ? $flags->goal     : ($preset?->goal ?? '');
        $musicPreset = $flags->music    !== '' ? $flags->music    : ($preset?->musicPreset ?? null);
        $genre       = $flags->genre    !== '' ? $flags->genre    : ($preset?->genre ?? null);
        $playlistId  = $flags->playlist !== '' ? $flags->playlist : null;
        $musicSource = $flags->source   !== '' ? $flags->source   : null;

        return new PlanResult(
            title:            $finalTitle,
            goal:             $goal,
            durationMinutes:  self::clamp(
                $durationMinutes ?? ($preset?->duration ?? self::DEFAULT_DURATION),
                self::MIN_DURATION,
                self::MAX_DURATION,
            ),
            usedPreset:       $presetMatch['key'] ?? null,
            chunkSizeMinutes: self::clamp(
                $flags->chunk ?? self::DEFAULT_CHUNK,
                self::MIN_CHUNK,
                self::MAX_CHUNK,
            ),
            breakMinutes: self::clamp(
                $flags->break ?? self::DEFAULT_BREAK,
                self::MIN_BREAK,
                self::MAX_BREAK,
            ),
            tags:             $flags->tags,
            musicPreset:      self::nullableString($musicPreset),
            playlistId:       self::nullableString($playlistId),
            musicSource:      self::nullableString($musicSource),
            genre:            self::nullableString($genre),
        );
    }

    /** @return array<string, PresetDefinition> */
    public function getPresets(): array
    {
        return $this->presets;
    }

    // ─── Pattern construction ────────────────────────────────────────────

    private static function buildFlagPatterns(): array
    {
        $sep = self::FLAG_SEP;
        $qb  = self::QUOTED_OR_BARE;

        return [
            'goal'     => "/--goal{$sep}{$qb}/i",
            'chunk'    => "/--chunk{$sep}(\d+)/i",
            'break'    => "/--break{$sep}(\d+)/i",
            'tags'     => "/--tags{$sep}{$qb}/i",
            'music'    => "/--music{$sep}{$qb}/i",
            'playlist' => "/--playlist{$sep}{$qb}/i",
            'source'   => "/--source{$sep}{$qb}/i",
            'genre'    => "/--genre{$sep}{$qb}/i",
        ];
    }

    // ─── Phase implementations ────────────────────────────────────────────

    private static function stripEmojis(string $value): string
    {
        if ($value === '') {
            return '';
        }

        static $regex = null;
        if ($regex === null) {
            $regex = '/['
                . '\x{1F000}-\x{1FFFF}'
                . '\x{2600}-\x{26FF}'
                . '\x{2700}-\x{27BF}'
                . '\x{FE00}-\x{FE0F}'
                . '\x{1F1E0}-\x{1F1FF}'
                . '\x{1F3FB}-\x{1F3FF}'
                . '\x{E0020}-\x{E007F}'
                . '\x{200D}'
                . '\x{20E3}'
                . ']/u';
        }

        $cleaned = preg_replace($regex, '', $value);
        if ($cleaned === null) {
            return $value;
        }

        $cleaned = preg_replace('/\s{2,}/u', ' ', $cleaned);
        return trim($cleaned ?? $value);
    }

    private function extractFlags(string $input): ParsedFlags
    {
        $goal = $chunk = $break = null;
        $tags = $music = $playlist = $source = $genre = '';
        $remaining = $input;

        foreach ($this->flagPatterns as $name => $pattern) {
            if (!preg_match($pattern, $remaining, $m)) {
                continue;
            }

            $value = match ($name) {
                'chunk', 'break' => (int)$m[1],
                'tags' => array_values(array_filter(array_map(
                    fn(string $t): string => self::stripEmojis(trim($t)),
                    explode(',', self::extractQuotedOrBare($m))
                ))),
                'source' => in_array(
                    $src = mb_strtolower(self::stripEmojis(self::extractQuotedOrBare($m))),
                    self::ALLOWED_SOURCES,
                    true
                ) ? $src : '',
                default => self::stripEmojis(self::extractQuotedOrBare($m)),
            };

            match ($name) {
                'goal'     => $goal = $value,
                'chunk'    => $chunk = $value,
                'break'    => $break = $value,
                'tags'     => $tags = $value,
                'music'    => $music = $value,
                'playlist' => $playlist = $value,
                'source'   => $source = $value,
                'genre'    => $genre = $value,
                default    => null, // no-op
            };

            $remaining = preg_replace($pattern, '', $remaining, 1);
        }

        $remaining = trim(preg_replace('/\s{2,}/', ' ', $remaining) ?? $input);

        return new ParsedFlags(
            goal:      $goal ?? '',
            chunk:     $chunk,
            break:     $break,
            tags:      $tags,
            music:     $music,
            playlist:  $playlist,
            source:    $source,
            genre:     $genre,
            remaining: $remaining,
        );
    }

    /** @return array{key: string, preset: PresetDefinition, remaining: string}|null */
    private function matchPreset(string $input): ?array
    {
        if (preg_match($this->presetMasterPattern, $input, $m)) {
            // Normalize matched string (handles flexible spaces) to find the original key
            $matchedLower = mb_strtolower(preg_replace('/\s+/', ' ', $m[1]));
            $originalKey  = $this->presetLookup[$matchedLower] ?? null;
            
            if ($originalKey !== null) {
                return [
                    'key'       => $originalKey,
                    'preset'    => $this->presets[$originalKey],
                    'remaining' => trim(mb_substr($input, mb_strlen($m[0]))),
                ];
            }
        }

        return null;
    }

    /** @return array{minutes: int, remaining: string}|null */
    private function extractDuration(string $input): ?array
    {
        foreach ($this->durationPatterns as $pattern => $calc) {
            if (!preg_match($pattern, $input, $m)) {
                continue;
            }

            $minutes = $calc($m);
            if ($minutes <= 0) {
                continue;
            }

            return [
                'minutes'   => $minutes,
                'remaining' => trim(preg_replace($pattern, '', $input, 1)),
            ];
        }

        // Leading bare number + text: "45 study" → 45 min, title "study"
        if (preg_match('/^(\d+)\s+/', $input, $m)) {
            $value = (int)$m[1];
            if ($value >= self::MIN_DURATION && $value <= self::MAX_DURATION) {
                return [
                    'minutes'   => $value,
                    'remaining' => trim(mb_substr($input, mb_strlen($m[0]))),
                ];
            }
        }

        // Entire input is a bare number in valid range
        $trimmed = trim($input);
        if (ctype_digit($trimmed)) {
            $value = (int)$trimmed;
            if ($value >= self::MIN_DURATION && $value <= self::MAX_DURATION) {
                return ['minutes' => $value, 'remaining' => ''];
            }
        }

        return null;
    }

    // ─── Utility helpers ──────────────────────────────────────────────────

    private static function extractQuotedOrBare(array $matches, int $startGroup = 1): string
    {
        for ($i = 0; $i < 3; $i++) {
            $val = $matches[$startGroup + $i] ?? '';
            if ($val !== '') {
                return trim($val);
            }
        }
        return '';
    }

    private static function clamp(int $value, int $min, int $max): int
    {
        return max($min, min($max, $value));
    }

    private static function nullableString(?string $value): ?string
    {
        return $value !== null && $value !== '' ? $value : null;
    }
}