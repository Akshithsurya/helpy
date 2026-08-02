# frozen_string_literal: true

require 'time'
require 'securerandom'
require 'shellwords'
require 'csv'
require 'json'
require_relative 'plan_analytics'
require_relative 'plan_ical'

module PlanService
  # ===========================================================================
  # Errors
  # ===========================================================================

  class Error < StandardError
    attr_reader :code, :http_status

    def initialize(message, code: 'PLAN_ERROR', http_status: 400)
      super(message)
      @code        = code
      @http_status = http_status
    end

    def to_h = { code:, message:, http_status: }
    alias_method :as_json, :to_h
    def to_json(*_args) = to_h.to_json
  end

  # ===========================================================================
  # Value objects
  # ===========================================================================

  PlanSpec = Struct.new(
    :title, :goal, :duration_minutes,
    :chunk_size_minutes, :break_minutes,
    :tags, :used_preset,
    keyword_init: true
  ) do
    DEFAULTS = { tags: [], used_preset: nil }.freeze
    private_constant :DEFAULTS

    def self.build(**overrides) = new(**DEFAULTS.merge(overrides))
    def with(overrides)         = self.class.new(**to_h.merge(overrides))
  end
  private_constant :PlanSpec

  # ===========================================================================
  # Defaults & presets
  # ===========================================================================

  DEFAULT_PRESETS = {
    'work'  => { title: 'Work Session',   duration_minutes: 60, goal: 'Focus on work tasks' },
    'study' => { title: 'Study Session',  duration_minutes: 45, goal: 'Focus on studying' },
    'focus' => { title: 'Deep Focus',     duration_minutes: 25, goal: 'Deep focus session' },
    'code'  => { title: 'Coding Session', duration_minutes: 90, goal: 'Write code and solve problems' }
  }.transform_values(&:freeze).freeze

  MIN_PLAN_DURATION     = 5
  MAX_PLAN_DURATION     = 240
  DEFAULT_PLAN_DURATION = 30
  DEFAULT_CHUNK_SIZE    = 15
  DEFAULT_BREAK_MINUTES = 5
  MIN_CHUNK_OR_BREAK    = 1

  DEFAULT_TITLE  = 'Planned session'
  DEFAULT_SOURCE = 'ruby-api'
  DEFAULT_STATUS = 'pending'

  MAX_HISTORY_ENTRIES = 1_000

  # Longest preset names first so "study" never shadows a hypothetical "study session".
  PRESET_NAMES = DEFAULT_PRESETS.keys.sort_by { |k| -k.length }.freeze

  TASK_DESCRIPTORS = ['Start strong', 'Keep going', 'Making progress', 'Almost there', 'Final push'].freeze

  SUBCOMMANDS = %w[suggest compare template batch analyze schedule share].freeze

  # Single unified pattern: "1h30", "1.5 hours", "90m", "90 min", "90", etc.
  DURATION_PATTERN = /
    \A
    (?:
      (?<hours>\d+(?:\.\d+)?)\s*h(?:ours?)?
      (?:\s*(?<mins>\d+)\s*(?:m(?:in(?:utes?)?)?)?)?
      |
      (?<mins>\d+(?:\.\d+)?)\s*(?:m(?:in(?:utes?)?)?)?
    )
  /xi.freeze
  private_constant :DURATION_PATTERN

  FLAG_DEFINITIONS = {
    title: { field: :title },
    goal:  { field: :goal },
    chunk: { field: :chunk_size_minutes, coerce: ->(v) { v.to_i } },
    break: { field: :break_minutes,      coerce: ->(v) { v.to_i } },
    tags:  { field: :tags, coerce: ->(v) { v.split(',').map(&:strip).reject(&:empty?) } }
  }.freeze
  private_constant :FLAG_DEFINITIONS

  OVERRIDE_FIELDS = %i[
    title goal duration_minutes chunk_size_minutes break_minutes tags used_preset
  ].freeze
  private_constant :OVERRIDE_FIELDS

  @templates = {}
  @history   = []

  # ===========================================================================
  # Public API
  # ===========================================================================

  class << self
    attr_accessor :templates, :history

    # Clear all stored templates and history entries.
    def reset!
      @templates.clear
      @history.clear
    end

    # Parse +command_string+ and dispatch to the matching subcommand.
    # Returns +{ status:, type:, data: }+ where +status+ is 'ok' or 'error'.
    def dispatch(command_string)
      tokens = tokenize(command_string)
      type   = resolve_command_type(tokens.first)

      { status: 'ok', type:, data: execute_command(type, tokens) }
    rescue Error => e
      { status: 'error', type: type || :error, data: e.to_h }
    end

    # Parse +args+ (a command string or token array) into a plan spec hash.
    def parse_plan(args)
      flags, positional = FlagParser.call(tokenize(args))

      PlanSpec
        .build
        .then { |spec| apply_flags(spec, flags) }
        .then { |spec| apply_positional(spec, positional) }
        .then { |spec| finalize_spec(spec) }
        .to_h
    end

    # Break +plan_hash+ into timed tasks, optionally interleaving breaks.
    def break_down_into_tasks(plan_hash, include_breaks: false)
      duration   = clamp_duration(plan_hash[:duration_minutes])
      chunk_size = clamp_chunk_or_break(plan_hash[:chunk_size_minutes])
      break_mins = clamp_chunk_or_break(plan_hash[:break_minutes])
      return [] unless duration.positive?

      seed = SecureRandom.hex(4)
      goal = plan_hash[:goal]

      each_chunk(duration, chunk_size, break_mins, include_breaks).map do |chunk, idx, is_break|
        build_task(
          seed:, idx:, duration: chunk, is_break:,
          label: is_break ? 'Break' : descriptor_for(idx),
          goal:  is_break ? nil     : goal
        )
      end
    end

    # Create a complete plan record with tasks and metadata.
    # +options+ may override any plan field and accepts +:include_breaks+.
    def create_plan(args, **options)
      parsed    = parse_plan(args)
      overrides = extract_overrides(parsed, options)
      tasks     = break_down_into_tasks(
        overrides,
        include_breaks: options.fetch(:include_breaks, false)
      )

      build_plan_record(overrides:, tasks:, options:).tap do |plan|
        record_history(plan)
      end
    end

    # ---- Analytics & Suggestions -----------------------------------------

    # Compute statistics from history and build contextual suggestions.
    def analyze_and_suggest(context = {})
      return Analytics.no_history_suggestions if @history.empty?

      basic    = Analytics.compute_basic_stats(@history)
      enhanced = Analytics.compute_enhanced_stats(@history)

      {
        total_plans:              basic[:total_plans],
        completed_plans:          basic[:completed_plans],
        completion_rate:          basic[:completion_rate],
        average_duration_minutes: basic[:average_duration_minutes],
        popular_tags:             basic[:popular_tags],
        suggestions:              Analytics.build_suggestions(basic, context),
        **enhanced
      }
    end

    # ---- Export -----------------------------------------------------------

    # Serialize +plan+ to +format+ (json, markdown, csv, or ical).
    def export_plan(plan, format = 'json')
      case format.to_s.downcase
      when 'json'     then JSON.pretty_generate(plan)
      when 'markdown' then Exporters::Markdown.call(plan)
      when 'csv'      then Exporters::CSV.call(plan)
      when 'ical'     then Ical.export(plan)
      else raise Error.new("Unsupported format: #{format}", code: 'UNSUPPORTED_FORMAT')
      end
    end

    # ---- Template management ---------------------------------------------

    # Persist +plan_spec+ under +template_name+. Returns the stored template.
    def save_template(template_name, plan_spec)
      name = template_name.to_s.strip
      raise Error.new('Template name cannot be empty', code: 'EMPTY_TEMPLATE_NAME') if name.empty?

      template = {
        id:         generate_id('template'),
        name:,
        plan_spec:  deep_freeze(deep_dup(plan_spec)),
        created_at: Time.now.utc.iso8601
      }

      @templates[name] = template
      { success: true, template: }
    end

    # Retrieve a mutable copy of the plan spec for +template_name+.
    def load_template(template_name)
      template = @templates[template_name.to_s]
      raise template_not_found_error(template_name) unless template

      deep_dup(template[:plan_spec])
    end

    # List saved templates (name and created_at only).
    def list_templates = @templates.values.map { |t| t.slice(:name, :created_at) }

    # Delete +template_name+. Returns +{ success: true }+ or raises.
    def delete_template(template_name)
      deleted = @templates.delete(template_name.to_s)
      raise template_not_found_error(template_name) unless deleted

      { success: true }
    end

    private

    # ---- Dispatch ---------------------------------------------------------

    def resolve_command_type(first_token)
      name = first_token.to_s
      SUBCOMMANDS.include?(name) ? name.to_sym : :legacy
    end

    def execute_command(type, tokens)
      rest = tokens.drop(1)

      case type
      when :legacy   then parse_plan(tokens)
      when :suggest  then analyze_and_suggest({})
      when :compare  then compare_stats
      when :template then handle_template_action(rest)
      when :batch    then { processed: 0 } # TODO: implement batch processing
      when :analyze  then analyze_and_suggest(time_of_day: Time.now.hour)
      when :schedule then create_plan(rest)
      when :share    then { format: 'link', content: parse_plan(rest) }
      end
    end

    def compare_stats
      Analytics
        .compute_basic_stats(@history)
        .slice(:total_plans, :completed_plans, :completion_rate)
    end

    def handle_template_action(tokens)
      action = tokens.first.to_s
      rest   = tokens.drop(1)

      case action
      when 'save'   then save_template(rest.first.to_s, parse_plan(rest.drop(1)))
      when 'load'   then { plan_spec: load_template(rest.first.to_s) }
      when 'list'   then { templates: list_templates }
      when 'delete' then delete_template(rest.first.to_s)
      else raise Error.new("Unknown template action: #{action}", code: 'UNKNOWN_TEMPLATE_ACTION')
      end
    end

    # ---- Overrides --------------------------------------------------------

    def extract_overrides(parsed, options)
      OVERRIDE_FIELDS.each_with_object({}) do |field, hash|
        value = options.fetch(field, parsed[field])
        hash[field] = field == :tags ? Array(value) : value
      end
    end

    # ---- Tokenizing -------------------------------------------------------

    def tokenize(args)
      return args if args.is_a?(Array)

      Shellwords.shellsplit(args.to_s.strip)
    rescue ArgumentError => e
      raise Error.new("Invalid command string: #{e.message}", code: 'PARSE_ERROR')
    end

    # ---- Flag application -------------------------------------------------

    def apply_flags(spec, flags)
      overrides = {}

      FLAG_DEFINITIONS.each do |flag, definition|
        value = flags[flag]
        next unless value.is_a?(String)

        overrides[definition[:field]] =
          definition[:coerce] ? definition[:coerce].call(value) : value
      end

      if (duration_str = flags[:duration]).is_a?(String)
        minutes = extract_duration(duration_str.strip)&.first
        overrides[:duration_minutes] = minutes if minutes
      end

      overrides.empty? ? spec : spec.with(overrides)
    end

    # ---- Duration parsing -------------------------------------------------

    # Returns [minutes, match_end_index] or nil.
    def extract_duration(str)
      s = str.to_s
      return nil if s.empty?

      m = s.match(DURATION_PATTERN) or return nil

      [(m[:hours].to_f * 60) + m[:mins].to_f, m.end(0)]
    end

    # ---- Positional parsing -----------------------------------------------

    def apply_positional(spec, positional)
      input = positional.join(' ')
      spec, input = apply_preset(spec, input)
      duration, title = split_leading_duration(input)

      spec.with(
        duration_minutes: duration || spec.duration_minutes,
        title:            title.empty? ? spec.title : title
      )
    end

    def apply_preset(spec, input)
      lower = input.downcase
      name  = PRESET_NAMES.find { |n| lower == n || lower.start_with?("#{n} ") }
      return [spec, input] unless name

      preset = DEFAULT_PRESETS[name]
      rest   = input[name.length..].strip

      spec = spec.with(
        title:            spec.title            || preset[:title],
        duration_minutes: spec.duration_minutes || preset[:duration_minutes],
        goal:             spec.goal             || preset[:goal],
        used_preset:      name
      )

      [spec, rest]
    end

    def split_leading_duration(input)
      case extract_duration(input)
      in [duration, end_idx]
        [duration, input[end_idx..].strip]
      else
        [nil, input]
      end
    end

    # ---- Finalization -----------------------------------------------------

    def finalize_spec(spec)
      spec.with(
        title:              spec.title              || DEFAULT_TITLE,
        goal:               spec.goal               || '',
        duration_minutes:   clamp_duration(spec.duration_minutes   || DEFAULT_PLAN_DURATION),
        chunk_size_minutes: spec.chunk_size_minutes || DEFAULT_CHUNK_SIZE,
        break_minutes:      spec.break_minutes      || DEFAULT_BREAK_MINUTES,
        tags:               Array(spec.tags)
      )
    end

    # ---- Clamping ---------------------------------------------------------

    def clamp_duration(value)
      v = value.to_f
      return DEFAULT_PLAN_DURATION unless v.finite?
      v.round.clamp(MIN_PLAN_DURATION, MAX_PLAN_DURATION)
    end

    def clamp_chunk_or_break(value) = [value.to_i, MIN_CHUNK_OR_BREAK].max

    # ---- Chunk enumeration -----------------------------------------------

    def each_chunk(duration, chunk_size, break_mins, include_breaks)
      return enum_for(:each_chunk, duration, chunk_size, break_mins, include_breaks) unless block_given?

      remaining = duration
      idx       = 0

      while remaining.positive?
        chunk = [chunk_size, remaining].min
        yield chunk, idx, false
        remaining -= chunk

        # Only insert a break when there's enough time left for actual
        # work afterwards — avoids a dangling break at the end.
        if include_breaks && remaining > break_mins
          yield break_mins, idx, true
          remaining -= break_mins
        end

        idx += 1
      end
    end

    # ---- Task building ----------------------------------------------------

    def descriptor_for(idx) = TASK_DESCRIPTORS[idx.clamp(0, TASK_DESCRIPTORS.length - 1)]

    def build_task(seed:, idx:, label:, goal:, duration:, is_break:)
      {
        id:               "task-#{seed}-#{idx}#{is_break ? '-break' : ''}",
        title:            task_title(label:, goal:, idx:, is_break:),
        duration_minutes: duration,
        completed:        false,
        completed_at:     nil,
        is_break:
      }
    end

    def task_title(label:, goal:, idx:, is_break:)
      if is_break
        label
      elsif goal && !goal.empty?
        "#{label}: #{goal}"
      else
        "#{label} - Part #{idx + 1}"
      end
    end

    # ---- Plan record building ---------------------------------------------

    def build_plan_record(overrides:, tasks:, options:)
      now = Time.now
      {
        id:                  generate_id('plan', now),
        title:               overrides[:title],
        goal:                overrides[:goal],
        duration_minutes:    clamp_duration(overrides[:duration_minutes]),
        tasks:,
        chunk_size_minutes:  clamp_chunk_or_break(overrides[:chunk_size_minutes]),
        break_minutes:       clamp_chunk_or_break(overrides[:break_minutes]),
        next_queue:          Array(options[:next_queue]),
        source:              options.fetch(:source, DEFAULT_SOURCE),
        created_at:          resolve_timestamp(options[:created_at], now),
        status:              options.fetch(:status, DEFAULT_STATUS),
        tags:                overrides[:tags],
        used_preset:         overrides[:used_preset]
      }
    end

    def generate_id(prefix, time = Time.now)
      "#{prefix}-#{time.to_i}-#{SecureRandom.hex(4)}"
    end

    # ---- History ----------------------------------------------------------

    def record_history(plan)
      @history << deep_freeze(deep_dup(plan))
      @history.shift while @history.size > MAX_HISTORY_ENTRIES
    end

    # ---- Time helpers -----------------------------------------------------

    def resolve_timestamp(value, fallback)
      case value
      when Time    then value.utc.iso8601
      when Numeric then Time.at(value.to_f).utc.iso8601
      when String  then value
      else              fallback.utc.iso8601
      end
    end

    # ---- Immutability -----------------------------------------------------

    # Deep-copy a plan (or any nested Hash/Array/String) so the caller
    # can freely mutate the result without affecting stored state.
    def deep_dup(obj)
      case obj
      when Hash   then obj.transform_values { |v| deep_dup(v) }
      when Array  then obj.map { |v| deep_dup(v) }
      when String then obj.dup
      else obj
      end
    end

    def deep_freeze(obj)
      case obj
      when Hash  then obj.each_value { |v| deep_freeze(v) }
      when Array then obj.each { |v| deep_freeze(v) }
      end
      obj.freeze
    end

    # ---- Error helpers ----------------------------------------------------

    def template_not_found_error(name)
      Error.new(
        "Template not found: #{name}",
        code: 'TEMPLATE_NOT_FOUND',
        http_status: 404
      )
    end
  end

  # ===========================================================================
  # Flag Parser
  # ===========================================================================
  #
  # Splits tokens into flags and positional arguments.
  # Supports `--key=value`, `--key value`, and `--key` (boolean) forms.
  # A token that looks like a flag is never consumed as another flag's value,
  # preventing `--title --goal x` from treating `--goal` as the title.

  module FlagParser
    module_function

    def call(tokens)
      flags      = {}
      positional = []
      i          = 0

      while i < tokens.length
        token = tokens[i]

        if flag?(token)
          key, val = parse_flag(token)

          if val
            flags[key] = val
          elsif (next_tok = tokens[i + 1]) && !flag?(next_tok)
            flags[key] = next_tok
            i += 1
          else
            flags[key] = true
          end
        else
          positional << token
        end

        i += 1
      end

      [flags, positional]
    end

    def flag?(token) = token&.start_with?('--') && token.length > 2

    # Split `--key=value` or `--key` into [symbol, value-or-nil].
    def parse_flag(token)
      key, val = token[2..].split('=', 2)
      [key.to_sym, val]
    end
  end
  private_constant :FlagParser

  # ===========================================================================
  # Exporters
  # ===========================================================================

  module Exporters
    module Markdown
      module_function

      def call(plan)
        goal  = plan[:goal].to_s
        tasks = Array(plan[:tasks])

        parts = [
          "# #{plan[:title]}",
          '',
          *metadata_lines(plan),
          '',
          '## Goal',
          goal.empty? ? '_(none)_' : goal,
          '',
          '## Duration',
          "#{plan[:duration_minutes]} minutes"
        ]

        if tasks.any?
          parts.concat(['', '## Tasks', ''])
          parts.concat(tasks.map { |t| task_line(t) })
        end

        parts.join("\n")
      end

      def metadata_lines(plan)
        [
          ("- **Status:** #{plan[:status]}"      if plan[:status]),
          ("- **Source:** #{plan[:source]}"      if plan[:source]),
          ("- **Tags:** #{Array(plan[:tags]).join(', ')}"   if Array(plan[:tags]).any?),
          ("- **Preset:** #{plan[:used_preset]}" if plan[:used_preset]),
          ("- **Created:** #{plan[:created_at]}" if plan[:created_at])
        ].compact
      end

      def task_line(task)
        mark = task[:completed] ? '[x]' : '[ ]'
        tag  = task[:is_break] ? ' _break_' : ''
        "- #{mark} #{task[:title]} (#{task[:duration_minutes]} min)#{tag}"
      end
    end

    module CSV
      module_function

      def call(plan)
        tasks = Array(plan[:tasks])

        ::CSV.generate do |csv|
          csv << %w[PlanID Title Goal DurationMin ChunkMin BreakMin Status CreatedAt]
          csv << plan.values_at(:id, :title, :goal, :duration_minutes,
                                :chunk_size_minutes, :break_minutes,
                                :status, :created_at)
          next if tasks.empty?

          csv << []
          csv << %w[TaskID Title DurationMin IsBreak Completed]
          tasks.each do |task|
            csv << task.values_at(:id, :title, :duration_minutes, :is_break, :completed)
          end
        end
      end
    end
  end
  private_constant :Exporters
end