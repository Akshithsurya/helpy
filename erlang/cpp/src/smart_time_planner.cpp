#include "smart_time_planner.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <limits>
#include <random>
#include <string>
#include <string_view>
#include <utility>

namespace {

// -----------------------------------------------------------------------------
// Named constants — eliminates magic numbers throughout the file
// -----------------------------------------------------------------------------

inline constexpr int    kDefaultChunkSize       = 25;
inline constexpr int    kMinChunkSize           = 10;
inline constexpr int    kMinBreakMinutes        = 3;
inline constexpr int    kMaxBreakMinutes        = 10;
inline constexpr double kIdealBreakRatio        = 0.20;  // 5 min break per 25 min work
inline constexpr double kMinEfficiencyScore     = 0.50;
inline constexpr double kMaxEfficiencyScore     = 0.95;
inline constexpr double kBreakRatioPenalty      = 2.0;
inline constexpr double kDefaultEfficiencyScore = 0.75;
inline constexpr double kDefaultFocusScore      = 0.70;

// Chunk sizes in descending order — iteration naturally finds the largest first.
inline constexpr std::array<int, 8> kChunkOptions = {50, 45, 40, 30, 25, 20, 15, 10};

// Shared hex lookup table — used by both ID generation and JSON escaping.
inline constexpr char kHexChars[] = "0123456789abcdef";

// -----------------------------------------------------------------------------
// StringBuilder — efficient append-only builder with JSON support
// -----------------------------------------------------------------------------

class StringBuilder {
public:
    StringBuilder() = default;
    explicit StringBuilder(std::size_t capacity) { buf_.reserve(capacity); }

    StringBuilder(const StringBuilder&)            = delete;
    StringBuilder& operator=(const StringBuilder&) = delete;
    StringBuilder(StringBuilder&&)                 = default;
    StringBuilder& operator=(StringBuilder&&)      = default;

    void reserve(std::size_t capacity) { buf_.reserve(capacity); }
    void clear() noexcept              { buf_.clear(); }

    // --- Raw append ---

    StringBuilder& append(const char* s, std::size_t n) {
        buf_.append(s, n);
        return *this;
    }
    StringBuilder& append(std::string_view s) {
        buf_.append(s);
        return *this;
    }

    // --- Streaming operators ---

    StringBuilder& operator<<(char c) {
        buf_.push_back(c);
        return *this;
    }
    StringBuilder& operator<<(const char* s) {
        if (s) buf_.append(s);
        return *this;
    }
    StringBuilder& operator<<(std::string_view s) {
        buf_.append(s);
        return *this;
    }
    StringBuilder& operator<<(const std::string& s) {
        buf_.append(s);
        return *this;
    }
    StringBuilder& operator<<(bool v) {
        buf_.append(v ? "true" : "false");
        return *this;
    }
    StringBuilder& operator<<(int v)                { append_integer(v); return *this; }
    StringBuilder& operator<<(unsigned int v)       { append_integer(v); return *this; }
    StringBuilder& operator<<(long long v)          { append_integer(v); return *this; }
    StringBuilder& operator<<(unsigned long long v) { append_integer(v); return *this; }
    StringBuilder& operator<<(std::size_t v)        { append_integer(v); return *this; }

    StringBuilder& operator<<(double v) {
        char tmp[64];
        if (std::isfinite(v)) {
            const auto [ptr, ec] = std::to_chars(
                tmp, tmp + sizeof(tmp), v, std::chars_format::fixed, 2);
            if (ec == std::errc()) {
                buf_.append(tmp, static_cast<std::size_t>(ptr - tmp));
                return *this;
            }
        }
        buf_.append("null");
        return *this;
    }

    // --- JSON convenience methods ---

    StringBuilder& json_key(std::string_view key) {
        buf_.push_back('"');
        json_escape(key);
        buf_.append("\":", 2);
        return *this;
    }

    StringBuilder& json_string(std::string_view value) {
        buf_.push_back('"');
        json_escape(value);
        buf_.push_back('"');
        return *this;
    }

    StringBuilder& json_kv(std::string_view key, std::string_view value) {
        json_key(key);
        json_string(value);
        return *this;
    }

    StringBuilder& json_kv(std::string_view key, bool value) {
        json_key(key);
        buf_.append(value ? "true" : "false");
        return *this;
    }

    StringBuilder& json_kv(std::string_view key, int value) {
        json_key(key);
        append_integer(value);
        return *this;
    }

