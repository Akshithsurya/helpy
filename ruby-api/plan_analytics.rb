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
                     :UTC_STAMP_FORMAT, :ZONED_STAMP_FORMAT,
                     :CONTINUATION_PREFIX

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
          'CALSCALE:GREGORIAN',
          *build_events(plan),
          'END:VCALENDAR'
        ]
      end

      # Generates VEVENT entries for all non-break tasks in the plan.
      def build_events(plan)
        base_time = parse_time(plan[:created_at])
        return [] unless base_time

        dtstamp = stamp(Time.now.utc)
        elapsed = 0

        Array(plan[:tasks])
          .select { |t| t.is_a?(Hash) && !t[:is_break] && valid_task?(t) }
          .flat_map do |task|
            duration = task[:duration_minutes].to_i
            event    = build_event(task, base_time + elapsed, duration, dtstamp)
            elapsed += duration * 60
            event
          end
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
          "DTSTAMP:#{dtstamp}",
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

      # RFC 5545 §3.1 line folding, preserving UTF-8 character boundaries.
      def fold_lines(lines)
        lines.flat_map { |line| fold_line(line) }
      end

      def fold_line(line)
        return [line] if line.bytesize <= MAX_LINE

        chunks  = []
        current = +''

        line.each_char do |char|
          if !current.empty? && current.bytesize + char.bytesize > MAX_LINE
            chunks << current
            current = +CONTINUATION_PREFIX
          end
          current << char
        end

        chunks << current
      end

      # Robust time parser handling Time, Numeric, and string inputs.
      def parse_time(value)
        return nil unless value

        case value
        when Time    then value.utc
        when Numeric then Time.at(value.to_f).utc
        else
          string = value.to_s
          safe_parse { Time.iso8601(string) } || safe_parse { Time.parse(string) }
        end
      end

      def safe_parse
        yield.utc
      rescue ArgumentError
        nil
      end

      # UTC date-time with trailing Z (RFC 5545 §3.3.5 Form 1)
      def stamp(time)
        time.utc.strftime(UTC_STAMP_FORMAT)
      end

      # Zoned date-time (no trailing Z) used alongside TZID (Form 2)
      def stamp_zoned(time)
        time.utc.strftime(ZONED_STAMP_FORMAT)
      end
    end
  end
end