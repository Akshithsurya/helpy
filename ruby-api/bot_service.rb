# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'securerandom'
require 'time'
require_relative 'llm_client'

# RubyBotService handles intelligent chatbot queries, productivity facts,
# activity tracking memory, recommendations, and motivational coaching for Helpy.
#
# @example
#   service = RubyBotService.new
#   service.log_action('task_completed', 'Finished report')
#   service.process_query('tell me a fact')
#
class RubyBotService
  MAX_ACTION_HISTORY = 150
  MAX_CONTEXT_ITEMS = 8

  # ── Catalogs ───────────────────────────────────────────────────────────

  FACTS_CATALOG = [
    "The Pomodoro Technique was created in the late 1980s by Francesco Cirillo " \
    "using a tomato-shaped kitchen timer.",
    "Taking a short 5-minute break every 25 minutes enhances long-term memory " \
    "retention and reduces cognitive fatigue.",
    "Writing down your daily goals explicitly increases your completion rate by over 42%.",
    "Erlang was created at Ericsson in 1986 to power ultra-reliable, " \
    "fault-tolerant telecommunications systems.",
    "PHP was created by Rasmus Lerdorf in 1994 as a set of CGI binaries in C " \
    "to monitor web traffic.",
    "Ruby was created by Yukihiro 'Matz' Matsumoto in 1995 " \
    "to make programmers happy and productive.",
    "Multitasking can lower productivity by up to 40% due to continuous cognitive switching overhead.",
    "The Zeigarnik effect shows that your brain remembers uncompleted tasks better than completed ones.",
    "1% daily incremental improvement compounds to 37x better performance over 365 days.",
    "The human brain consumes ~20% of your body's total energy " \
    "despite being only 2% of total body mass.",
    "Dopamine triggers during anticipation of goal achievement, boosting focus before you even finish.",
    "Single-tasking for 90 minutes followed by rest aligns with the body's natural ultradian rhythm."
  ].freeze

  MOTIVATION_CATALOG = {
    'epic'   => [
      "Sensational performance! You are operating at peak productivity excellence!",
      "Masterclass in focus! Your dedication and velocity are setting new records today!",
      "Legendary momentum! You have conquered your task list like a champion!"
    ],
    'high'   => [
      "You are on absolute fire today! Keep pushing boundaries and crushing your goals!",
      "Phenomenal productivity! Your focus and discipline are deeply inspiring.",
      "Unstoppable momentum! Take a brief moment to celebrate how far you've come today!"
    ],
    'medium' => [
      "Great consistency! Every completed task brings you closer to long-term mastery.",
      "Solid progress! Step by step, you are turning goals into tangible results.",
      "Keep up the awesome work! Consistency is where real progress compounds!"
    ],
    'low'    => [
      "Every huge accomplishment starts with one small action. Pick a 2-minute task and win today!",
      "Progress over perfection! Start small and let momentum take over.",
      "A brand new start is always one decision away. You've got this!"
    ]
  }.freeze

  PRODUCTIVITY_THRESHOLDS = [
    { level: 'epic',   min_actions: 20, min_tasks: 10 },
    { level: 'high',   min_actions: 10, min_tasks: 5  },
    { level: 'medium', min_actions: 3,  min_tasks: 1  }
  ].freeze

  DEFAULT_ACTION_COUNTS = {
    'task_completed'  => 0,
    'timer_completed' => 0,
    'focus_started'   => 0,
    'habit_logged'    => 0
  }.freeze

  # Struct-based intent entry for the ordered intent registry.
  Intent = Struct.new(:name, :keywords, :handler, keyword_init: true)

  # Ordered intent registry: first match wins. Keywords use substring matching
  # via `include?`, so partial stems like 'motivat' catch both 'motivate' and
  # 'motivation'. Multi-word phrases like 'how long' are supported.
  INTENT_REGISTRY = [
    Intent.new(:recommendations, %w[recommend advice suggest],                    :handle_recommendations),
    Intent.new(:analytics,       %w[analytic streak trend performance breakdown], :handle_analytics),
    Intent.new(:wellness,        %w[tired exhaust stress burnout overwhelmed],    :handle_wellness),
    Intent.new(:time_estimation, ['estimate', 'how long', 'time block'],          :handle_time_estimation),
    Intent.new(:fact,            %w[fact tip trivia know],                        :handle_fact),
    Intent.new(:motivation,      %w[motivat inspire quote cheer push],            :handle_motivation),
    Intent.new(:memory,          %w[remember history summary stats doing],        :handle_memory),
    Intent.new(:greeting,        %w[hello hi hey] + ['who are you'],              :handle_greeting),
    Intent.new(:productivity,    %w[task todo work],                              :handle_productivity)
  ].freeze

  FAST_LOCAL_INTENTS = %i[fact motivation memory greeting analytics recommendations].freeze

  attr_reader :storage_file

  def initialize(storage_file = nil)
    @storage_file = storage_file || File.join(__dir__, 'data', 'bot_memory.json')
    @llm_client = LlmClient.new
    ensure_storage_dir
  end

  # ── Persistence ────────────────────────────────────────────────────────

  # Reads persisted memory from disk. Returns a normalized default if the
  # file is missing, empty, or contains invalid JSON.
  #
  # @return [Hash] the memory hash
  def read_memory
    return default_memory unless File.exist?(@storage_file)

    parsed = JSON.parse(File.read(@storage_file))
    parsed.is_a?(Hash) ? normalize_memory(parsed) : default_memory
  rescue JSON::ParserError
    default_memory
  rescue StandardError => e
    warn "RubyBotService: Failed to read memory: #{e.message}"
    default_memory
  end

  # Atomically persists memory to disk using a temp file + rename strategy.
  #
  # @param memory [Hash] the memory hash to persist
  def save_memory(memory)
    ensure_storage_dir
    tmp_file = "#{@storage_file}.tmp.#{Process.pid}_#{SecureRandom.hex(4)}"
    File.write(tmp_file, JSON.pretty_generate(memory))
    File.rename(tmp_file, @storage_file)
  rescue StandardError => e
    warn "RubyBotService: Failed to save memory: #{e.message}"
    FileUtils.rm_f(tmp_file) if tmp_file
  end

  # Resets memory to defaults and persists.
  #
  # @return [Hash] result with success flag and cleared memory
  def clear_memory
    memory = default_memory
    save_memory(memory)
    { success: true, message: 'Bot memory successfully cleared.', memory: memory }
  end

  # Exports the current memory with a timestamp.
  #
  # @return [Hash] result with exported data
  def export_memory
    { success: true, exported_at: current_timestamp, data: read_memory }
  end

  # ── Action Logging ─────────────────────────────────────────────────────

  # Logs an action to memory with type, detail, and optional metadata.
  #
  # @param action_type [String, Symbol] the type of action (e.g. 'task_completed')
  # @param detail [String] human-readable detail about the action
  # @param meta [Hash] optional metadata to store with the action
  # @return [Hash] result with the logged entry and updated counts
  def log_action(action_type, detail = '', meta = {})
    memory = read_memory
    entry  = build_action_entry(action_type, detail, meta)

    memory['actions'].unshift(entry)
    memory['actions']         = memory['actions'].first(MAX_ACTION_HISTORY)
    memory['total_actions']   += 1
    memory['action_counts'][action_type.to_s] =
      memory['action_counts'].fetch(action_type.to_s, 0) + 1
    memory['last_updated']    = current_timestamp

    save_memory(memory)

    { success: true, logged_action: entry,
      total_actions: memory['total_actions'],
      action_counts: memory['action_counts'] }
  end

  # ── Data Accessors ─────────────────────────────────────────────────────

  # @return [Hash] a random fact from the catalog
  def get_random_fact
    { success: true, fact: FACTS_CATALOG.sample,
      total_facts: FACTS_CATALOG.size, source: 'Ruby Bot Engine' }
  end

  # @return [Hash] a motivational message calibrated to the user's productivity level
  def get_motivation
    memory = read_memory
    total  = memory['total_actions']
    tasks  = memory.dig('action_counts', 'task_completed') || 0
    level  = calculate_productivity_level(total, tasks)
    quote  = MOTIVATION_CATALOG[level].sample

    { success: true, level: level, motivation: quote,
      total_actions: total, tasks_completed: tasks }
  end

  # @return [Hash] a summary of the bot's memory of the user
  def get_memory_summary
    memory       = read_memory
    summary_text = build_summary_text(memory['total_actions'], memory['action_counts'])

    { success: true, total_actions: memory['total_actions'],
      action_counts: memory['action_counts'], summary: summary_text,
      recent_actions: memory['actions'].first(5) }
  end

  # @return [Hash] personalized recommendations based on activity history
  def get_recommendations
    memory = read_memory
    counts = memory['action_counts']
    total  = memory['total_actions']
    tasks  = counts.fetch('task_completed', 0)
    timers = counts.fetch('timer_completed', 0)

    recommendations = build_recommendations(total, tasks, timers)

    { success: true, recommendations: recommendations,
      total_actions: total,
      productivity_level: calculate_productivity_level(total, tasks) }
  end

  # @return [Hash] analytics about the user's activity
  def get_analytics
    memory = read_memory
    counts = memory['action_counts']
    total  = memory['total_actions']

    {
      success: true,
      total_actions: total,
      days_active: compute_days_active(memory['actions']),
      action_counts: counts,
      action_percentages: compute_action_percentages(counts, total),
      productivity_level: calculate_productivity_level(total, counts.fetch('task_completed', 0)),
      last_updated: memory.fetch('last_updated', current_timestamp)
    }
  end

  # ── Query Processing ───────────────────────────────────────────────────

  # Processes a natural language query and routes it to the appropriate handler.
  #
  # @param prompt [String] the user's query
  # @param context [Hash] extra desktop context
  # @return [Hash] result with answer and detected intent
  def process_query(prompt, context = {})
    query = prompt.to_s.strip.downcase
    return handle_empty_query if query.empty?

    normalized_context = normalize_context(context)
    intent = detect_intent(query)
    assistant_mode = normalized_context[:assistant_mode].to_s

    if intent && FAST_LOCAL_INTENTS.include?(intent.name) && assistant_mode != 'plan'
      return send(intent.handler, normalized_context)
    end

    if should_use_llm?(query, normalized_context, intent)
      llm_response = handle_llm_query(query, normalized_context, intent)
      return llm_response if llm_response
    end

    if planning_request?(query, normalized_context)
      return handle_local_planning(query, normalized_context)
    end

    intent ? send(intent.handler, normalized_context) : handle_fallback(normalized_context)
  end

  private

  # ── Intent Detection ───────────────────────────────────────────────────

  def detect_intent(query)
    INTENT_REGISTRY.find { |intent| intent.keywords.any? { |kw| query.include?(kw) } }
  end

  # ── Intent Handlers ────────────────────────────────────────────────────

  # Helper to build consistent handler responses with optional extra keys.
  def respond(answer, intent, **extra)
    { success: true, answer: answer, intent: intent }.merge(extra)
  end

  def handle_empty_query
    respond(
      "Hello! I'm your Ruby-powered Helpy AI Assistant. " \
      "Ask me for a fact, motivation, recommendations, " \
      "analytics, or a summary of your activity history!",
      'greeting'
    )
  end

  def handle_recommendations(_context = nil)
    rec_data = get_recommendations
    bullets  = rec_data[:recommendations].map { |r| "• #{r}" }.join("\n")

    respond(
      "Here are your personalized productivity recommendations:\n#{bullets}",
      'recommendations',
      recommendations: rec_data[:recommendations],
      level: rec_data[:productivity_level]
    )
  end

  def handle_analytics(_context = nil)
    data = get_analytics

    respond(
      "Productivity Analytics:\n" \
      "- Total Actions: #{data[:total_actions]}\n" \
      "- Active Days: #{data[:days_active]}\n" \
      "- Productivity Tier: #{data[:productivity_level].upcase}",
      'analytics',
      analytics: data
    )
  end

  def handle_wellness(_context = nil)
    respond(
      "It sounds like you might be experiencing cognitive fatigue. " \
      "Step away from the screen, grab a glass of water, " \
      "and take a 10-minute relaxation break!",
      'wellness_coaching'
    )
  end

  def handle_time_estimation(_context = nil)
    respond(
      "A good rule of thumb for task estimation: add 25% buffer time " \
      "to your initial estimate to account for unforeseen interruptions.",
      'time_estimation'
    )
  end

  def handle_fact(_context = nil)
    fact_data = get_random_fact
    respond("Did you know? #{fact_data[:fact]}", 'fact', fact: fact_data[:fact])
  end

  def handle_motivation(_context = nil)
    mot_data = get_motivation
    respond(
      "Bot Motivation: #{mot_data[:motivation]}",
      'motivation',
      motivation: mot_data[:motivation],
      level: mot_data[:level]
    )
  end

  def handle_memory(_context = nil)
    sum_data = get_memory_summary
    respond(
      "What I Remember About You:\n#{sum_data[:summary]}",
      'memory',
      summary: sum_data[:summary],
      total_actions: sum_data[:total_actions]
    )
  end

  def handle_greeting(_context = nil)
    respond(
      "Greetings! I'm the Ruby-powered Helpy Companion Bot. " \
      "I keep track of your focus wins, provide tech insights, " \
      "and keep your productivity high. How can I assist you right now?",
      'greeting'
    )
  end

  def handle_productivity(context = nil)
    if context.is_a?(Hash) && Array(context[:tasks]).any?
      open_tasks = Array(context[:tasks]).reject { |task| truthy_task_completion?(task) }
      next_task = open_tasks.first
      if next_task
        title = task_title(next_task)
        return respond(
          "You have #{open_tasks.size} open task#{pluralize(open_tasks.size)}. " \
          "Start with #{title.inspect}, keep the first sprint to 25 minutes, " \
          "and finish with one visible outcome before switching.",
          'productivity',
          mode: 'local'
        )
      end
    end

    respond(
      "To maximize task efficiency, try breaking large goals into " \
      "25-minute focus intervals and tracking completed milestones here in Helpy!",
      'productivity',
      mode: 'local'
    )
  end

  def handle_fallback(context = nil)
    if context.is_a?(Hash) && Array(context[:tasks]).any?
      return handle_local_planning('', context)
    end

    respond(
      "I'm your Ruby Helpy Assistant! You can ask me: " \
      "'tell me a cool fact', 'give me motivation', " \
      "'give me recommendations', or 'what do you remember?'.",
      'general_inquiry',
      mode: 'local'
    )
  end

  def should_use_llm?(query, context, intent)
    return false unless @llm_client.available?
    return true if context[:assistant_mode].to_s == 'plan'
    return true if planning_request?(query, context)
    return true if intent.nil?

    !FAST_LOCAL_INTENTS.include?(intent.name)
  end

  def handle_llm_query(query, context, intent)
    raw = @llm_client.complete(
      messages: build_llm_messages(query, context, intent),
      temperature: context[:assistant_mode].to_s == 'plan' ? 0.3 : 0.2,
      max_tokens: context[:assistant_mode].to_s == 'plan' ? 900 : 600
    )
    parsed = parse_llm_payload(raw['content'])
    return nil unless parsed

    plan_draft = normalize_plan_draft(parsed['plan_draft'] || parsed[:plan_draft], query, context)
    answer = parsed['answer'] || parsed[:answer]
    answer = answer.to_s.strip
    answer = fallback_answer_for(query, context, plan_draft) if answer.empty?

    respond(
      answer,
      parsed['intent'] || parsed[:intent] || intent&.name&.to_s || 'assistant',
      mode: 'llm',
      provider: 'custom-llm-adapter',
      plan_draft: plan_draft,
      suggested_commands: Array(parsed['suggested_commands'] || parsed[:suggested_commands]).map(&:to_s),
      warnings: Array(parsed['warnings'] || parsed[:warnings]).map(&:to_s)
    )
  rescue StandardError => e
    warn "RubyBotService: LLM query failed: #{e.message}"
    nil
  end

  def build_llm_messages(query, context, intent)
    history = Array(context[:conversation]).filter_map do |entry|
      next unless entry.is_a?(Hash)

      role = (entry[:role] || entry['role']).to_s
      content = (entry[:content] || entry['content']).to_s.strip
      next unless %w[user assistant].include?(role) && !content.empty?

      { role: role, content: content.first(1_500) }
    end.last(8)

    [
      *history,
      {
        role: 'system',
        content: <<~PROMPT
          You are the Helpy planning assistant inside a Windows desktop productivity app.
          Respond in JSON only with keys: answer, intent, plan_draft, suggested_commands, warnings.
          Keep answer concise, grounded in the provided app context, and never invent app state.
          plan_draft should be null unless the user is asking for a plan or a plan revision.
          When plan_draft is present, use keys: title, goal, durationMinutes, chunkSizeMinutes, breakMinutes, tags, tasks.
          tasks should be a short list of concrete task titles if you can infer them safely.
        PROMPT
      },
      {
        role: 'user',
        content: JSON.generate(
          prompt: query,
          detected_intent: intent&.name&.to_s,
          assistant_mode: context[:assistant_mode],
          context_summary: context_summary(context)
        )
      }
    ]
  end

  def parse_llm_payload(content)
    body = content.to_s.strip
    return nil if body.empty?

    JSON.parse(extract_json_block(body))
  rescue JSON::ParserError
    { 'answer' => body, 'intent' => 'assistant' }
  end

  def extract_json_block(content)
    match = content.match(/\{.*\}/m)
    match ? match[0] : content
  end

  def normalize_plan_draft(raw_draft, query, context)
    return nil unless raw_draft.is_a?(Hash)

    tasks = Array(raw_draft['tasks'] || raw_draft[:tasks]).filter_map do |task|
      title = task.is_a?(Hash) ? task['title'] || task[:title] : task
      title = title.to_s.strip
      next if title.empty?

      { 'title' => title }
    end

    duration = extract_duration_minutes(raw_draft['durationMinutes'] || raw_draft[:durationMinutes]) ||
               extract_duration_minutes(query) || 30
    chunk = extract_duration_minutes(raw_draft['chunkSizeMinutes'] || raw_draft[:chunkSizeMinutes]) || recommended_chunk(duration)
    break_minutes = extract_duration_minutes(raw_draft['breakMinutes'] || raw_draft[:breakMinutes]) || recommended_break(duration)

    {
      'title' => (raw_draft['title'] || raw_draft[:title] || derive_plan_title(query, context)).to_s.strip,
      'goal' => (raw_draft['goal'] || raw_draft[:goal] || query).to_s.strip,
      'durationMinutes' => [[duration, 5].max, 240].min,
      'chunkSizeMinutes' => [[chunk, 5].max, 60].min,
      'breakMinutes' => [[break_minutes, 1].max, 30].min,
      'tags' => Array(raw_draft['tags'] || raw_draft[:tags]).map(&:to_s).map(&:strip).reject(&:empty?).first(6),
      'tasks' => tasks.first(MAX_CONTEXT_ITEMS)
    }
  end

  def handle_local_planning(query, context)
    draft = build_local_plan_draft(query, context)
    answer = fallback_answer_for(query, context, draft)
    respond(
      answer,
      'planning_assistant',
      mode: 'local',
      plan_draft: draft,
      suggested_commands: [suggested_command_for(draft)]
    )
  end

  def build_local_plan_draft(query, context)
    open_tasks = Array(context[:tasks]).reject { |task| truthy_task_completion?(task) }
    duration = extract_duration_minutes(query) || suggested_duration_from_context(context)
    title = derive_plan_title(query, context)
    goal = query.to_s.strip.empty? ? "Progress #{title.downcase}" : query.to_s.strip
    task_titles = open_tasks.first(3).map { |task| { 'title' => task_title(task) } }

    {
      'title' => title,
      'goal' => goal,
      'durationMinutes' => duration,
      'chunkSizeMinutes' => recommended_chunk(duration),
      'breakMinutes' => recommended_break(duration),
      'tags' => derive_tags(context),
      'tasks' => task_titles
    }
  end

  def fallback_answer_for(query, context, draft)
    summary = context_summary(context)
    lines = []
    lines << "I built a #{draft['durationMinutes']}-minute plan around #{draft['title']}."
    lines << "I used your current Helpy context#{summary.empty? ? '.' : ": #{summary}."}"
    lines << "You can run #{suggested_command_for(draft)} or refine it by saying what changed." if draft
    lines.join(' ')
  end

  def suggested_command_for(draft)
    title = draft['title'].to_s.strip.empty? ? 'Planned session' : draft['title'].to_s.strip
    "/plan #{title} #{draft['durationMinutes']}"
  end

  def planning_request?(query, context)
    return true if context[:assistant_mode].to_s == 'plan'
    return false if query.to_s.strip.empty?

    query.match?(/\b(plan|schedule|prioriti[sz]e|revise|adjust|rework|only have|i have|fit|around|tonight|today|tomorrow)\b/)
  end

  def normalize_context(context)
    raw = context.is_a?(Hash) ? context : {}
    {
      assistant_mode: raw[:assistant_mode] || raw['assistant_mode'],
      tasks: Array(raw[:tasks] || raw['tasks']).first(MAX_CONTEXT_ITEMS),
      habits: Array(raw[:habits] || raw['habits']).first(MAX_CONTEXT_ITEMS),
      notifications: Array(raw[:notifications] || raw['notifications']).first(MAX_CONTEXT_ITEMS),
      activity_history: Array(raw[:activity_history] || raw['activity_history']).first(MAX_CONTEXT_ITEMS),
      app_usage_stats: raw[:app_usage_stats] || raw['app_usage_stats'] || {},
      plan_history: Array(raw[:plan_history] || raw['plan_history']).first(MAX_CONTEXT_ITEMS),
      plan_statistics: raw[:plan_statistics] || raw['plan_statistics'] || {},
      focus_report: raw[:focus_report] || raw['focus_report'] || {},
      current_plan: raw[:current_plan] || raw['current_plan'],
      source: raw[:source] || raw['source'],
      conversation: Array(raw[:conversation] || raw['conversation']).first(8)
    }
  end

  def context_summary(context)
    parts = []
    open_tasks = Array(context[:tasks]).reject { |task| truthy_task_completion?(task) }
    parts << "#{open_tasks.size} open task#{pluralize(open_tasks.size)}" if open_tasks.any?
    habits = Array(context[:habits])
    parts << "#{habits.size} active habit#{pluralize(habits.size)}" if habits.any?
    notifications = Array(context[:notifications]).reject { |notification| notification['dismissed'] || notification[:dismissed] }
    parts << "#{notifications.size} pending notification#{pluralize(notifications.size)}" if notifications.any?
    total_minutes = context.dig(:plan_statistics, 'totalMinutes') || context.dig(:plan_statistics, :totalMinutes)
    parts << "#{total_minutes} planned minutes in recent stats" if total_minutes.to_i.positive?
    today_ms = context.dig(:focus_report, 'todayFocusedMs') || context.dig(:focus_report, :todayFocusedMs)
    parts << "#{(today_ms.to_i / 60_000)} focused minutes today" if today_ms.to_i.positive?
    parts.join(', ')
  end

  def suggested_duration_from_context(context)
    open_tasks = Array(context[:tasks]).reject { |task| truthy_task_completion?(task) }
    return 45 if open_tasks.size >= 3
    return 25 if open_tasks.size <= 1

    30
  end

  def derive_plan_title(query, context)
    stripped = query.to_s.gsub(%r{^/plan\s*}i, '').strip
    return stripped.split(/\s+/).first(6).join(' ').capitalize unless stripped.empty?

    next_task = Array(context[:tasks]).reject { |task| truthy_task_completion?(task) }.first
    return task_title(next_task) if next_task

    'Focused Work Session'
  end

  def derive_tags(context)
    tags = []
    tags << 'focus'
    tags << 'tasks' if Array(context[:tasks]).any?
    tags << 'habits' if Array(context[:habits]).any?
    tags.uniq
  end

  def extract_duration_minutes(value)
    case value
    when Numeric
      value.to_i
    else
      text = value.to_s
      return nil if text.strip.empty?
      if (match = text.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i))
        return match[1].to_i * 60 + match[2].to_i
      end
      if (match = text.match(/(\d+)\s*h(?:ours?)?/i))
        return match[1].to_i * 60
      end
      if (match = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i))
        return match[1].to_i
      end

      Integer(text, exception: false)
    end
  end

  def recommended_chunk(duration)
    return 15 if duration <= 30
    return 20 if duration <= 60

    25
  end

  def recommended_break(duration)
    duration >= 90 ? 10 : 5
  end

  def truthy_task_completion?(task)
    task['completed'] == true || task[:completed] == true || task['status'] == 'completed' || task[:status] == 'completed'
  end

  def task_title(task)
    (task['title'] || task[:title] || task['name'] || task[:name] || 'Untitled task').to_s
  end

  # ── Memory Helpers ─────────────────────────────────────────────────────

  def build_action_entry(action_type, detail, meta)
    {
      'id'        => "act_#{Time.now.to_i}_#{SecureRandom.hex(3)}",
      'type'      => action_type.to_s,
      'detail'    => detail.to_s,
      'meta'      => meta.is_a?(Hash) ? meta : {},
      'timestamp' => current_timestamp
    }
  end

  def default_memory
    {
      'total_actions' => 0,
      'actions'       => [],
      'action_counts' => DEFAULT_ACTION_COUNTS.dup,
      'last_updated'  => current_timestamp
    }
  end

  def normalize_memory(data)
    data['total_actions'] = data.fetch('total_actions', 0).to_i
    data['actions']       = data.fetch('actions', [])
    data['action_counts'] = DEFAULT_ACTION_COUNTS.merge(data.fetch('action_counts', {}))
    data['last_updated']  ||= current_timestamp
    data
  end

  def current_timestamp
    Time.now.iso8601
  end

  # ── Productivity ───────────────────────────────────────────────────────

  def calculate_productivity_level(total_actions, completed_tasks)
    PRODUCTIVITY_THRESHOLDS.each do |threshold|
      return threshold[:level] if total_actions >= threshold[:min_actions] ||
                                  completed_tasks >= threshold[:min_tasks]
    end
    'low'
  end

  # ── Builders ───────────────────────────────────────────────────────────

  def build_summary_text(total, counts)
    if total.zero?
      "You haven't recorded any actions yet. Start a focus session " \
      "or complete a task to build your productivity history!"
    else
      tasks   = counts.fetch('task_completed', 0)
      timers  = counts.fetch('timer_completed', 0)
      focuses = counts.fetch('focus_started', 0)
      habits  = counts.fetch('habit_logged', 0)

      "You've completed #{total} total action#{pluralize(total)} " \
      "(finished #{tasks} task#{pluralize(tasks)}, " \
      "#{timers} timer#{pluralize(timers)}, " \
      "#{focuses} focus session#{pluralize(focuses)}, " \
      "and #{habits} habit#{pluralize(habits)}). Great work!"
    end
  end

  def build_recommendations(total, tasks, timers)
    recommendations = []

    recommendations <<
      if tasks.zero?
        "Pick a quick 5-minute task to build initial momentum."
      elsif tasks > 5
        "You've completed #{tasks} tasks! Consider scheduling a longer rest break to prevent burnout."
      end

    recommendations <<
      if timers.zero?
        "Try starting a 25-minute Pomodoro timer to supercharge deep focus."
      else
        "Great job using timers! Ensure you stick to standard 5-minute short breaks."
      end

    recommendations <<
      if total < 3
        "Log your daily habits and goals in Helpy to build a consistent daily streak."
      else
        "Your daily momentum is solid! Review your weekly stats to optimize peak hours."
      end

    recommendations.compact
  end

  # ── Analytics Helpers ──────────────────────────────────────────────────

  def compute_action_percentages(counts, total)
    counts.transform_values do |val|
      total.positive? ? (val.to_f / total * 100).round(1) : 0.0
    end
  end

  def compute_days_active(actions)
    actions.filter_map { |a| parse_time(a['timestamp']) }
           .map { |t| t.strftime('%Y-%m-%d') }
           .uniq
           .size
  end

  def parse_time(ts)
    Time.parse(ts)
  rescue ArgumentError
    nil
  end

  # ── Utility ────────────────────────────────────────────────────────────

  def pluralize(count)
    count == 1 ? '' : 's'
  end

  def ensure_storage_dir
    FileUtils.mkdir_p(File.dirname(@storage_file))
  end
end