    StringBuilder& json_kv(std::string_view key, std::size_t value) {
        json_key(key);
        append_integer(value);
        return *this;
    }

    StringBuilder& json_kv(std::string_view key, double value) {
        json_key(key);
        *this << value;
        return *this;
    }

    // --- Accessors ---

    [[nodiscard]] const char* c_str() const noexcept { return buf_.c_str(); }
    [[nodiscard]] std::size_t size() const noexcept  { return buf_.size(); }
    [[nodiscard]] std::string release()              { return std::move(buf_); }

private:
    template <typename T>
    void append_integer(T v) {
        // Buffer is large enough for any integer type (max 20 digits + sign).
        // std::to_chars for integers never fails with this buffer size.
        char tmp[24];
        const auto [ptr, ec] = std::to_chars(tmp, tmp + sizeof(tmp), v);
        if (ec == std::errc()) {
            buf_.append(tmp, static_cast<std::size_t>(ptr - tmp));
        }
    }

    // Escapes a string for a JSON string literal (RFC 8259).
    // U+0000..U+001F, '"' and '\\' are escaped; bytes >= 0x80 pass through
    // to preserve UTF-8 content.
    void json_escape(std::string_view s) {
        if (s.empty()) return;

        const char* const src = s.data();
        const std::size_t len = s.size();
        std::size_t i = 0;

        while (i < len) {
            // Fast-scan: copy runs of characters that need no escaping.
            const std::size_t run_start = i;
            while (i < len) {
                const unsigned char c = static_cast<unsigned char>(src[i]);
                if (c < 0x20 || c == '"' || c == '\\') break;
                ++i;
            }
            if (i > run_start) {
                buf_.append(src + run_start, i - run_start);
            }
            if (i == len) break;

            // Escape the character at position i.
            const unsigned char c = static_cast<unsigned char>(src[i]);
            switch (c) {
                case '"':  buf_.append("\\\"", 2); break;
                case '\\': buf_.append("\\\\", 2); break;
                case '\b': buf_.append("\\b", 2);  break;
                case '\f': buf_.append("\\f", 2);  break;
                case '\n': buf_.append("\\n", 2);  break;
                case '\r': buf_.append("\\r", 2);  break;
                case '\t': buf_.append("\\t", 2);  break;
                default: { // Remaining control characters (< 0x20) → \u00XX
                    char hex[6] = {
                        '\\', 'u', '0', '0',
                        kHexChars[(c >> 4) & 0xF],
                        kHexChars[c & 0xF]
                    };
                    buf_.append(hex, 6);
                    break;
                }
            }
            ++i;
        }
    }

    std::string buf_;
};

// -----------------------------------------------------------------------------
// PRNG / ID generation
// -----------------------------------------------------------------------------

// Thread-local Mersenne Twister seeded via std::random_device for
// better entropy than clock-based seeding.
unsigned int rng_next() noexcept {
    thread_local std::mt19937 gen{[] {
        std::random_device rd;
        return rd();
    }()};
    return gen();
}

std::string generate_slot_id() {
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

    std::string id;
    id.reserve(40);
    id.append("slot-");

    // Epoch-milliseconds as decimal (locale-independent).
    char num_buf[24];
    const auto [ptr, ec] = std::to_chars(
        num_buf, num_buf + sizeof(num_buf), static_cast<long long>(ms));
    if (ec == std::errc()) {
        id.append(num_buf, static_cast<std::size_t>(ptr - num_buf));
    }
    id.push_back('-');

    // 8 hex digits from the PRNG.
    unsigned int r = rng_next();
    for (int i = 0; i < 8; ++i, r >>= 4) {
        id.push_back(kHexChars[r & 0xF]);
    }

    return id;
}

// -----------------------------------------------------------------------------
// Slot construction helper — eliminates duplication across schedule methods
// -----------------------------------------------------------------------------

template <typename TaskLike>
[[nodiscard]] TimeSlot make_time_slot(const TaskLike& task, int start_minute) {
    TimeSlot slot;
    slot.id               = generate_slot_id();
    slot.start_minute     = start_minute;
    slot.duration_minutes = task.duration_minutes;
    slot.task_id          = task.id;
    slot.task_title       = task.title;
    slot.is_break         = task.is_break;
    return slot;
}

} // anonymous namespace

// =============================================================================
// SmartPlanner implementation
// =============================================================================

