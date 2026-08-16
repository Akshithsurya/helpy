# frozen_string_literal: true

require 'json'
require 'net/http'
require 'uri'

class LlmClient
  DEFAULT_TIMEOUT_MS = 8_000

  def initialize(env = ENV)
    @enabled = truthy?(env.fetch('HELPY_LLM_ENABLED', 'false'))
    @base_url = env.fetch('HELPY_LLM_BASE_URL', '').to_s.strip
    @api_key = env.fetch('HELPY_LLM_API_KEY', '').to_s.strip
    @model = env.fetch('HELPY_LLM_MODEL', '').to_s.strip
    @timeout_ms = Integer(env.fetch('HELPY_LLM_TIMEOUT_MS', DEFAULT_TIMEOUT_MS))
  rescue ArgumentError, TypeError
    @timeout_ms = DEFAULT_TIMEOUT_MS
  end

  attr_reader :model

  def available?
    @enabled && configured?
  end

  def configured?
    [@base_url, @api_key, @model].all? { |value| !value.empty? }
  end

  def complete(messages:, temperature: 0.2, max_tokens: 700)
    raise 'LLM adapter is not configured' unless available?

    uri = URI(resolve_endpoint(@base_url))
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == 'https'
    http.open_timeout = @timeout_ms / 1000.0
    http.read_timeout = @timeout_ms / 1000.0

    request = Net::HTTP::Post.new(uri)
    request['Content-Type'] = 'application/json'
    request['Authorization'] = "Bearer #{@api_key}"
    request.body = JSON.generate(
      model: @model,
      messages: normalize_messages(messages),
      temperature: temperature,
      max_tokens: max_tokens
    )

    response = http.request(request)
    raise "LLM request failed with #{response.code}" unless response.is_a?(Net::HTTPSuccess)

    payload = JSON.parse(response.body)
    {
      'content' => extract_content(payload),
      'raw' => payload
    }
  end

  private

  def normalize_messages(messages)
    Array(messages).filter_map do |message|
      next unless message.is_a?(Hash)

      role = message[:role] || message['role']
      content = message[:content] || message['content']
      next if role.to_s.strip.empty? || content.to_s.strip.empty?

      { role: role.to_s, content: content.to_s }
    end
  end

  def resolve_endpoint(base_url)
    return base_url if base_url.end_with?('/chat/completions')
    return "#{base_url}chat/completions" if base_url.end_with?('/')

    "#{base_url}/chat/completions"
  end

  def extract_content(payload)
    choice = Array(payload['choices']).first || {}
    message = choice['message'] || {}
    content = message['content']
    return flatten_content(content) unless content.nil?

    payload['output_text'].to_s
  end

  def flatten_content(content)
    case content
    when String
      content
    when Array
      content.filter_map do |part|
        next part['text'] if part.is_a?(Hash) && part['text']
        next part[:text] if part.is_a?(Hash) && part[:text]

        nil
      end.join("\n")
    else
      content.to_s
    end
  end

  def truthy?(value)
    %w[1 true yes on].include?(value.to_s.strip.downcase)
  end
end
