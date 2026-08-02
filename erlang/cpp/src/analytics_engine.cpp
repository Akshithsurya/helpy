#include "analytics_engine.hpp"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <ctime>
#include <format>
#include <map>
#include <numeric>
#include <optional>
#include <ranges>
#include <span>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace PlanProcessor {

// ─── Configuration ───────────────────────────────────────────────────────────
namespace config {
    inline constexpr int    default_priority         = 5;
    inline constexpr int    min_break_minutes        = 3;
    inline constexpr int    max_work_block_minutes   = 90;

    inline constexpr int    long_session_threshold   = 120;
    inline constexpr int    medium_session_threshold = 60;

    inline constexpr double productivity_base        = 50.0;
    inline constexpr double productivity_per_task    = 5.0;
    inline constexpr double max_productivity_score   = 100.0;

    struct WorkBreakPair { int work; int break_minutes; };
    inline constexpr WorkBreakPair long_session   {50, 10};
    inline constexpr WorkBreakPair medium_session {25,  5};
    inline constexpr WorkBreakPair short_session  {20, min_break_minutes};

    [[nodiscard]] constexpr WorkBreakPair
    select_default_pair(int total_minutes) noexcept {
        if (total_minutes >= long_session_threshold)   return long_session;
        if (total_minutes >= medium_session_threshold) return medium_session;
        return short_session;
    }
}

// ─── Schedule strategy ───────────────────────────────────────────────────────
enum class ScheduleStrategy {
    InsertionOrder,
    Priority,
    ReversePriority,
};

