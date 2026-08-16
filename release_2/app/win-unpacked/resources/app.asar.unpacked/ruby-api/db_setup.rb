# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'securerandom'
require 'date'
require 'forwardable'
require 'set'

# Lightweight persistence for focus-session + blocked-attempt stats.
#
# Picks SQLite when the +sqlite3+ gem is loadable; otherwise falls back
# to a JSON file. Both backends implement the same public interface.
class StatsDatabase
  SECONDS_PER_DAY  = 86_400
  ONE_WEEK         = SECONDS_PER_DAY * 7
  MINUTES_PER_HOUR = 60.0

  DB_FILE       = File.expand_path('helpy_stats.db',   __dir__).freeze
  JSON_FALLBACK = File.expand_path('helpy_stats.json', __dir__).freeze

  DEFAULT_SESSION_TITLE  = 'Focus Session'
  DEFAULT_EVENT_TYPE     = 'complete'
  DEFAULT_BLOCK_CATEGORY = 'social_media'

  SQLITE_AVAILABLE =
    begin
      require 'sqlite3'
      true
    rescue LoadError
      warn '[StatsDatabase] sqlite3 not available — using JSON fallback'
      false
    end

  extend Forwardable

  def initialize(db_path: DB_FILE, json_path: JSON_FALLBACK)
    @backend = SQLITE_AVAILABLE ? SqliteBackend.new(db_path) : JsonBackend.new(json_path)
  end

  # Records a completed (or aborted) focus session.
  # @return [String] The session ID that was persisted.
  def log_session(id: nil, title: nil, duration_minutes:, event_type: DEFAULT_EVENT_TYPE)
    id ||= SecureRandom.uuid
    @backend.log_session(
      id:               id,
      title:            title || DEFAULT_SESSION_TITLE,
      duration_minutes: duration_minutes.to_i,
      event_type:       event_type
    )
    id
  end

  # Records a blocked distraction attempt.
  # @return [String] The attempt ID that was persisted.
  def log_blocked_attempt(target:, category: DEFAULT_BLOCK_CATEGORY, id: nil)
    id ||= SecureRandom.uuid
    @backend.log_blocked_attempt(id: id, target: target, category: category)
    id
  end

  def_delegators :@backend,
                 :weekly_hours,
                 :current_streak,
                 :blocked_attempts_count,
                 :close,
                 :closed?

  # Backwards-compatible alias.
  alias streaks current_streak

  # ------------------------------------------------------------------
  # Shared helpers mixed into both backends.
  # ------------------------------------------------------------------
  module Backend
    private

    def now_iso
      Time.now.utc.iso8601
    end

    def cutoff_iso(seconds_ago)
      (Time.now - seconds_ago).utc.iso8601
    end

    def hours_from_minutes(minutes)
      (minutes / MINUTES_PER_HOUR).round(2)
    end
  end

  # ------------------------------------------------------------------
  # SQLite backend
  # ------------------------------------------------------------------
  class SqliteBackend
    include Backend

    SCHEMA_SQL = <<~SQL
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id               TEXT PRIMARY KEY,
        title            TEXT,
        duration_minutes INTEGER,
        event_type       TEXT,
        created_at       TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blocked_attempts (
        id         TEXT PRIMARY KEY,
        target     TEXT,
        category   TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_created ON focus_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_blocked_created  ON blocked_attempts(created_at);
    SQL

    BUSY_TIMEOUT_MS = 5_000
    private_constant :SCHEMA_SQL, :BUSY_TIMEOUT_MS

    def initialize(path)
      @db = SQLite3::Database.new(path)
      @db.results_as_hash = true
      @db.busy_timeout    = BUSY_TIMEOUT_MS
      setup!
    end

    def log_session(id:, title:, duration_minutes:, event_type:)
      @db.execute(
        'INSERT INTO focus_sessions (id, title, duration_minutes, event_type, created_at) ' \
        'VALUES (?, ?, ?, ?, ?)',
        [id, title, duration_minutes, event_type, now_iso]
      )
    end

    def log_blocked_attempt(id:, target:, category:)
      @db.execute(
        'INSERT INTO blocked_attempts (id, target, category, created_at) ' \
        'VALUES (?, ?, ?, ?)',
        [id, target, category, now_iso]
      )
    end

    def weekly_hours
      row = @db.get_first_row(
        'SELECT COALESCE(SUM(duration_minutes), 0) AS total ' \
        'FROM focus_sessions WHERE created_at >= ?',
        [cutoff_iso(ONE_WEEK)]
      )
      hours_from_minutes(row.fetch('total', 0).to_i)
    end

    def current_streak
      dates = @db.execute(
        'SELECT DISTINCT DATE(created_at) AS d FROM focus_sessions ORDER BY d DESC'
      ).map { |r| r['d'] }
      StatsDatabase.compute_streak(dates)
    end

    def blocked_attempts_count
      @db.get_first_value('SELECT COUNT(*) FROM blocked_attempts').to_i
    end

    def close
      @db&.close
      @db = nil
    end

    def closed?
      @db.nil?
    end

    private

    def setup!
      @db.execute_batch(SCHEMA_SQL)
    end
  end

  # ------------------------------------------------------------------
  # JSON file backend (used when sqlite3 is unavailable)
  # ------------------------------------------------------------------
  class JsonBackend
    include Backend

    def initialize(path)
      @path      = path
      @lock_path = "#{path}.lock"
      @mutex     = Mutex.new
      FileUtils.mkdir_p(File.dirname(@path))
      write_atomic(fresh_data) unless File.exist?(@path)
    end

    def log_session(id:, title:, duration_minutes:, event_type:)
      mutate do |data|
        data[:sessions] << {
          id:               id,
          title:            title,
          duration_minutes: duration_minutes,
          event_type:       event_type,
          created_at:       now_iso
        }
      end
    end

    def log_blocked_attempt(id:, target:, category:)
      mutate do |data|
        data[:blocked_attempts] << {
          id:         id,
          target:     target,
          category:   category,
          created_at: now_iso
        }
      end
    end

    def weekly_hours
      since = cutoff_iso(ONE_WEEK)
      mins  = read[:sessions]
                .select { |s| s[:created_at].to_s >= since }
                .sum    { |s| s[:duration_minutes].to_i }
      hours_from_minutes(mins)
    end

    def current_streak
      dates = read[:sessions].map { |s| s[:created_at].to_s[0, 10] }
      StatsDatabase.compute_streak(dates)
    end

    def blocked_attempts_count
      read[:blocked_attempts].size
    end

    def close; end
    def closed? = false

    private

    def fresh_data
      { sessions: [], blocked_attempts: [] }
    end

    def read
      return fresh_data unless File.exist?(@path)

      parsed = JSON.parse(File.read(@path, encoding: Encoding::UTF_8), symbolize_names: true)
      return fresh_data unless parsed.is_a?(Hash)

      {
        sessions:         Array(parsed[:sessions]),
        blocked_attempts: Array(parsed[:blocked_attempts])
      }
    rescue JSON::ParserError, Errno::ENOENT
      fresh_data
    end

    def mutate
      @mutex.synchronize do
        with_lock do
          data = read
          yield data
          write_atomic(data)
        end
      end
    end

    def with_lock
      File.open(@lock_path, File::RDWR | File::CREAT) do |lock|
        lock.flock(File::LOCK_EX)
        yield
      end
    end

    def write_atomic(data)
      tmp = "#{@path}.tmp.#{SecureRandom.hex(8)}"
      File.open(tmp, 'w', encoding: Encoding::UTF_8) do |f|
        f.write(JSON.generate(data))
        f.fsync
      end
      File.rename(tmp, @path)
    rescue StandardError
      FileUtils.rm_f(tmp)
      raise
    end
  end

  # ------------------------------------------------------------------
  # Shared streak logic
  # ------------------------------------------------------------------
  # Counts the unbroken run of consecutive days ending today (or yesterday
  # if today has no session yet). Uses UTC dates to stay consistent with
  # the +created_at+ timestamps stored by the backends.
  def self.compute_streak(dates)
    set = dates.filter_map { |d| parse_date(d) }.to_set
    return 0 if set.empty?

    cursor = Time.now.utc.to_date
    cursor -= 1 unless set.include?(cursor)

    streak = 0
    while set.include?(cursor)
      streak += 1
      cursor  -= 1
    end
    streak
  end

  def self.parse_date(s)
    Date.parse(s.to_s)
  rescue ArgumentError, TypeError
    nil
  end

  private_constant :DEFAULT_SESSION_TITLE,
                   :DEFAULT_EVENT_TYPE,
                   :DEFAULT_BLOCK_CATEGORY,
                   :SQLITE_AVAILABLE,
                   :MINUTES_PER_HOUR,
                   :SqliteBackend,
                   :JsonBackend,
                   :Backend
  private_class_method :parse_date
end