namespace SmartTimePlanner {

SmartPlanner::SmartPlanner() = default;

int SmartPlanner::calculate_optimal_chunk(int available_time, int desired_duration,
                                          [[maybe_unused]] int break_ratio) {
    if (available_time <= 0 || desired_duration <= 0) {
        return kDefaultChunkSize;
    }

    // kChunkOptions is sorted descending, so the first fitting chunk is the
    // largest.  We want:
    //   1. The largest chunk fitting BOTH constraints (≤ available_time AND
    //      ≤ desired_duration) — this is also the closest to desired_duration.
    //   2. Fallback: largest chunk fitting available_time alone.
    //   3. Last resort: kMinChunkSize.
    int largest_avail = -1;
    for (const int chunk : kChunkOptions) {
        if (chunk > available_time) continue;
        if (largest_avail < 0) largest_avail = chunk;  // first = largest
        if (chunk <= desired_duration) return chunk;    // best fit — early exit
    }

    if (largest_avail >= 0) return largest_avail;
    return kMinChunkSize;
}

bool SmartPlanner::is_slot_available(int slot_start, int slot_duration,
                                     const std::vector<std::pair<int, int>>& busy_slots) noexcept {
    if (slot_duration <= 0) return false;
    const int slot_end = slot_start + slot_duration;
    for (const auto& [busy_start, busy_end] : busy_slots) {
        if (busy_end <= busy_start) continue; // Skip degenerate ranges.
        // Half-open interval overlap test.
        if (slot_start < busy_end && slot_end > busy_start) {
            return false;
        }
    }
    return true;
}

ScheduleResult SmartPlanner::generate_schedule(const PlanProcessor::FullPlan& plan,
                                               int start_hour, int start_minute) {
    ScheduleResult result;
    result.success                       = true;
    result.total_time_available_minutes  = plan.duration_minutes;
    result.total_work_minutes            = 0;
    result.total_break_minutes           = 0;

    const int clamped_hour   = std::clamp(start_hour,   0, 23);
    const int clamped_minute = std::clamp(start_minute, 0, 59);
    int current_minute = clamped_hour * 60 + clamped_minute;

    result.slots.reserve(plan.tasks.size());

    for (const auto& task : plan.tasks) {
        result.slots.push_back(make_time_slot(task, current_minute));

        if (task.is_break) result.total_break_minutes += task.duration_minutes;
        else               result.total_work_minutes   += task.duration_minutes;

        current_minute += task.duration_minutes;
    }

    return result;
}

ScheduleResult SmartPlanner::optimize_schedule(const PlanProcessor::FullPlan& plan,
                                               const std::vector<int>& available_slots,
                                               [[maybe_unused]] bool prioritize_busy) {
    ScheduleResult result;

    if (available_slots.empty()) {
        result.success       = false;
        result.error_message = "No available time slots provided";
        return result;
    }
    if (plan.tasks.empty()) {
        result.success       = false;
        result.error_message = "Plan contains no tasks to schedule";
        return result;
    }

    result.success                      = true;
    result.total_time_available_minutes = 0;
    result.total_work_minutes           = 0;
    result.total_break_minutes          = 0;

    const std::size_t count = std::min(available_slots.size(), plan.tasks.size());
    result.slots.reserve(count);

    for (std::size_t i = 0; i < count; ++i) {
        const auto& task = plan.tasks[i];
        result.slots.push_back(make_time_slot(task, available_slots[i]));

        if (task.is_break) result.total_break_minutes += task.duration_minutes;
        else               result.total_work_minutes   += task.duration_minutes;

        result.total_time_available_minutes += task.duration_minutes;
    }

    return result;
}

ProductivityStats SmartPlanner::analyze_productivity(
        const std::vector<PlanProcessor::FullPlan>& past_plans) {
    ProductivityStats stats;

    if (past_plans.empty()) {
        stats.efficiency_score       = kDefaultEfficiencyScore;
        stats.focus_score            = kDefaultFocusScore;
        stats.recommended_chunk_size = kDefaultChunkSize;
        stats.recommendations = {
            "Start with 25-minute focus sessions",
            "Take regular 5-minute breaks"
        };
        return stats;
    }

    // Derive structural statistics from past plans.  Without explicit
    // completion/feedback data, the work/break ratio serves as a proxy
    // for sustainability: a 5:1 work-to-break ratio (breaks ≈ 20% of
    // work time) is ideal; deviations lower the efficiency estimate.
    double total_efficiency   = 0.0;
    double weighted_chunk_sum = 0.0;
    int    total_tasks        = 0;

    for (const auto& plan : past_plans) {
        int work = 0, brk = 0;
        for (const auto& task : plan.tasks) {
            if (task.is_break) brk  += task.duration_minutes;
            else               work += task.duration_minutes;
        }
        total_tasks += static_cast<int>(plan.tasks.size());

        const double ratio = work > 0
            ? static_cast<double>(brk) / static_cast<double>(work)
            : 0.0;
        const double penalty = std::abs(ratio - kIdealBreakRatio) * kBreakRatioPenalty;
        total_efficiency   += std::clamp(1.0 - penalty, kMinEfficiencyScore, kMaxEfficiencyScore);
        weighted_chunk_sum += plan.chunk_size_minutes * static_cast<double>(plan.tasks.size());
    }

    const double n = static_cast<double>(past_plans.size());
    stats.efficiency_score = total_efficiency / n;
    stats.focus_score      = std::clamp(stats.efficiency_score, kMinEfficiencyScore, kMaxEfficiencyScore);

    const int avg_chunk = total_tasks > 0
        ? static_cast<int>(std::round(weighted_chunk_sum / total_tasks))
        : kDefaultChunkSize;
    stats.recommended_chunk_size = calculate_optimal_chunk(60, avg_chunk);

    stats.recommendations = {
        "Consider " + std::to_string(stats.recommended_chunk_size) + "-minute focus chunks",
        "Maintain a consistent break schedule",
        "Aim for roughly 5 minutes of break per 25 minutes of work",
    };

    return stats;
}

std::string SmartPlanner::generate_optimized_plan(const PlanProcessor::FullPlan& plan,
                                                   bool auto_adjust) {
    auto optimized_plan = plan;

    if (auto_adjust) {
        const int optimal_chunk = calculate_optimal_chunk(
            plan.duration_minutes, plan.chunk_size_minutes);
        optimized_plan.chunk_size_minutes = optimal_chunk;
        optimized_plan.break_minutes      = std::clamp(
            optimal_chunk / 5, kMinBreakMinutes, kMaxBreakMinutes);
        optimized_plan.tasks = PlanProcessor::generate_tasks(optimized_plan);
    }

    return PlanProcessor::plan_to_json(optimized_plan);
}

std::string SmartPlanner::schedule_to_json(const ScheduleResult& schedule) const {
    // Estimate: ~200 bytes overhead + ~80 bytes per slot.
    const std::size_t est_capacity = 200 + schedule.slots.size() * 80;
    StringBuilder sb(est_capacity);

    sb << '{';
    sb.json_kv("success", schedule.success) << ',';
    sb.json_kv("errorMessage", schedule.error_message) << ',';
    sb.json_kv("totalTimeAvailable", schedule.total_time_available_minutes) << ',';
    sb.json_kv("totalWorkTime", schedule.total_work_minutes) << ',';
    sb.json_kv("totalBreakTime", schedule.total_break_minutes) << ',';
    sb.json_key("slots") << '[';

    bool first = true;
    for (const auto& slot : schedule.slots) {
        if (!first) sb << ',';
        first = false;
        sb << '{';
        sb.json_kv("id", slot.id) << ',';
        sb.json_kv("startMinute", slot.start_minute) << ',';
        sb.json_kv("durationMinutes", slot.duration_minutes) << ',';
        sb.json_kv("taskId", slot.task_id) << ',';
        sb.json_kv("taskTitle", slot.task_title) << ',';
        sb.json_kv("isBreak", slot.is_break);
        sb << '}';
    }

    sb << "]}";
    return sb.release();
}

std::string SmartPlanner::stats_to_json(const ProductivityStats& stats) const {
    // Estimate: ~200 bytes overhead + ~60 bytes per recommendation.
    const std::size_t est_capacity = 200 + stats.recommendations.size() * 60;
    StringBuilder sb(est_capacity);

    sb << '{';
    sb.json_kv("efficiencyScore", stats.efficiency_score) << ',';
    sb.json_kv("focusScore", stats.focus_score) << ',';
    sb.json_kv("recommendedChunkSize", stats.recommended_chunk_size) << ',';
    sb.json_key("recommendations") << '[';

    bool first = true;
    for (const auto& rec : stats.recommendations) {
        if (!first) sb << ',';
        first = false;
        sb.json_string(rec);
    }

    sb << "]}";
    return sb.release();
}

} // namespace SmartTimePlanner