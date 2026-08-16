# frozen_string_literal: true

require 'sinatra/base'
require 'rack/deflater'
require 'json'
require 'securerandom'
require 'time'
require 'logger'
require 'set'
require_relative 'plan_service'
require_relative 'db_setup'
require_relative 'bot_service'

# PlanApi — a small, hardened Sinatra API for planning endpoints.
#
# Response envelope (every route):
#   success: { success: true,  data:    <payload> }
#   error:   { success: false, error: <msg>, code: <CODE>, details?: <obj> }
class PlanApi < Sinatra::Base
  use Rack::Deflater

  # ---- Constants ------------------------------------------------------------
  MAX_BODY_BYTES     = 1_048_576
  STARTED_AT         = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  VERSION            = ENV.fetch('APP_VERSION', 'dev')
  REQUEST_ID_MAXLEN  = 128
  REQUEST_ID_PATTERN = /\A[A-Za-z0-9\-_.]+\z/.freeze
  BODY_METHODS       = Set.new(%w[POST PUT PATCH]).freeze
  VALID_LOG_LEVELS   = Set.new(%w[DEBUG INFO WARN ERROR FATAL UNKNOWN]).freeze
  JSON_MIME          = 'application/json'
  JSON_CONTENT_TYPE  = "#{JSON_MIME}; charset=utf-8"

  ALLOWED_ORIGINS = ENV.fetch('CORS_ORIGIN', '*')
                       .split(',').map(&:strip).reject(&:empty?).to_set.freeze

  ALLOW_CREDENTIALS = ENV.fetch('CORS_ALLOW_CREDENTIALS', 'false').downcase == 'true'
  ENABLE_HSTS       = ENV.fetch('ENABLE_HSTS', 'false').downcase == 'true'
  HSTS_PRELOAD      = ENV.fetch('HSTS_PRELOAD', 'false').downcase == 'true'

  SECURITY_HEADERS = {
    'X-Content-Type-Options'            => 'nosniff',
    'X-Frame-Options'                   => 'DENY',
    'Referrer-Policy'                   => 'strict-origin-when-cross-origin',
    'Cache-Control'                     => 'no-store',
    'X-Permitted-Cross-Domain-Policies' => 'none',
    'Permissions-Policy'                => 'geolocation=(), microphone=(), camera=()',
    'Cross-Origin-Resource-Policy'      => 'same-origin'
  }.freeze

  HSTS_VALUE = [
    'max-age=31536000',
    'includeSubDomains',
    ('preload' if HSTS_PRELOAD)
  ].compact.join('; ').freeze

  CORS_BASE_HEADERS = {
    'Access-Control-Allow-Methods' => 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers' => 'Content-Type, Authorization, X-Request-Id',
    'Access-Control-Max-Age'       => '600'
  }.freeze

  STATUS_FOR_CODE = {
    'INVALID_JSON'           => 400,
    'PAYLOAD_TOO_LARGE'      => 413,
    'UNSUPPORTED_MEDIA_TYPE' => 415,
    'NOT_FOUND'              => 404,
    'BAD_REQUEST'            => 400,
    'MISSING_FIELD'          => 422,
    'TYPE_ERROR'             => 422,
    'BLANK_FIELD'            => 422,
    'FIELD_TOO_LONG'         => 422,
    'INVALID_INTEGER'        => 422,
    'BELOW_MINIMUM'          => 422,
    'ABOVE_MAXIMUM'          => 422,
    'VALIDATION_ERROR'       => 422
  }.freeze

  ENDPOINTS = %w[
    GET  /
    GET  /health
    GET  /ready
    POST /api/plan/parse
    POST /api/plan/create
    POST /api/plan/breakdown
    POST /api/plan/analyze
    POST /api/plan/export
    POST /api/template/save
    POST /api/template/load
    GET  /api/template/list
    POST /api/template/delete
    POST /api/sessions
    POST /api/blocked_attempts
    GET  /api/stats/weekly
    GET  /api/stats/streaks
    GET  /api/stats/blocked
    GET  /api/stats/summary
    POST /api/bot/chat
    POST /api/bot/action
    GET  /api/bot/summary
    GET  /api/bot/fact
    GET  /api/bot/motivation
    GET  /api/bot/recommendations
    GET  /api/bot/analytics
    POST /api/bot/memory/export
    POST /api/bot/memory/clear
  ].freeze

  if ALLOW_CREDENTIALS && ALLOWED_ORIGINS.include?('*')
    warn '[PlanApi] CORS_ALLOW_CREDENTIALS=true with wildcard origin (*) is ' \
         'invalid per the CORS spec. Wildcard will be ignored; set CORS_ORIGIN ' \
         'to specific origins.'
  end

  # ---- Configuration --------------------------------------------------------
  configure do
    set :environment,     ENV.fetch('RACK_ENV', 'production').to_sym
    set :port,            ENV.fetch('PORT', 4567).to_i
    set :bind,            ENV.fetch('BIND', '0.0.0.0')
    set :show_exceptions, false
    set :raise_errors,    false
    set :dump_errors,     false
    set :logging,         false
    set :protection,      false
    set :static,          false
  end

  # ---- Typed error ----------------------------------------------------------
  class ValidationError < StandardError
    attr_reader :code, :details

    def initialize(message, code: 'VALIDATION_ERROR', details: nil)
      super(message)
      @code    = code
      @details = details
    end
  end

  # ---- Logger & shared state (thread-safe double-checked locking) ----------
  STATE_MUTEX = Mutex.new

  class << self
    def logger
      return @logger if instance_variable_defined?(:@logger)
      STATE_MUTEX.synchronize do
        return @logger if instance_variable_defined?(:@logger)
        @logger = build_logger
      end
    end

    def stats_db
      return @stats_db if instance_variable_defined?(:@stats_db)
      STATE_MUTEX.synchronize do
        return @stats_db if instance_variable_defined?(:@stats_db)
        @stats_db = StatsDatabase.new
      end
    end

    def bot_service
      return @bot_service if instance_variable_defined?(:@bot_service)
      STATE_MUTEX.synchronize do
        return @bot_service if instance_variable_defined?(:@bot_service)
        @bot_service = RubyBotService.new
      end
    end

    private

    def build_logger
      Logger.new($stdout).tap do |log|
        level_str = ENV.fetch('LOG_LEVEL', 'INFO').upcase
        log.level    = VALID_LOG_LEVELS.include?(level_str) ? Logger.const_get(level_str) : Logger::INFO
        log.progname = name
        log.formatter = lambda do |sev, time, prog, msg|
          payload = msg.is_a?(Hash) ? msg.transform_keys(&:to_s) : { 'msg' => msg.to_s }
          payload.merge('ts' => time.iso8601(3), 'level' => sev, 'app' => prog).to_json + "\n"
        end
      end
    end
  end

  def logger      = self.class.logger
  def stats_db    = self.class.stats_db
  def bot_service = self.class.bot_service

  # ---- Params ---------------------------------------------------------------
  # Fluent adapter over the parsed JSON body.
  #   fetch_*  → required (raises ValidationError if missing or wrong type)
  #   <type>   → optional (accepts a default)
  class Params
    TRUE_LITERALS  = Set.new(%w[true 1 yes on]).freeze
    FALSE_LITERALS = Set.new(%w[false 0 no off]).freeze

    def initialize(data)
      unless data.is_a?(Hash)
        raise ValidationError.new('Request body must be a JSON object', code: 'INVALID_JSON')
      end
      @data = data
    end

    # --- Required ---
    def fetch(key) = require_key(key)

    def fetch_string(key, allow_blank: false, max: nil)
      validate_string!(key, require_key(key), allow_blank: allow_blank, max: max)
    end

    def fetch_hash(key, symbolize: false)
      validate_hash!(key, require_key(key), symbolize: symbolize)
    end

    def fetch_array(key)
      validate_array!(key, require_key(key))
    end

    def fetch_int(key, min: nil, max: nil)
      bounds(coerce_int(key, require_key(key)), key, min, max)
    end

    def fetch_bool(key)
      result = parse_bool(require_key(key))
      type_error!(key, 'a boolean') if result.nil?
      result
    end

    # --- Optional (with defaults) ---
    def string(key, default: nil, allow_blank: false, max: nil)
      v = @data[key]
      return default if v.nil?
      validate_string!(key, v, allow_blank: allow_blank, max: max)
    end

    def hash(key, default: {}, symbolize: false)
      v = @data[key]
      return default if v.nil?
      validate_hash!(key, v, symbolize: symbolize)
    end

    def array(key, default: [])
      v = @data[key]
      return default if v.nil?
      validate_array!(key, v)
    end

    def int(key, default:, min: nil, max: nil)
      v = @data[key]
      return default if v.nil? || (v.is_a?(String) && v.strip.empty?)
      bounds(coerce_int(key, v), key, min, max)
    end

    def bool(key, default: false)
      v = @data[key]
      return default if v.nil?
      result = parse_bool(v)
      result.nil? ? default : result
    end

    def [](key) = @data[key]
    def key?(k) = @data.key?(k)
    def to_h    = @data.dup

    private

    def require_key(key)
      v = @data[key]
      return v unless v.nil?
      raise ValidationError.new(
        "Missing required field: #{key}",
        code: 'MISSING_FIELD',
        details: { field: key }
      )
    end

    def validate_string!(key, v, allow_blank:, max:)
      type_error!(key, 'a string')  unless v.is_a?(String)
      blank!(key)                   if !allow_blank && v.strip.empty?
      too_long!(key, max)           if max && v.bytesize > max
      v
    end

    def validate_hash!(key, v, symbolize:)
      type_error!(key, 'a JSON object') unless v.is_a?(Hash)
      symbolize ? deep_symbolize_keys(v) : v
    end

    def validate_array!(key, v)
      type_error!(key, 'an array') unless v.is_a?(Array)
      v
    end

    def deep_symbolize_keys(obj)
      case obj
      when Hash
        obj.transform_keys(&:to_sym).transform_values { |v| deep_symbolize_keys(v) }
      when Array
        obj.map { |v| deep_symbolize_keys(v) }
      else
        obj
      end
    end

    def parse_bool(v)
      return v if v.is_a?(TrueClass) || v.is_a?(FalseClass)
      s = v.to_s.downcase
      return true  if TRUE_LITERALS.include?(s)
      return false if FALSE_LITERALS.include?(s)
      nil
    end

    def type_error!(key, expected)
      raise ValidationError.new(
        "Field '#{key}' must be #{expected}",
        code: 'TYPE_ERROR',
        details: { field: key }
      )
    end

    def blank!(key)
      raise ValidationError.new(
        "Field '#{key}' must not be blank",
        code: 'BLANK_FIELD',
        details: { field: key }
      )
    end

    def too_long!(key, max)
      raise ValidationError.new(
        "Field '#{key}' exceeds #{max} bytes",
        code: 'FIELD_TOO_LONG',
        details: { field: key, limit: max }
      )
    end

    def coerce_int(key, v)
      return v if v.is_a?(Integer)
      Integer(v, 10) # Explicitly base 10 to prevent parsing `0x10` as hex
    rescue ArgumentError, TypeError
      raise ValidationError.new(
        "Invalid integer for '#{key}': #{v.inspect}",
        code: 'INVALID_INTEGER',
        details: { field: key }
      )
    end

    def bounds(n, key, min, max)
      if min && n < min
        raise ValidationError.new(
          "Field '#{key}' value #{n} below minimum #{min}",
          code: 'BELOW_MINIMUM',
          details: { field: key, bound: :min }
        )
      end
      if max && n > max
        raise ValidationError.new(
          "Field '#{key}' value #{n} exceeds maximum #{max}",
          code: 'ABOVE_MAXIMUM',
          details: { field: key, bound: :max }
        )
      end
      n
    end
  end
  private_constant :Params

  # ---- Helpers --------------------------------------------------------------
  helpers do
    def json_body
      return @json_body if defined?(@json_body)

      @json_body = begin
        cl = request.content_length
        if cl && cl.to_i > MAX_BODY_BYTES
          raise ValidationError.new('Request body too large', code: 'PAYLOAD_TOO_LARGE')
        end

        request.body.rewind
        raw = request.body.read(MAX_BODY_BYTES + 1).to_s
        if raw.bytesize > MAX_BODY_BYTES
          raise ValidationError.new('Request body too large', code: 'PAYLOAD_TOO_LARGE')
        end

        raw.empty? ? {} : JSON.parse(raw, create_additions: false)
      rescue JSON::ParserError => e
        raise ValidationError.new("Invalid JSON: #{e.message}", code: 'INVALID_JSON')
      end
    end

    def json_params
      @json_params ||= Params.new(json_body)
    end

    def require_json_content_type!
      ct = request.content_type.to_s.split(';').first.to_s.strip.downcase
      return if ct == JSON_MIME
      raise ValidationError.new('Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE')
    end

    def json(data, status: 200)
      status status
      content_type JSON_CONTENT_TYPE
      data.to_json
    end

    def ok(data, status: 200)
      json({ success: true, data: data }, status: status)
    end

    def error_response(message, code: 'ERROR', details: nil, status: 400)
      body = { success: false, error: message, code: code }
      body[:details] = details if details
      json(body, status: status)
    end

    def request_id
      return @request_id if defined?(@request_id)

      @request_id = begin
        v = request.env['HTTP_X_REQUEST_ID'].to_s
        if v.empty? || v.bytesize > REQUEST_ID_MAXLEN || !REQUEST_ID_PATTERN.match?(v)
          SecureRandom.uuid
        else
          v
        end
      end
    end

    def cors_origin
      return @cors_origin if defined?(@cors_origin)

      @cors_origin = begin
        return '*' if !ALLOW_CREDENTIALS && ALLOWED_ORIGINS.include?('*')
        origin = request.env['HTTP_ORIGIN'].to_s
        origin if !origin.empty? && ALLOWED_ORIGINS.include?(origin)
      end
    end

    def cors_headers_for(origin)
      headers = CORS_BASE_HEADERS.merge('Access-Control-Allow-Origin' => origin)
      headers['Access-Control-Allow-Credentials'] = 'true' if ALLOW_CREDENTIALS
      headers
    end

    def response_bytes
      cl = response['Content-Length']
      return cl.to_i if cl
      body = response.body
      return body.bytesize if body.is_a?(String)
      return body.sum(&:bytesize) if body.is_a?(Array)
      0
    end
  end

  # ---- Filters --------------------------------------------------------------
  before do
    @started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    content_type JSON_CONTENT_TYPE
    request_id # memoizes @request_id

    h = SECURITY_HEADERS.dup
    h['Strict-Transport-Security'] = HSTS_VALUE if ENABLE_HSTS
    h['X-Request-Id'] = @request_id
    h['Vary'] = 'Origin'
    h.merge!(cors_headers_for(cors_origin)) if cors_origin
    response.headers.merge!(h)
  end

  before '/api/*' do
    require_json_content_type! if BODY_METHODS.include?(request.request_method)
  end

  options '*' do
    headers cors_headers_for(cors_origin) if cors_origin
    halt 204
  end

  after do
    elapsed_ms = @started_at &&
      ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - @started_at) * 1000).round(2)

    payload = {
      method:     request.request_method,
      path:       request.path_info,
      status:     response.status,
      ms:         elapsed_ms,
      request_id: @request_id,
      ip:         request.ip,
      bytes:      response_bytes,
      user_agent: request.user_agent&.slice(0, 200)
    }

    case response.status
    when 500..599 then logger.error(payload)
    when 400..499 then logger.warn(payload)
    else               logger.info(payload)
    end
  end

  # ---- Error handlers -------------------------------------------------------
  not_found do
    error_response('Route not found', code: 'NOT_FOUND', status: 404)
  end

  error ValidationError do
    err    = env['sinatra.error']
    status = STATUS_FOR_CODE.fetch(err.code, 422)
    error_response(err.message, code: err.code, details: err.details, status: status)
  end

  error PlanService::Error do
    err = env['sinatra.error']
    error_response(err.message, code: err.code || 'PLAN_ERROR', status: err.http_status || 400)
  end

  error Sinatra::BadRequest do
    error_response('Bad request', code: 'BAD_REQUEST', status: 400)
  end

  error do
    err = env['sinatra.error'] || StandardError.new('Unknown error')
    logger.error(
      klass:      err.class.name,
      message:    err.message,
      request_id: @request_id,
      method:     request.request_method,
      path:       request.path_info,
      backtrace:  err.backtrace&.first(10)
    )
    error_response('Internal server error', code: 'INTERNAL_ERROR', status: 500)
  end

  # ---- Meta routes ----------------------------------------------------------
  get '/' do
    ok(service: 'ruby-plan-api', version: VERSION, endpoints: ENDPOINTS)
  end

  get '/health' do
    uptime_s = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - STARTED_AT).round(2)
    ok(
      status:         'ok',
      service:        'ruby-plan-api',
      version:        VERSION,
      uptime_seconds: uptime_s,
      request_id:     @request_id
    )
  end

  get '/ready' do
    ok(ready: true)
  end

  # ---- Plan endpoints -------------------------------------------------------
  post '/api/plan/parse' do
    ok(PlanService.parse_plan(json_params.fetch_string('args')))
  end

  post '/api/plan/create' do
    input   = json_params
    args    = input.fetch_string('args')
    options = input.hash('options', symbolize: true)
    ok(PlanService.create_plan(args, options), status: 201)
  end

  post '/api/plan/breakdown' do
    input = json_params
    plan  = {
      title:              input.fetch_string('title'),
      goal:               input.fetch_string('goal'),
      duration_minutes:   input.int('duration_minutes',   default: PlanService::DEFAULT_PLAN_DURATION, min: 1, max: 86_400),
      chunk_size_minutes: input.int('chunk_size_minutes', default: PlanService::DEFAULT_CHUNK_SIZE,    min: 1, max: 3_600),
      break_minutes:      input.int('break_minutes',      default: PlanService::DEFAULT_BREAK_MINUTES, min: 0, max: 3_600)
    }
    tasks = PlanService.break_down_into_tasks(plan, include_breaks: input.bool('include_breaks'))
    ok(tasks: tasks)
  end

  post '/api/plan/analyze' do
    context = json_params.hash('context', symbolize: true)
    ok(PlanService.analyze_and_suggest(context))
  end

  post '/api/plan/export' do
    input  = json_params
    plan   = input.fetch_hash('plan', symbolize: true)
    format = input.string('format', default: 'json')
    ok(exported: PlanService.export_plan(plan, format), format: format)
  end

  # ---- Template endpoints ---------------------------------------------------
  post '/api/template/save' do
    input     = json_params
    name      = input.fetch_string('template_name', max: 256)
    plan_spec = input.fetch_hash('plan_spec', symbolize: true)
    ok(PlanService.save_template(name, plan_spec), status: 201)
  end

  post '/api/template/load' do
    name = json_params.fetch_string('template_name', max: 256)
    ok(plan_spec: PlanService.load_template(name))
  end

  get '/api/template/list' do
    ok(templates: PlanService.list_templates)
  end

  post '/api/template/delete' do
    name = json_params.fetch_string('template_name', max: 256)
    ok(PlanService.delete_template(name))
  end

  # ---- Session logging & stats ----------------------------------------------
  post '/api/sessions' do
    input    = json_params
    id       = input.string('session_id', default: SecureRandom.uuid)
    title    = input.string('title', default: 'Focus Session')
    duration = input.int('duration_minutes', default: 25, min: 1, max: 1440)
    event    = input.string('event', default: 'complete')
    stats_db.log_session(id, title, duration, event)
    ok(logged: true, session_id: id)
  end

  post '/api/blocked_attempts' do
    input    = json_params
    target   = input.string('target', default: 'unknown')
    category = input.string('category', default: 'social_media')
    stats_db.log_blocked_attempt(target, category)
    ok(logged: true)
  end

  get '/api/stats/weekly'  do ok(weekly_hours: stats_db.weekly_hours) end
  get '/api/stats/streaks' do ok(current_streak: stats_db.streaks) end
  get '/api/stats/blocked' do ok(blocked_count: stats_db.blocked_attempts_count) end

  get '/api/stats/summary' do
    ok(
      weekly_hours:   stats_db.weekly_hours,
      current_streak: stats_db.streaks,
      blocked_count:  stats_db.blocked_attempts_count
    )
  end

  # ---- Bot endpoints --------------------------------------------------------
  post '/api/bot/chat' do
    input   = json_params
    prompt  = input.string('prompt', default: '')
    context = input.hash('context', symbolize: true)
    ok(bot_service.process_query(prompt, context))
  end

  post '/api/bot/action' do
    input  = json_params
    type   = input.fetch_string('type')
    detail = input.string('detail', default: '')
    meta   = input.hash('meta', symbolize: true)
    ok(bot_service.log_action(type, detail, meta))
  end

  get '/api/bot/summary'         do ok(bot_service.get_memory_summary) end
  get '/api/bot/fact'            do ok(bot_service.get_random_fact) end
  get '/api/bot/motivation'      do ok(bot_service.get_motivation) end
  get '/api/bot/recommendations' do ok(bot_service.get_recommendations) end
  get '/api/bot/analytics'       do ok(bot_service.get_analytics) end

  post '/api/bot/memory/export' do ok(bot_service.export_memory) end
  post '/api/bot/memory/clear'  do ok(bot_service.clear_memory) end
end

PlanApi.run! if $PROGRAM_NAME == __FILE__