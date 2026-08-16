# frozen_string_literal: true

require 'time'
require 'securerandom'

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

      # Generates VEVENT entries for all schedulable (non-break) tasks
      def build_events(plan)
        base_time = parse_time(plan[:created_at])
        return [] unless base_time

        dtstamp = format_utc(Time.now.utc)
        elapsed = 0

        Array(plan[:tasks]).flat_map do |task|
          next [] unless schedulable?(task)

          duration   = task[:duration_minutes].to_i
          start_time = base_time + elapsed
          elapsed   += duration * 60
          build_event(task, start_time, duration, dtstamp)
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

        bytes   = line.b
        total   = bytes.bytesize
        chunks  = []
        offset  = 0
        leading = true

        while offset < total
          limit  = leading ? MAX_LINE : CONTINUATION_LIMIT
          size   = utf8_safe_slice_size(bytes, offset, limit)
          raw    = bytes.byteslice(offset, size)
          prefix = leading ? '' : CONTINUATION_PREFIX
          chunks << "#{prefix}#{raw}".force_encoding(Encoding::UTF_8)
          offset += size
          leading = false
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
        (Time.parse(string) rescue nil)&.utc
      end

      # UTC date-time with trailing Z (RFC 5545 §3.3.5 Form 2)
      def format_utc(time)
        time.utc.strftime(UTC_TIMESTAMP_FORMAT)
      end
    end
  end
end