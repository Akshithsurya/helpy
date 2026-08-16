#include "plan_validator_enhanced.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <numeric>
#include <ranges>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

// ---------- Thresholds (centralised, no magic numbers) ----------
namespace thresholds {
    constexpr int MIN_DURATION_MIN         = 5;
    constexpr int MAX_DURATION_MIN         = 240;
    constexpr int MIN_CHUNK_MIN            = 5;
    constexpr int SMALL_CHUNK_MIN          = 20;
    constexpr int LARGE_CHUNK_MIN          = 50;
    constexpr int MAX_CHUNK_MIN            = 60;
    constexpr int NO_BREAK_CHUNK_LIMIT     = 25;

    constexpr int BASE_SCORE               = 100;
    constexpr int ERROR_PENALTY            = 25;
    constexpr int WARNING_PENALTY          = 10;
    constexpr int INFO_PENALTY             = 2;

    // Capacity heuristics — named instead of inline magic numbers.
    constexpr std::size_t TYPICAL_ISSUE_COUNT      = 8;
    constexpr std::size_t TYPICAL_SUGGESTION_COUNT = 4;
    constexpr std::size_t JSON_BASE_CAPACITY       = 512;
    constexpr std::size_t JSON_PER_ISSUE_CAPACITY  = 128;
}  // namespace thresholds

using namespace std::literals::string_view_literals;

// Lightweight string builder with efficient numeric formatting via std::to_chars.
class StringBuilder {
public:
    StringBuilder() = default;
    explicit StringBuilder(std::size_t capacity) { data_.reserve(capacity); }

    StringBuilder& append(std::string_view s) {
        data_.append(s);
        return *this;
    }

    StringBuilder& operator<<(std::string_view s) { return append(s); }
    StringBuilder& operator<<(char c)             { data_.push_back(c); return *this; }
    StringBuilder& operator<<(bool v)             { return append(v ? "true"sv : "false"sv); }

    StringBuilder& operator<<(int v) {
        std::array<char, 16> buf{};
        const auto [ptr, ec] = std::to_chars(buf.data(), buf.data() + buf.size(), v);
        if (ec == std::errc()) [[likely]]
            data_.append(buf.data(), static_cast<std::size_t>(ptr - buf.data()));
        return *this;
    }

    [[nodiscard]] std::string release() { return std::move(data_); }

private:
    std::string data_;
};

void json_escape(StringBuilder& sb, std::string_view s) {
    constexpr std::string_view hex_chars = "0123456789abcdef"sv;

    const auto* it    = s.data();
    const auto* end   = s.data() + s.size();

    while (it != end) {
        const auto* chunk_start = it;

        // Scan forward to the next character that needs escaping.
        while (it != end) {
            const auto c = static_cast<unsigned char>(*it);
            if (c < 0x20 || c == '"' || c == '\\') break;
            ++it;
        }

        if (it != chunk_start)
            sb.append(std::string_view(chunk_start, static_cast<std::size_t>(it - chunk_start)));

        if (it == end) [[unlikely]]
            break;

        const auto c = static_cast<unsigned char>(*it);
        switch (c) {
            case '"':  sb.append("\\\""sv); break;
            case '\\': sb.append("\\\\"sv); break;
            case '\b': sb.append("\\b"sv);  break;
            case '\f': sb.append("\\f"sv);  break;
            case '\n': sb.append("\\n"sv);  break;
            case '\r': sb.append("\\r"sv);  break;
            case '\t': sb.append("\\t"sv);  break;
            default: {
                // c < 0x20 here, so it fits in \u00XX form.
                std::array<char, 6> hex{ '\\','u','0','0','0','0' };
                hex[4] = hex_chars[(c >> 4) & 0xF];
                hex[5] = hex_chars[c & 0xF];
                sb.append(std::string_view(hex.data(), hex.size()));
                break;
            }
        }
        ++it;
    }
}

void json_kv_string(StringBuilder& sb, std::string_view key, std::string_view value) {
    sb << '"' << key << "\":\""sv;
    json_escape(sb, value);
    sb << '"';
}