// ─── Internal helpers ────────────────────────────────────────────────────────
namespace detail {

[[nodiscard]] inline std::tm safe_localtime(std::time_t t) noexcept {
    std::tm local{};
#if defined(_WIN32)
    if (localtime_s(&local, &t) != 0) [[unlikely]] local = {};
#else
    if (std::localtime_r(&t, &local) == nullptr) [[unlikely]] local = {};
#endif
    return local;
}

[[nodiscard]] constexpr std::string_view trim_view(std::string_view s) noexcept {
    const auto first = s.find_first_not_of(" \t\n\r");
    if (first == std::string_view::npos) return {};
    const auto last = s.find_last_not_of(" \t\n\r");
    return s.substr(first, last - first + 1);
}

[[nodiscard]] constexpr std::size_t
count_trailing_backslashes(std::string_view s, std::size_t pos) noexcept {
    std::size_t n = 0;
    while (pos > 0 && s[pos - 1] == '\\') { ++n; --pos; }
    return n;
}

[[nodiscard]] constexpr bool
is_quote_unescaped(std::string_view s, std::size_t pos) noexcept {
    return (count_trailing_backslashes(s, pos) & 1U) == 0U;
}

[[nodiscard]] inline std::size_t
find_unescaped_quote(std::string_view s, std::size_t from) noexcept {
    for (std::size_t pos = s.find('"', from);
         pos != std::string_view::npos;
         pos = s.find('"', pos + 1))
    {
        if (is_quote_unescaped(s, pos)) return pos;
    }
    return std::string_view::npos;
}

// Unescape a JSON string body. Handles \" \\ \/ \n \t \r \b \f.
// \uXXXX is NOT supported — the 'u' and following hex digits are emitted
// literally.  Extend here if full Unicode support becomes necessary.
inline void append_unescaped(std::string& out, std::string_view raw) {
    out.reserve(out.size() + raw.size());
    bool escaping = false;
    for (const char c : raw) {
        if (escaping) {
            switch (c) {
                case '"':  out.push_back('"');  break;
                case '\\': out.push_back('\\'); break;
                case '/':  out.push_back('/');  break;
                case 'n':  out.push_back('\n'); break;
                case 't':  out.push_back('\t'); break;
                case 'r':  out.push_back('\r'); break;
                case 'b':  out.push_back('\b'); break;
                case 'f':  out.push_back('\f'); break;
                default:   out.push_back(c);    break;  // unknown — keep literal
            }
            escaping = false;
        } else if (c == '\\') {
            escaping = true;
        } else {
            out.push_back(c);
        }
    }
}

// ─── Value extraction ────────────────────────────────────────────────────────
// Each extractor returns std::optional<T> where T carries both the decoded
// value and the position immediately past the closing delimiter — far
// clearer than returning a pair whose position field uses npos as a sentinel.

struct QuotedValue {
    std::string content;
    std::size_t next_pos;
};

struct StringArray {
    std::vector<std::string> values;
    std::size_t next_pos;
};

[[nodiscard]] inline std::optional<QuotedValue>
extract_quoted_value(std::string_view s, std::size_t open_quote) {
    const auto close = find_unescaped_quote(s, open_quote + 1);
    if (close == std::string_view::npos) return std::nullopt;
    std::string content;
    append_unescaped(content, s.substr(open_quote + 1, close - open_quote - 1));
    return QuotedValue{std::move(content), close + 1};
}

[[nodiscard]] inline std::size_t
find_array_close(std::string_view s, std::size_t open_bracket) noexcept {
    std::size_t pos = open_bracket + 1;
    while (pos < s.size()) {
        const char c = s[pos];
        if (c == '"') {
            const auto close = find_unescaped_quote(s, pos);
            if (close == std::string_view::npos) return std::string_view::npos;
            pos = close + 1;
        } else if (c == ']') {
            return pos;
        } else {
            ++pos;
        }
    }
    return std::string_view::npos;
}

[[nodiscard]] inline std::optional<StringArray>
extract_string_array(std::string_view s, std::size_t open_bracket) {
    const auto close = find_array_close(s, open_bracket);
    if (close == std::string_view::npos) return std::nullopt;

    StringArray result{{}, close + 1};
    if (close == open_bracket + 1) return result;  // empty array "[]"

    const auto body = s.substr(open_bracket + 1, close - open_bracket - 1);
    std::size_t pos = 0;
    while ((pos = find_unescaped_quote(body, pos)) != std::string_view::npos) {
        auto val = extract_quoted_value(body, pos);
        if (!val) break;
        if (!val->content.empty()) result.values.push_back(std::move(val->content));
        pos = val->next_pos;
    }
    return result;
}

[[nodiscard]] inline std::optional<int>
parse_int(std::string_view s) noexcept {
    s = trim_view(s);
    if (s.empty()) return std::nullopt;
    int value = 0;
    const auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), value);
    if (ec != std::errc{} || ptr != s.data() + s.size()) return std::nullopt;
    return value;
}

// ─── Flat JSON object parser ─────────────────────────────────────────────────
struct ParsedPlan {
    std::map<std::string, std::string> fields;
    std::vector<std::string>           tags;
};

// Single-pass parser for flat JSON objects.  String, array, and bare values
// are recognised.  Arrays are fully decoded only for the "tags" key — all
// other arrays are skipped without extracting their string contents, which
// avoids unnecessary heap allocations on fields we never inspect.
[[nodiscard]] inline ParsedPlan parse_plan(std::string_view raw_json) {
    ParsedPlan result;

    std::size_t pos = 0;
    while ((pos = find_unescaped_quote(raw_json, pos)) != std::string_view::npos) {
        // ── Key ──
        auto key = extract_quoted_value(raw_json, pos);
        if (!key) break;

        // ── Colon separator ──
        const auto colon = raw_json.find(':', key->next_pos);
        if (colon == std::string_view::npos) break;

        // ── Value ──
        const auto value_start = raw_json.find_first_not_of(" \t\n\r", colon + 1);
        if (value_start == std::string_view::npos) break;

        const char v0 = raw_json[value_start];

        if (v0 == '"') {
            auto val = extract_quoted_value(raw_json, value_start);
            if (!val) break;
            result.fields.emplace(std::move(key->content), std::move(val->content));
            pos = val->next_pos;
        } else if (v0 == '[') {
            if (key->content == "tags") {
                auto arr = extract_string_array(raw_json, value_start);
                if (!arr) break;
                result.tags = std::move(arr->values);
                pos = arr->next_pos;
            } else {
                // Skip non-tags arrays without decoding their contents.
                const auto close = find_array_close(raw_json, value_start);
                if (close == std::string_view::npos) break;
                pos = close + 1;
            }
        } else {
            // Bare value (number / bool / null)
            const auto value_end = raw_json.find_first_of(",}", value_start);
            if (value_end == std::string_view::npos) {
                result.fields.emplace(std::move(key->content),
                    std::string(trim_view(raw_json.substr(value_start))));
                break;
            }
            result.fields.emplace(std::move(key->content),
                std::string(trim_view(raw_json.substr(value_start,
                                                      value_end - value_start))));
            pos = value_end;
        }
    }

    return result;
}

} // namespace detail

