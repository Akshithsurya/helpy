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
      @code = code
      @http_status = http_status
    end
    def to_h
      { code: code, message: message, http_status: http_status }
    end
    alias_method :as_json, :to_h
    def to_json(*args)
      to_h.to_json(*args)
    end
  end
  # ===========================================================================
  # Value object: a partially- or fully-built plan specification
  # ===========================================================================
  PlanSpec = Struct.new(
    :title, :goal, :duration_minutes,
    :chunk_size_minutes, :break_minutes,
    :tags, :used_preset,
    keyword_init: true
  ) do
    def self.build(tags: [], used_preset: nil, **rest)
      new(tags: tags, used_preset: used_preset, **rest)
    end
    # Returns a new spec with the given overrides merged in.
    def with(overrides)
      return self if overrides.empty?
      self.class.new(**to_h, **overrides)
    end
  end
  # ===========================================================================
  # Constants
  # ===========================================================================
  PRESETS = {
    'work'  => { title: 'Work Session',   duration_minutes: 60, goal: 'Focus on work tasks' },
    'study' => { title: 'Study Session',  duration_minutes: 45, goal: 'Focus on studying' },
    'focus' => { title: 'Deep Focus',     duration_minutes: 25, goal: 'Deep focus session' },
    'code'  => { title: 'Coding Session', duration_minutes: 90, goal: 'Write code and solve problems' }
  }.transform_values(&:freeze).freeze
  # Longest-first so alternation prefers the longest preset name.
  PRESET_NAMES = PRESETS.keys.sort_by { |k| -k.length }.freeze
  PRESET_PATTERN = /\A(#{PRESET_NAMES.map { |n| Regexp.escape(n) }.join('|')})\b/i.freeze
  # Limits
  MIN_PLAN_DURATION   = 5
  MAX_PLAN_DURATION   = 240
  MIN_CHUNK_OR_BREAK  = 1
  MAX_HISTORY_ENTRIES = 1_000
  # Defaults
  DEFAULT_PLAN_DURATION = 30
  DEFAULT_CHUNK_SIZE    = 15
  DEFAULT_BREAK_MINUTES = 5
  DEFAULT_TITLE         = 'Planned session'
  DEFAULT_SOURCE        = 'ruby-api'
  DEFAULT_STATUS        = 'pending'
  PLAN_OPTIONS_DEFAULTS = {
    next_queue: [],
    source:     DEFAULT_SOURCE,
    status:     DEFAULT_STATUS,
    created_at: nil
  }.freeze
  TASK_DESCRIPTORS = %w[Start\ strong Keep\ going Making\ progress Almost\ there Final\ push].freeze
  SUBCOMMANDS = %w[suggest compare template batch analyze schedule share].freeze
  # Matches:
  #   "2h", "2 hours", "2h30", "2 hours 30 minutes"
  #   "30m", "30 min", "30 minutes"
  #   "30" (bare number followed by space or end-of-string)
  DURATION_PATTERN = /
    \A
    (?:
      (?<hours>\d+(?:\.\d+)?)\s*h(?:ours?)?
      (?:\s*(?<mins>\d+)\s*(?:m(?:in(?:utes?)?)?)?)?
      |
      (?<mins>\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?
      |
      (?<mins>\d+(?:\.\d+)?)(?=\s|\z)
    )
  /xi.freeze
  FLAG_DEFINITIONS = {
    title: { field: :title },
    goal:  { field: :goal },
    chunk: { field: :chunk_size_minutes, coerce: :to_i },
    break: { field: :break_minutes,      coerce: :to_i },
    tags:  { field: :tags, coerce: ->(v) { v.split(',').map(&:strip).reject(&:empty?) } }
  }.freeze
  OVERRIDE_FIELDS = %i[
    title goal duration_minutes chunk_size_minutes break_minutes tags used_preset
  ].freeze
  EXPORT_FORMATS = {
    'json'     => ->(plan) { JSON.pretty_generate(plan) },
    'markdown' => ->(plan) { Exporters::Markdown.call(plan) },
    'csv'      => ->(plan) { Exporters::CSV.call(plan) },
    'ical'     => ->(plan) { Ical.export(plan) }
  }.freeze
  private_constant :PlanSpec, :DURATION_PATTERN, :FLAG_DEFINITIONS,
                   :OVERRIDE_FIELDS, :EXPORT_FORMATS, :SUBCOMMANDS,
                   :PRESET_NAMES, :PRESET_PATTERN
  @templates = {}
  @history   = []
  # ===========================================================================
  # Public API
  # ===========================================================================
  class << self
    # ---- Introspection ----------------------------------------------------
    def templates
      @templates.transform_values { |t| deep_dup(t) }
    end
    def history
      @history.map { |h| deep_dup(h) }
    end
    def history_count
      @history.size
    end
    def reset!
      @templates.clear
      @history.clear
      self
    end
    # ---- Dispatch ---------------------------------------------------------
    def dispatch(command_string)
      type = nil
      tokens = tokenize(command_string)
      type = resolve_command_type(tokens.first)
      { status: 'ok', type: type, data: execute_command(type, tokens) }
    rescue Error => e
      { status: 'error', type: type || :error, data: e.to_h }
    end
    # ---- Plan parsing & creation -----------------------------------------
    def parse_plan(args)
      flags, positional = FlagParser.call(tokenize(args))
      spec = PlanSpec.build
      spec = apply_flags(spec, flags)
      spec = apply_positional(spec, positional)
      finalize_spec(spec).to_h
    end
    def create_plan(args, **options)
      parsed = parse_plan(args)
      overrides = extract_overrides(parsed, options)
      include_breaks = options.fetch(:include_breaks, false)
      tasks = break_down_into_tasks(overrides, include_breaks: include_breaks)
      build_plan_record(overrides: overrides, tasks: tasks, options: options).tap do |plan|
        record_history(plan)
      end
    end
    def break_down_into_tasks(plan_hash, include_breaks: false)
      duration = clamp_duration(plan_hash[:duration_minutes])
      chunk_size = clamp_chunk_or_break(plan_hash[:chunk_size_minutes], default: DEFAULT_CHUNK_SIZE)
      break_mins = clamp_chunk_or_break(plan_hash[:break_minutes],      default: DEFAULT_BREAK_MINUTES)
      return [] unless duration.positive?
      seed = SecureRandom.hex(4)
      goal = plan_hash[:goal]
      each_chunk(duration, chunk_size, break_mins, include_breaks).map do |chunk, idx, is_break|
        build_task(
          seed: seed, idx: idx, duration: chunk, is_break: is_break,
          label: is_break ? 'Break' : descriptor_for(idx),
          goal:  is_break ? nil     : goal
        )
      end
    end
    # ---- Analytics & Suggestions -----------------------------------------
    def analyze_and_suggest(context = {})
      return Analytics.no_history_suggestions if @history.empty?
      basic = Analytics.compute_basic_stats(@history)
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
    def export_plan(plan, format = 'json')
      formatter = EXPORT_FORMATS[format.to_s.downcase] ||
        raise Error.new("Unsupported format: #{format}", code: 'UNSUPPORTED_FORMAT', http_status: 415)
      formatter.call(plan)
    end
    # ---- Template management ---------------------------------------------
    def save_template(template_name, plan_spec)
      name = template_name.to_s.strip
      raise Error.new('Template name cannot be empty', code: 'EMPTY_TEMPLATE_NAME') if name.empty?
      template = {
        id:         generate_id('template'),
        name:       name,
        plan_spec:  frozen_copy(plan_spec),
        created_at: Time.now.utc.iso8601
      }
      @templates[name] = template
      { success: true, template: deep_dup(template) }
    end
    def load_template(template_name)
      template = @templates[template_name.to_s] ||
        raise template_not_found_error(template_name)
      deep_dup(template[:plan_spec])
    end
    def list_templates
      @templates.values.map { |t| t.slice(:name, :created_at) }
    end
    def delete_template(template_name)
      @templates.delete(template_name.to_s) ||
        raise template_not_found_error(template_name)
      { success: true }
    end
    # =======================================================================
    # Private
    # =======================================================================
    private
    # ---- Dispatch helpers -------------------------------------------------
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
      when :batch    then raise Error.new('Batch not implemented', code: 'NOT_IMPLEMENTED', http_status: 501)
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
      action, *rest = tokens
      case action.to_s
      when 'save'   then save_template(rest.first.to_s, parse_plan(rest.drop(1)))
      when 'load'   then { plan_spec: load_template(rest.first.to_s) }
      when 'list'   then { templates: list_templates }
      when 'delete' then delete_template(rest.first.to_s)
      else raise Error.new("Unknown template action: #{action}", code: 'UNKNOWN_TEMPLATE_ACTION')
      end
    end
    # ---- Overrides --------------------------------------------------------
    def extract_overrides(parsed, options)
      OVERRIDE_FIELDS.to_h do |field|
        value = options.fetch(field, parsed[field])
        value = Array(value) if field == :tags && !value.is_a?(Array)
        [field, value]
      end
    end
    # ---- Tokenizing -------------------------------------------------------
    def tokenize(args)
      case args
      when nil    then []
      when Array  then args.map(&:to_s)
      when String then Shellwords.shellsplit(args.strip)
      else             Shellwords.shellsplit(args.to_s.strip)
      end
    rescue ArgumentError => e
      raise Error.new("Invalid command string: #{e.message}", code: 'PARSE_ERROR')
    end
    # ---- Flag application -------------------------------------------------
    def apply_flags(spec, flags)
      overrides = FLAG_DEFINITIONS.each_with_object({}) do |(flag, defn), h|
        v = flags[flag]
        next unless v.is_a?(String)
        h[defn[:field]] = coerce_flag_value(defn[:coerce], v)
      end
      if (d = flags[:duration]).is_a?(String) && (mins = extract_duration(d.strip)&.first)
        overrides[:duration_minutes] = mins
      end
      spec.with(overrides)
    end
    def coerce_flag_value(coercer, value)
      return value if coercer.nil?
      coercer.is_a?(Proc) ? coercer.call(value) : value.public_send(coercer)
    end
    # ---- Duration parsing -------------------------------------------------
    def extract_duration(str)
      s = str.to_s
      return nil if s.strip.empty?
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
      m = input.match(PRESET_PATTERN)
      return [spec, input] unless m
      name = m[1].downcase
      preset = PRESETS[name]
      rest = input[m[0].length..].strip
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
        duration_minutes:   clamp_duration(spec.duration_minutes),
        chunk_size_minutes: spec.chunk_size_minutes || DEFAULT_CHUNK_SIZE,
        break_minutes:      spec.break_minutes      || DEFAULT_BREAK_MINUTES,
        tags:               Array(spec.tags)
      )
    end
    # ---- Clamping ---------------------------------------------------------
    def clamp_duration(value, default: DEFAULT_PLAN_DURATION)
      v = Float(value, exception: false)
      return default if v.nil? || !v.finite? || !v.positive?
      v.round.clamp(MIN_PLAN_DURATION, MAX_PLAN_DURATION).to_i
    end
    def clamp_chunk_or_break(value, default:)
      return default if value.nil?
      v = Integer(value, exception: false) or return default
      [v, MIN_CHUNK_OR_BREAK].max
    end
    # ---- Chunk enumeration -----------------------------------------------
    def each_chunk(duration, chunk_size, break_mins, include_breaks)
      return enum_for(__method__, duration, chunk_size, break_mins, include_breaks) unless block_given?
      remaining = duration
      idx       = 0
      while remaining.positive?
        chunk = [chunk_size, remaining].min
        yield chunk, idx, false
        remaining -= chunk
        # A break is only inserted when there's more work *after* it,
        # and it belongs to the current task index, not the next.
        if include_breaks && break_mins.positive? && remaining > break_mins
          yield break_mins, idx, true
          remaining -= break_mins
        end
        idx += 1
      end
    end
    # ---- Task building ----------------------------------------------------
    def descriptor_for(idx)
      TASK_DESCRIPTORS[idx] || TASK_DESCRIPTORS.last
    end
    def build_task(seed:, idx:, label:, goal:, duration:, is_break:)
      {
        id:               "task-#{seed}-#{idx}#{is_break ? '-break' : ''}",
        title:            task_title(label: label, goal: goal, idx: idx, is_break: is_break),
        duration_minutes: duration,
        completed:        false,
        completed_at:     nil,
        is_break:         is_break
      }
    end
    def task_title(label:, goal:, idx:, is_break:)
      return label if is_break
      return "#{label}: #{goal}" if goal && !goal.empty?
      "#{label} - Part #{idx + 1}"
    end
    # ---- Plan record building ---------------------------------------------
    def build_plan_record(overrides:, tasks:, options:)
      now  = Time.now
      opts = PLAN_OPTIONS_DEFAULTS.merge(options)
      {
        id:                 generate_id('plan', now),
        title:              overrides[:title],
        goal:               overrides[:goal],
        duration_minutes:   clamp_duration(overrides[:duration_minutes]),
        tasks:              tasks,
        chunk_size_minutes: clamp_chunk_or_break(overrides[:chunk_size_minutes], default: DEFAULT_CHUNK_SIZE),
        break_minutes:      clamp_chunk_or_break(overrides[:break_minutes],      default: DEFAULT_BREAK_MINUTES),
        next_queue:         Array(opts[:next_queue]),
        source:             opts[:source],
        created_at:         resolve_timestamp(opts[:created_at], now),
        status:             opts[:status],
        tags:               overrides[:tags],
        used_preset:        overrides[:used_preset]
      }
    end
    def generate_id(prefix, time = Time.now)
      "#{prefix}-#{time.to_i}-#{SecureRandom.hex(4)}"
    end
    # ---- History ----------------------------------------------------------
    def record_history(plan)
      @history << frozen_copy(plan)
      excess = @history.size - MAX_HISTORY_ENTRIES