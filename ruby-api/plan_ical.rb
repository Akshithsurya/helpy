# frozen_string_literal: true

require 'time'
require 'securerandom'
require 'logger'
require 'set'

module PlanService
  module Ical
    CRLF       = "\r\n"
    PRODID     = '-//Helpy PlanService//EN'
    UID_DOMAIN = 'helpy.io'
    MAX_LINE   = 75 # RFC 5545 §3.1 (octets)

    # Continuation lines start with a single space (RFC 5545 §3.1)
    CONTINUATION_PREFIX = ' '
    CONTINUATION_LIMIT  = MAX_LINE - CONTINUATION_PREFIX.bytesize

    # RFC 5545 §3.3.11 text escaping
    # (CRLF must be matched before bare CR or LF)
    ESCAPE_TABLE = {
      '\\'   => '\\\\',
      ';'    => '\;',
      ','    => '\,',
      "\r\n" => '\n',
      "\r"   => '\n',
      "\n"   => '\n'
    }.freeze
    ESCAPE_REGEX = /[\\;,]|\r\n|\r|\n/.freeze
    private_constant :ESCAPE_TABLE, :ESCAPE_REGEX

    # RFC 5545 §3.3.5 Form 2: UTC date-time with trailing Z
    UTC_TIMESTAMP_FORMAT = '%Y%m%dT%H%M%SZ'
    private_constant :UTC_TIMESTAMP_FORMAT

    # Required iCalendar properties to ensure compliance
    REQUIRED_CALENDAR_PROPERTIES = %w[VERSION PRODID CALSCALE].to_set.freeze
    private_constant :REQUIRED_CALENDAR_PROPERTIES

    # Logger for error tracking and debugging
    LOGGER = Logger.new($stdout)
    private_constant :LOGGER

    # Exports a plan to a fully RFC 5545 compliant iCalendar string.
    # @param plan [Hash] Plan data with :created_at and :tasks array
    # @return [String] Valid iCalendar content with proper line folding
    def self.export(plan)
      unless plan.is_a?(Hash)
        LOGGER.error("Invalid plan type: expected Hash, got #{plan.class}")
        return empty_calendar
      end

      lines = build_calendar(plan)
      validate_calendar_structure(lines)
      fold_lines(lines).join(CRLF) << CRLF
    rescue StandardError => e
      LOGGER.error("Failed to export calendar: #{e.message}\n#{e.backtrace.join("\n")}")
      empty_calendar
    end

    # Returns a minimal valid empty calendar for error cases
    def self.empty_calendar
      ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:#{PRODID}", "CALSCALE:GREGORIAN", "END:VCALENDAR"].join(CRLF) << CRLF
    end

    class << self
      private

      def build_calendar(plan)
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          "PRODID:#{PRODID}",
          'CALSCALE:GREGORIAN', # Avoid ambiguous date handling
          *build_events(plan),
          'END:VCALENDAR'
        ]
      end

      # Validates core calendar structure meets RFC 5545 requirements
      def validate_calendar_structure(lines)
        present_properties = lines.filter_map { |l| l.split(':', 2).first if l.start_with?('VERSION:', 'PRODID:', 'CALSCALE:') }.to_set
        missing = REQUIRED_CALENDAR_PROPERTIES - present_properties
        raise "Invalid calendar structure: missing #{missing.join(', ')}" unless missing.empty?
        raise "Unclosed VEVENT components detected" if lines.count('BEGIN:VEVENT') != lines.count('END:VEVENT')
      end

      # Generates VEVENT entries for all schedulable (non-break) tasks
      def build_events(plan)
        base_time = parse_time(plan[:created_at])
        unless base_time
          LOGGER.warn("Invalid or missing created_at timestamp in plan")
          return []
        end

        dtstamp = format_utc(Time.now)
        elapsed = 0

        Array(plan[:tasks]).filter_map do |task|
          next unless schedulable?(task)

          duration   = task[:duration_minutes].to_i
          start_time = base_time + elapsed
          elapsed   += duration * 60
          build_event(task, start_time, duration, dtstamp)
        rescue StandardError => e
          LOGGER.warn("Failed to process task #{task&.dig(:id)}: #{e.message}")
          nil
        end
      end

      # A task produces an event when it is a Hash, is not a break,
      # and has an id, a non-empty title, and a positive duration.
      def schedulable?(task)
        task.is_a?(Hash) &&
          !task[:is_break] &&
          task[:id] &&
          !task[:title].to_s.empty? &&
          task[:duration_minutes].to_i.positive?
      end

      def build_event(task, start_time, duration, dtstamp)
        [
          'BEGIN:VEVENT',
          "UID:#{generate_uid(task[:id])}",
          "DTSTART:#{format_utc(start_time)}", # RFC 5545 §3.3.5 (UTC, Form 2)
          "DTSTAMP:#{dtstamp}",                # RFC 5545 §3.6.1 (MUST)
          "DURATION:PT#{duration}M",
          "SUMMARY:#{escape_text(task[:title])}",
          'END:VEVENT'
        ]
      end

      # RFC 5545 §3.8.4.7 — globally unique UID
      def generate_uid(task_id)
        "#{SecureRandom.uuid}-#{task_id}@#{UID_DOMAIN}"
      end

      def escape_text(value)
        value.to_s.gsub(ESCAPE_REGEX, ESCAPE_TABLE)
      end

      # RFC 5545 §3.1 line folding, preserving UTF-8 character boundaries
      def fold_lines(lines)
        lines.flat_map { |line| fold_single_line(line) }
      end

      def fold_single_line(line)
        return [line] if line.bytesize <= MAX_LINE

        bytes = line.b
        total = bytes.bytesize
        chunks = []
        offset = 0

        # First chunk (no continuation prefix)
        size = utf8_safe_slice_size(bytes, offset, MAX_LINE)
        chunks << bytes.byteslice(offset, size).force_encoding(Encoding::UTF_8)
        offset += size

        # Subsequent chunks (prefixed with a single space)
        while offset < total
          size = utf8_safe_slice_size(bytes, offset, CONTINUATION_LIMIT)
          raw = bytes.byteslice(offset, size)
          chunks << "#{CONTINUATION_PREFIX}#{raw}".force_encoding(Encoding::UTF_8)
          offset += size
        end

        chunks
      end

      # Largest slice size <= `limit` that does not split a multi-byte
      # UTF-8 character at the boundary (offset + size).
      # Guarantees at least 1 byte of progress to avoid infinite loops.
      def utf8_safe_slice_size(bytes, offset, limit)
        remaining = bytes.bytesize - offset
        return [limit, remaining].min if limit >= remaining

        size = limit
        # Step back if the byte at the boundary is a UTF-8 continuation byte (10xxxxxx)
        size -= 1 while size > 1 && (bytes.getbyte(offset + size) & 0xC0) == 0x80
        size
      end

      # Parses Time, Numeric (epoch), or ISO 8601 / free-form strings.
      def parse_time(value)
        case value
        when nil     then nil
        when Time    then value.utc
        when Numeric then Time.at(value.to_f).utc
        else              parse_string_time(value.to_s)
        end
      end

      def parse_string_time(string)
        Time.iso8601(string).utc
      rescue ArgumentError
        Time.parse(string).utc
      rescue ArgumentError
        nil
      end

      # UTC date-time with trailing Z (RFC 5545 §3.3.5 Form 2)
      def format_utc(time)
        time.utc.strftime(UTC_TIMESTAMP_FORMAT)
      end
    end
  end
end