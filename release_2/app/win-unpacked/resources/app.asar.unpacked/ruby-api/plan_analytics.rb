# frozen_string_literal: true

require 'time'
require 'securerandom'

module PlanService
  module Ical
    CRLF       = "\r\n"
    PRODID     = '-//Helpy PlanService//EN'
    UID_DOMAIN = 'helpy.io'
    MAX_LINE   = 75 # RFC 5545 §3.1

    # Continuation lines start with a single space (RFC 5545 §3.1)
    CONTINUATION_PREFIX = ' '
    CONTINUATION_LIMIT  = MAX_LINE - CONTINUATION_PREFIX.bytesize

    # Date-time format strings (RFC 5545 §3.3.5)
    UTC_STAMP_FORMAT   = '%Y%m%dT%H%M%SZ'
    ZONED_STAMP_FORMAT = '%Y%m%dT%H%M%S'

    # RFC 5545 §3.3.11 text escaping
    ESCAPE_TABLE = {
      '\\'   => '\\\\',
      ';'    => '\;',
      ','    => '\,',
      "\r\n" => '\n',
      "\r"   => '\n',
      "\n"   => '\n'
    }.freeze
    ESCAPE_REGEX = /[\\;,]|\r\n|\r|\n/.freeze
    private_constant :ESCAPE_TABLE, :ESCAPE_REGEX,
                     :UTC_STAMP_FORMAT, :ZONED_STAMP_FORMAT

    # Exports a plan to a fully RFC 5545 compliant iCalendar string.
    # @param plan [Hash] Plan data with :created_at and :tasks array
    # @return [String] Valid iCalendar content with proper line folding
    def self.export(plan)
      fold_lines(build_calendar(plan)).join(CRLF) << CRLF
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

      # Generates VEVENT entries for all non-break tasks in the plan
      def build_events(plan)
        base_time = parse_time(plan[:created_at])
        return [] unless base_time

        dtstamp = stamp(Time.now.utc)
        elapsed = 0
        events  = []

        Array(plan[:tasks]).each do |task|
          next unless task.is_a?(Hash)
          next if task[:is_break]
          next unless valid_task?(task)

          duration   = task[:duration_minutes].to_i
          start_time = base_time + elapsed
          elapsed   += duration * 60

          events.concat(build_event(task, start_time, duration, dtstamp))
        end

        events
      end

      def valid_task?(task)
        task[:id] &&
          !task[:title].to_s.empty? &&
          task[:duration_minutes].to_i.positive?
      end

      def build_event(task, start_time, duration, dtstamp)
        [
          'BEGIN:VEVENT',
          "UID:#{generate_uid(task[:id])}",
          "DTSTART;TZID=UTC:#{stamp_zoned(start_time)}",
          "DTSTAMP:#{dtstamp}", # RFC 5545 §3.6.1 (MUST)
          "DURATION:PT#{duration}M",
          "SUMMARY:#{escape_text(task[:title])}",
          'END:VEVENT'
        ]
      end

      # RFC 5545 §3.8.4.7 - globally unique UID
      def generate_uid(task_id)
        "#{SecureRandom.uuid}-#{task_id}@#{UID_DOMAIN}"
      end

      def escape_text(value)
        value.to_s.gsub(ESCAPE_REGEX, ESCAPE_TABLE)
      end

      # RFC 5545 §3.1 line folding, preserving UTF-8 character boundaries
      def fold_lines(lines)
        lines.flat_map(&method(:fold_single_line))
      end

      def fold_single_line(line)
        return [line] if line.bytesize <= MAX_LINE

        bytes  = line.b
        total  = bytes.bytesize
        chunks = []
        offset = 0

        while offset < total
          limit  = chunks.empty? ? MAX_LINE : CONTINUATION_LIMIT
          slice  = utf8_safe_slice_size(bytes, offset, limit)
          chunk  = bytes.byteslice(offset, slice)
          chunk  = "#{CONTINUATION_PREFIX}#{chunk}" if chunks.any?
          chunks << chunk.force_encoding(Encoding::UTF_8)
          offset += slice
        end

        chunks
      end

      # Backs off the slice limit to avoid splitting multi-byte UTF-8 chars
      def utf8_safe_slice_size(bytes, offset, limit)
        while limit.positive? &&
              offset + limit < bytes.bytesize &&
              (bytes.getbyte(offset + limit) & 0xC0) == 0x80
          limit -= 1
        end
        limit
      end

      # Robust time parser handling Time, Numeric, and string inputs
      def parse_time(value)
        return nil unless value
        return value.utc if value.is_a?(Time)
        return Time.at(value.to_f).utc if value.is_a?(Numeric)

        parse_string_time(value.to_s)
      end

      def parse_string_time(string)
        try_parse { Time.iso8601(string) } || try_parse { Time.parse(string) }
      end

      def try_parse
        yield.utc
      rescue ArgumentError
        nil
      end

      # Form 1: UTC date-time with trailing Z (used for DTSTAMP)
      def stamp(time)
        time.utc.strftime(UTC_STAMP_FORMAT)
      end

      # Form 2: zoned date-time (no trailing Z) used alongside TZID
      def stamp_zoned(time)
        time.utc.strftime(ZONED_STAMP_FORMAT)
      end
    end
  end
end