// Task scheduler — intelligent scheduling for the Helpy Plan service
// Provides JSON and string APIs for task prioritization, break planning,
// and daily schedule generation with automatic break insertion.

#include "json_utils.hpp"

#include <algorithm>
#include <cstddef>
#include <limits>
#include <string>
#include <vector>

namespace TaskScheduler {

// ============================================================================
// Types & constants
// ============================================================================

using Minutes = int;

constexpr Minutes kMinWorkBlock        = 25;
constexpr Minutes kMaxWorkBlock        = 90;
constexpr Minutes kMinBreakMinutes     = 5;
constexpr Minutes kMaxBreakMinutes     = 20;
constexpr Minutes kIntensityAdjust     = 10;
constexpr Minutes kMinutesPerHour      = 60;
constexpr Minutes kDefaultTaskDuration = kMinutesPerHour;

constexpr double kBreakRatio       = 0.2;
constexpr double kHighIntensity    = 0.8;
constexpr double kLowIntensity     = 0.4;
constexpr double kDefaultIntensity = 0.5;

constexpr int kFirstHour = 0;
constexpr int kLastHour  = 24;

constexpr Minutes kUnscheduled = -1;   // sentinel for unscheduled slots

// ============================================================================
// Core data model
// ============================================================================

struct Task {
    std::string              id;
    std::string              title;
    Minutes                  duration  = kDefaultTaskDuration;
    int                      priority  = 0;
    Minutes                  start     = kUnscheduled;
    Minutes                  end       = kUnscheduled;
    bool                     isBreak   = false;
    std::vector<std::string> tags;
};

/// Reusable break-parameter result (work-block length + break length).
struct BreakParams {
    Minutes workBlock;
    Minutes breakDuration;
};

// ============================================================================
// Internal helpers
// ============================================================================

namespace {

template <typename Container>
[[nodiscard]] int sizeAsInt(const Container& c) noexcept {
    return static_cast<int>(std::min<std::size_t>(
        c.size(), static_cast<std::size_t>(std::numeric_limits<int>::max())));
}

[[nodiscard]] std::string makeTaskId(std::size_t idx) {
    return "task-" + std::to_string(idx + 1);
}

[[nodiscard]] constexpr int clampHour(int h) noexcept {
    return std::clamp(h, kFirstHour, kLastHour);
}

// Plain task names → Task objects (for legacy wrappers).
[[nodiscard]] std::vector<Task>
namesToTasks(const std::vector<std::string>& names,
             Minutes dur = kDefaultTaskDuration) {
    std::vector<Task> out;
    out.reserve(names.size());
    for (std::size_t i = 0; i < names.size(); ++i) {
        Task t;
        t.id       = makeTaskId(i);
        t.title    = names[i];
        t.duration = dur;
        out.push_back(std::move(t));
    }
    return out;
}

// Task names + priorities → Task objects (for legacy wrappers).
[[nodiscard]] std::vector<Task>
namesToTasks(const std::vector<std::string>& names,
             const std::vector<int>& priorities) {
    const auto n = std::min(names.size(), priorities.size());
    std::vector<Task> out;
    out.reserve(n);
    for (std::size_t i = 0; i < n; ++i) {
        Task t;
        t.id       = makeTaskId(i);
        t.title    = names[i];
        t.priority = priorities[i];
        out.push_back(std::move(t));
    }
    return out;
}

// Append a scheduled-task entry to a JSON array.
// `order` is included only when > 0 (omitted for break entries).
void appendScheduledTask(JsonUtils::JsonValue& arr,
                         const Task& t, int order = 0) {
    JsonUtils::JsonBuilder b;
    b.add("id",               t.id);
    b.add("title",            t.title);
    b.add("startTimeMinutes", t.start);
    b.add("endTimeMinutes",   t.end);
    b.add("durationMinutes",  t.duration);
    b.add("isBreak",          t.isBreak);
    if (order > 0) b.add("order", order);
    arr.push_back(b.build());
}

} // namespace

// ============================================================================
// Break computation — reusable core logic
// ============================================================================

/// Compute work-block and break durations adjusted for intensity.
/// High intensity → shorter blocks (more frequent breaks).
/// Low intensity  → longer blocks (fewer breaks).
[[nodiscard]] BreakParams
computeBreakParams(Minutes preferredBlock, double intensity) {
    Minutes block = std::clamp(preferredBlock, kMinWorkBlock, kMaxWorkBlock);

    if (intensity > kHighIntensity)
        block = std::max(kMinWorkBlock, block - kIntensityAdjust);
    else if (intensity < kLowIntensity)
        block = std::min(kMaxWorkBlock, block + kIntensityAdjust);

    const Minutes brk = std::clamp(
        static_cast<Minutes>(block * kBreakRatio),
        kMinBreakMinutes, kMaxBreakMinutes);

    return {block, brk};
}

// ============================================================================
// JSON API
// ============================================================================

/// Pack tasks sequentially into time slots starting from `startHour`.
/// Tasks with duration ≤ 0 are skipped. Now produces actual time slots
/// instead of just an ordered list.
[[nodiscard]] JsonUtils::JsonValue
scheduleTasksJson(const std::vector<Task>& tasks,
                 const std::string& strategy,
                 int startHour = kFirstHour) {
    const Minutes origin = clampHour(startHour) * kMinutesPerHour;

    JsonUtils::JsonValue arr{JsonUtils::JsonValue::ArrayType{}};
    arr.reserve(tasks.size());

    Minutes cursor = origin;
    int order = 1;
    for (const auto& t : tasks) {
        if (t.duration <= 0) continue;

        Task s  = t;
        s.start = cursor;
        s.end   = cursor + t.duration;
        appendScheduledTask(arr, s, order);
        cursor += t.duration;
        ++order;
    }

    JsonUtils::JsonBuilder builder;
    builder.add("strategy",  strategy);
    builder.add("taskCount", sizeAsInt(tasks));
    builder.add("scheduled", true);
    builder.add("tasks",     std::move(arr));
    return builder.build();
}

/// Compute optimal break pattern for a work session.
[[nodiscard]] JsonUtils::JsonValue
calculateOptimalBreaksJson(Minutes totalWorkMinutes,
                           Minutes preferredWorkBlock,
                           double  workIntensity) {
    const auto [block, brk] = computeBreakParams(preferredWorkBlock, workIntensity);

    const int numBlocks         = totalWorkMinutes / block;
    const int remainingMinutes  = totalWorkMinutes % block;
    const int totalBreakMinutes = std::max(0, numBlocks - 1) * brk;

    JsonUtils::JsonBuilder b;
    b.add("workBlockMinutes",  block);
    b.add("breakMinutes",      brk);
    b.add("numBlocks",         numBlocks);
    b.add("remainingMinutes",  remainingMinutes);
    b.add("totalWorkMinutes",  totalWorkMinutes);
    b.add("totalBreakMinutes", totalBreakMinutes);
    return b.build();
}

/// Sort tasks by descending priority (stable) and return the ordered list.
[[nodiscard]] JsonUtils::JsonValue
prioritizeTasksJson(const std::vector<Task>& tasks) {
    auto sorted = tasks;
    std::stable_sort(sorted.begin(), sorted.end(),
                     [](const Task& a, const Task& b) noexcept {
                         return a.priority > b.priority;
                     });

    JsonUtils::JsonValue arr{JsonUtils::JsonValue::ArrayType{}};
    arr.reserve(sorted.size());

    int order = 1;
    for (const auto& t : sorted) {
        JsonUtils::JsonBuilder tb;
        tb.add("id",       t.id);
        tb.add("title",    t.title);
        tb.add("priority", t.priority);
        tb.add("order",    order++);
        arr.push_back(tb.build());
    }

    JsonUtils::JsonBuilder builder;
    builder.add("prioritizedTasks", std::move(arr));
    return builder.build();
}

/// Generate a daily schedule with automatic break insertion.
/// Tasks are packed into [startHour, endHour]; breaks are inserted
/// between tasks when accumulated work reaches the block threshold.
/// Invalid time ranges produce an empty schedule with a status note.
[[nodiscard]] JsonUtils::JsonValue
generateDailyScheduleJson(int startHour, int endHour,
                          const std::vector<Task>& tasks,
                          double workIntensity = kDefaultIntensity) {
    startHour = clampHour(startHour);
    endHour   = clampHour(endHour);

    if (endHour <= startHour) {
        JsonUtils::JsonBuilder builder;
        builder.add("startHour",             startHour);
        builder.add("endHour",               endHour);
        builder.add("totalHours",            0);
        builder.add("totalAvailableMinutes", 0);
        builder.add("scheduledTasks",
            JsonUtils::JsonValue{JsonUtils::JsonValue::ArrayType{}});
        builder.add("status",                "invalid time range");
        return builder.build();
    }

    const int totalHours            = endHour - startHour;
    const int totalAvailableMinutes = totalHours * kMinutesPerHour;
    const Minutes dayStart          = startHour * kMinutesPerHour;
    const Minutes dayEnd            = endHour   * kMinutesPerHour;

    const auto [workBlock, breakDur] = computeBreakParams(kMaxWorkBlock, workIntensity);

    std::vector<Task> scheduled;
    scheduled.reserve(tasks.size() * 2);   // room for interleaved breaks

    Minutes cursor           = dayStart;
    Minutes workedSinceBreak = 0;

    for (const auto& t : tasks) {
        if (t.duration <= 0) continue;

        // Insert a break before this task if we've hit the block threshold.
        if (workedSinceBreak >= workBlock && cursor + breakDur <= dayEnd) {
            Task b;
            b.id       = "break-" + std::to_string(scheduled.size() + 1);
            b.title    = "Break";
            b.duration = breakDur;
            b.start    = cursor;
            b.end      = cursor + breakDur;
            b.isBreak  = true;
            scheduled.push_back(std::move(b));
            cursor += breakDur;
            workedSinceBreak = 0;
        }

        // Stop if this task overflows the day boundary.
        if (cursor + t.duration > dayEnd) break;

        Task s  = t;
        s.start = cursor;
        s.end   = cursor + t.duration;
        scheduled.push_back(std::move(s));
        cursor += t.duration;
        workedSinceBreak += t.duration;
    }

    JsonUtils::JsonValue arr{JsonUtils::JsonValue::ArrayType{}};
    arr.reserve(scheduled.size());
    for (const auto& t : scheduled) {
        appendScheduledTask(arr, t);
    }

    JsonUtils::JsonBuilder builder;
    builder.add("startHour",             startHour);
    builder.add("endHour",               endHour);
    builder.add("totalHours",            totalHours);
    builder.add("totalAvailableMinutes", totalAvailableMinutes);
    builder.add("workBlockMinutes",      workBlock);
    builder.add("breakDurationMinutes",  breakDur);
    builder.add("scheduledTasks",        std::move(arr));
    return builder.build();
}

// ============================================================================
// Legacy string-based API (backward-compatibility wrappers)
// ============================================================================

[[nodiscard]] std::string
scheduleTasks(const std::vector<std::string>& tasks,
              const std::string& strategy) {
    return scheduleTasksJson(namesToTasks(tasks), strategy).serialize(-1);
}

[[nodiscard]] std::string
calculateOptimalBreaks(Minutes totalWorkMinutes,
                       Minutes preferredWorkBlock) {
    return calculateOptimalBreaksJson(totalWorkMinutes,
                                      preferredWorkBlock,
                                      kDefaultIntensity).serialize(-1);
}

[[nodiscard]] std::string
calculateOptimalBreaks(Minutes totalWorkMinutes,
                       Minutes preferredWorkBlock,
                       double workIntensity) {
    return calculateOptimalBreaksJson(totalWorkMinutes,
                                      preferredWorkBlock,
                                      workIntensity).serialize(-1);
}

[[nodiscard]] std::string
prioritizeTasks(const std::vector<std::string>& tasks,
                const std::vector<int>& priorities) {
    return prioritizeTasksJson(namesToTasks(tasks, priorities)).serialize(-1);
}

[[nodiscard]] std::string
generateDailySchedule(int startHour, int endHour,
                      const std::vector<std::string>& tasks) {
    return generateDailyScheduleJson(startHour, endHour,
                                     namesToTasks(tasks)).serialize(-1);
}

[[nodiscard]] std::string
generateDailySchedule(int startHour, int endHour,
                      const std::vector<std::string>& tasks,
                      double workIntensity) {
    return generateDailyScheduleJson(startHour, endHour,
                                     namesToTasks(tasks), workIntensity).serialize(-1);
}

} // namespace TaskScheduler