[[nodiscard]] constexpr std::string_view severity_to_string(
    PlanValidatorEnhanced::ValidationSeverity s) noexcept
{
    using S = PlanValidatorEnhanced::ValidationSeverity;
    switch (s) {
        case S::ERROR:   return "error"sv;
        case S::WARNING: return "warning"sv;
        case S::INFO:    return "info"sv;
        default:         return "success"sv;
    }
}

// Extracted so penalty values live in one place and are reusable.
[[nodiscard]] constexpr int severity_penalty(
    PlanValidatorEnhanced::ValidationSeverity s) noexcept
{
    namespace t = thresholds;
    using S = PlanValidatorEnhanced::ValidationSeverity;
    switch (s) {
        case S::ERROR:   return t::ERROR_PENALTY;
        case S::WARNING: return t::WARNING_PENALTY;
        case S::INFO:    return t::INFO_PENALTY;
        default:         return 0;
    }
}

}  // namespace

namespace PlanValidatorEnhanced {

EnhancedValidator::EnhancedValidator() = default;

void EnhancedValidator::check_duration_constraints(const PlanProcessor::FullPlan& plan,
                                                   std::vector<ValidationIssue>& issues) {
    namespace t = thresholds;
    if (plan.duration_minutes < t::MIN_DURATION_MIN) {
        issues.push_back({
            .severity   = ValidationSeverity::WARNING,
            .code       = "DURATION_TOO_SHORT"sv,
            .message    = "Plan duration is very short"sv,
            .suggestion = "Consider increasing to at least 10 minutes for meaningful work"sv,
        });
    } else if (plan.duration_minutes > t::MAX_DURATION_MIN) {
        issues.push_back({
            .severity   = ValidationSeverity::WARNING,
            .code       = "DURATION_TOO_LONG"sv,
            .message    = "Long duration plan may cause fatigue"sv,
            .suggestion = "Consider splitting into multiple shorter sessions"sv,
        });
    }

    if (plan.chunk_size_minutes < t::MIN_CHUNK_MIN) {
        issues.push_back({
            .severity   = ValidationSeverity::INFO,
            .code       = "CHUNK_SIZE_SMALL"sv,
            .message    = "Very small focus chunks"sv,
            .suggestion = "Consider 20-30 minute chunks for better focus"sv,
        });
    } else if (plan.chunk_size_minutes > t::MAX_CHUNK_MIN) {
        issues.push_back({
            .severity   = ValidationSeverity::WARNING,
            .code       = "CHUNK_SIZE_LARGE"sv,
            .message    = "Focus chunks may be too long to maintain concentration"sv,
            .suggestion = "Consider reducing to 30-50 minutes with regular breaks"sv,
        });
    }
}

void EnhancedValidator::check_task_distribution(const PlanProcessor::FullPlan& plan,
                                                std::vector<ValidationIssue>& issues) {
    if (plan.tasks.empty()) {
        issues.push_back({
            .severity   = ValidationSeverity::ERROR,
            .code       = "NO_TASKS"sv,
            .message    = "Plan has no tasks"sv,
            .suggestion = "Generate a valid plan with tasks first"sv,
        });
        return;
    }

    const bool has_work_tasks = std::ranges::any_of(
        plan.tasks, [](const auto& task) noexcept { return !task.is_break; });

    if (!has_work_tasks) {
        issues.push_back({
            .severity   = ValidationSeverity::WARNING,
            .code       = "NO_WORK_TASKS"sv,
            .message    = "Plan consists entirely of breaks"sv,
            .suggestion = "Ensure the plan contains actual work tasks"sv,
        });
    }
}

void EnhancedValidator::check_break_pattern(const PlanProcessor::FullPlan& plan,
                                            std::vector<ValidationIssue>& issues) {
    if (plan.break_minutes == 0 &&
        plan.chunk_size_minutes > thresholds::NO_BREAK_CHUNK_LIMIT) {
        issues.push_back({
            .severity   = ValidationSeverity::WARNING,
            .code       = "NO_BREAKS"sv,
            .message    = "No scheduled breaks in a relatively long session"sv,
            .suggestion = "Add 5-10 minute breaks every 25-50 minutes"sv,
        });
    }
}

void EnhancedValidator::check_goal_clarity(const PlanProcessor::FullPlan& plan,
                                           std::vector<ValidationIssue>& issues) {
    if (plan.goal.empty()) {
        issues.push_back({
            .severity   = ValidationSeverity::INFO,
            .code       = "NO_GOAL"sv,
            .message    = "Plan has no specific goal defined"sv,
            .suggestion = "Adding a goal can improve focus and motivation"sv,
        });
    }
}

int EnhancedValidator::compute_overall_score(
    const std::vector<ValidationIssue>& issues) noexcept
{
    const int total_penalty = std::accumulate(
        issues.begin(), issues.end(), 0,
        [](int acc, const ValidationIssue& issue) noexcept {
            return acc + severity_penalty(issue.severity);
        });
    return std::clamp(thresholds::BASE_SCORE - total_penalty,
                      0, thresholds::BASE_SCORE);
}

ValidationReport EnhancedValidator::validate(const PlanProcessor::FullPlan& plan,
                                             bool strict_mode) {
    ValidationReport report{};
    report.issues.reserve(thresholds::TYPICAL_ISSUE_COUNT);

    check_duration_constraints(plan, report.issues);
    check_task_distribution(plan, report.issues);
    check_break_pattern(plan, report.issues);
    check_goal_clarity(plan, report.issues);

    const bool has_blocking_issue = std::ranges::any_of(report.issues,
        [strict_mode](const ValidationIssue& issue) noexcept {
            return issue.severity == ValidationSeverity::ERROR ||
                   (strict_mode && issue.severity == ValidationSeverity::WARNING);
        });
    report.valid = !has_blocking_issue;
    report.score = compute_overall_score(report.issues);
    return report;
}

ValidationReport EnhancedValidator::validate_and_suggest(
    const PlanProcessor::FullPlan& plan)
{
    ValidationReport report = validate(plan);
    report.improvements = suggest_improvements(plan);
    return report;
}

std::string EnhancedValidator::calculate_quality_score(
    const PlanProcessor::FullPlan& plan)
{
    const auto report = validate(plan);
    StringBuilder sb(4);
    sb << report.score;
    return sb.release();
}

std::vector<std::string> EnhancedValidator::suggest_improvements(
    const PlanProcessor::FullPlan& plan)
{
    namespace t = thresholds;
    std::vector<std::string> suggestions;
    suggestions.reserve(t::TYPICAL_SUGGESTION_COUNT);
    suggestions.emplace_back("Consider using Pomodoro-style breaks");
    if (plan.chunk_size_minutes < t::SMALL_CHUNK_MIN) {
        suggestions.emplace_back("Try longer focus blocks for deeper work");
    } else if (plan.chunk_size_minutes > t::LARGE_CHUNK_MIN) {
        suggestions.emplace_back("Shorter chunks may improve focus retention");
    }
    if (plan.goal.empty()) {
        suggestions.emplace_back("Define a clear goal for this session");
    }
    return suggestions;
}

std::string EnhancedValidator::report_to_json(const ValidationReport& report) const {
    StringBuilder sb(
        thresholds::JSON_BASE_CAPACITY +
        report.issues.size() * thresholds::JSON_PER_ISSUE_CAPACITY);

    sb << "{\"valid\":"sv << report.valid
       << ",\"score\":"sv << report.score
       << ",\"issues\":["sv;

    // Separator-idiom replaces the bool "first" flag pattern.
    std::string_view sep = ""sv;
    for (const auto& issue : report.issues) {
        sb << sep;
        sep = ","sv;
        sb << '{';
        json_kv_string(sb, "code",       issue.code);
        sb << ',';
        json_kv_string(sb, "message",    issue.message);
        sb << ',';
        json_kv_string(sb, "suggestion", issue.suggestion);
        sb << ',';
        json_kv_string(sb, "severity",   severity_to_string(issue.severity));
        sb << '}';
    }

    sb << "],\"improvements\":["sv;
    sep = ""sv;
    for (const auto& imp : report.improvements) {
        sb << sep;
        sep = ","sv;
        sb << '"';
        json_escape(sb, imp);
        sb << '"';
    }
    sb << "]}";
    return sb.release();
}

}  // namespace PlanValidatorEnhanced