// ─── Public API ──────────────────────────────────────────────────────────────

[[nodiscard]] PlanStats AnalyticsEngine::analyze_plans(
    std::span<const std::string> plan_jsons,
    std::optional<int> time_of_day)
{
    PlanStats stats;

    if (plan_jsons.empty()) {
        stats.suggestions = {
            "Start creating your first plan!",
            "Try using presets like 'work' or 'study'",
            "Consider adding tags to organize your plans"
        };
        return stats;
    }

    int total_duration = 0;
    std::map<std::string, int> tag_counts;

    for (const auto& raw_json : plan_jsons) {
        auto parsed = detail::parse_plan(raw_json);
        if (parsed.fields.empty() && parsed.tags.empty()) continue;

        ++stats.total_plans;

        if (const auto it = parsed.fields.find("status");
            it != parsed.fields.end() && it->second == "completed")
        {
            ++stats.completed_plans;
        }

        if (const auto it = parsed.fields.find("duration_minutes");
            it != parsed.fields.end())
        {
            if (const auto dur = detail::parse_int(it->second)) {
                total_duration += *dur;
            }
        }

        for (auto& tag : parsed.tags) {
            ++tag_counts[std::move(tag)];
        }
    }

    if (stats.total_plans > 0) {
        stats.completion_rate =
            (static_cast<double>(stats.completed_plans) / stats.total_plans) * 100.0;
        stats.average_duration_minutes =
            static_cast<double>(total_duration) / stats.total_plans;
    }
    stats.popular_tags = std::move(tag_counts);

    // Lazily resolve the current hour only when the caller didn't supply one.
    const int hour = time_of_day.has_value()
        ? *time_of_day
        : detail::safe_localtime(
              std::chrono::system_clock::to_time_t(
                  std::chrono::system_clock::now())).tm_hour;

    auto time_suggestions    = generate_time_suggestions(hour);
    auto history_suggestions = generate_history_suggestions(
        static_cast<int>(stats.average_duration_minutes),
        stats.popular_tags);

    stats.suggestions.reserve(
        time_suggestions.size() + history_suggestions.size());
    for (auto& s : time_suggestions)    stats.suggestions.push_back(std::move(s));
    for (auto& s : history_suggestions) stats.suggestions.push_back(std::move(s));

    return stats;
}

[[nodiscard]] TimeOptimization AnalyticsEngine::optimize_time(
    int total_work_minutes,
    std::optional<int> preferred_block_size)
{
    if (total_work_minutes <= 0) {
        return {.recommendation = "No work time to schedule"};
    }

    TimeOptimization result{};

    const auto [default_work, default_break] =
        config::select_default_pair(total_work_minutes);
    result.optimal_work_minutes  = default_work;
    result.optimal_break_minutes = default_break;

    if (preferred_block_size && *preferred_block_size > 0 &&
        *preferred_block_size <= config::max_work_block_minutes)
    {
        result.optimal_work_minutes  = *preferred_block_size;
        result.optimal_break_minutes =
            std::max(config::min_break_minutes, *preferred_block_size / 5);
    }

    result.num_blocks        = total_work_minutes / result.optimal_work_minutes;
    result.remaining_minutes = total_work_minutes % result.optimal_work_minutes;

    if (result.num_blocks > 0) {
        // Build the optional "plus a final N minute block" suffix separately
        // so the main format string stays readable.
        const auto suffix = result.remaining_minutes > 0
            ? std::format(", plus a final {} minute block", result.remaining_minutes)
            : std::string{};

        result.recommendation = std::format(
            "For {} minutes, we recommend {} block{} of {} minutes work "
            "with {} minute break{}{}",
            total_work_minutes,
            result.num_blocks,
            result.num_blocks != 1 ? "s" : "",
            result.optimal_work_minutes,
            result.optimal_break_minutes,
            result.optimal_break_minutes != 1 ? "s" : "",
            suffix);
    } else {
        // Work time is shorter than one optimal block — do it all at once.
        result.optimal_work_minutes  = total_work_minutes;
        result.optimal_break_minutes = 0;
        result.num_blocks            = 1;
        result.remaining_minutes     = 0;
        result.recommendation = std::format(
            "For {} minutes, we recommend a single {} minute block",
            total_work_minutes, total_work_minutes);
    }

    return result;
}

[[nodiscard]] double AnalyticsEngine::calculate_productivity_score(
    std::size_t completed_count) noexcept
{
    return std::clamp(
        config::productivity_base
            + static_cast<double>(completed_count) * config::productivity_per_task,
        0.0,
        config::max_productivity_score);
}

[[nodiscard]] std::vector<std::string> AnalyticsEngine::schedule_tasks(
    std::span<const std::string> tasks,
    std::span<const int> priorities,
    ScheduleStrategy strategy)
{
    if (tasks.empty()) return {};

    if (strategy == ScheduleStrategy::InsertionOrder) {
        return {tasks.begin(), tasks.end()};
    }

    std::vector<std::size_t> order(tasks.size());
    std::iota(order.begin(), order.end(), std::size_t{0});

    const auto priority_of = [&](std::size_t idx) noexcept {
        return (idx < priorities.size())
                   ? priorities[idx]
                   : config::default_priority;
    };

    if (strategy == ScheduleStrategy::Priority) {
        std::ranges::stable_sort(order, std::less{},    priority_of);
    } else {
        std::ranges::stable_sort(order, std::greater{}, priority_of);
    }

    std::vector<std::string> result;
    result.reserve(order.size());
    for (const auto idx : order) result.push_back(tasks[idx]);
    return result;
}

[[nodiscard]] std::map<std::string, std::string>
AnalyticsEngine::parse_plan_json(std::string_view raw_json) {
    return detail::parse_plan(raw_json).fields;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

[[nodiscard]] std::vector<std::string>
AnalyticsEngine::generate_time_suggestions(int hour) {
    static constexpr std::string_view messages[] = {
        "Late hours: Consider light tasks only",
        "Morning is a great time for focus work!",
        "Afternoon: Consider shorter focus blocks with breaks",
        "Evening: Good for review and planning tasks",
    };

    const auto idx = hour < 6  ? std::size_t{0} :
                     hour < 12 ? std::size_t{1} :
                     hour < 17 ? std::size_t{2} :
                     hour < 22 ? std::size_t{3} :
                                 std::size_t{0};
    return {std::string{messages[idx]}};
}

[[nodiscard]] std::vector<std::string>
AnalyticsEngine::generate_history_suggestions(
    int avg_duration,
    const std::map<std::string, int>& tag_counts)
{
    std::vector<std::string> suggestions;
    suggestions.reserve(2);

    if (avg_duration > 0) {
        suggestions.emplace_back(std::format(
            "Your optimal plan duration seems to be around {} minutes",
            avg_duration));
    }

    if (!tag_counts.empty()) {
        const auto& [top_key, top_count] = *std::ranges::max_element(
            tag_counts, {}, &std::pair<const std::string, int>::second);

        suggestions.emplace_back(std::format(
            "You often use the '{}' tag ({}) — consider creating a template!",
            top_key, top_count));
    }

    return suggestions;
}

} // namespace PlanProcessor