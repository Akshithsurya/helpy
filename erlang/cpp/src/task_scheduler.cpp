// Task scheduler — intelligent scheduling for the Helpy Plan service.
//
// Provides JSON and string APIs for task prioritization, break planning,
// and daily schedule generation with automatic break insertion.
//
// Design principles:
//   * Pure functions — no global state; thread-safe by construction.
//   * Structured errors — invalid input yields a JSON object whose
//     "status" field is "ok" | "partial" | "invalid time range".
//     Functions never throw on bad user input.
//   * Intensity-aware breaks — higher work-intensity produces shorter
//     work blocks (more frequent breaks).
//   * Two-tier API — structured JSON functions (…Json) plus thin
//     string wrappers for backward compatibility.
//
// Thread-safety: every public function is reentrant and thread-safe.

#include "json_utils.hpp"

#include <algorithm>
#include <cstddef>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace TaskScheduler {

// ============================================================================
// Types & constants
// ============================================================================

/// Duration or wall-clock time expressed in minutes from midnight.
using Minutes = int;

// --- Scheduling limits (minutes) -------------------------------------------
inline constexpr Minutes kMinWorkBlock        = 25;   // Shortest focused block
inline constexpr Minutes kMaxWorkBlock        = 90;   // Longest focused block
inline constexpr Minutes kMinBreakMinutes     = 5;
inline constexpr Minutes kMaxBreakMinutes     = 20;
inline constexpr Minutes kIntensityAdjust     = 10;   // ± adjustment per band
inline constexpr Minutes kMinutesPerHour      = 60;
inline constexpr Minutes kDefaultTaskDuration = kMinutesPerHour;

// --- Intensity thresholds ---------------------------------------------------
inline constexpr double kBreakRatio       = 0.2;  // break / work-block ratio
inline constexpr double kHighIntensity    = 0.8;  // > → shorter blocks
inline constexpr double kLowIntensity     = 0.4;  // < → longer blocks
inline constexpr double kDefaultIntensity = 0.5;
inline constexpr double kMinIntensity     = 0.0;
inline constexpr double kMaxIntensity     = 1.0;

// --- Clock helpers ----------------------------------------------------------
inline constexpr int kFirstHour        = 0;
inline constexpr int kLastHour         = 24;
inline constexpr int kDefaultStartHour = 9;

// --- Sentinels & labels -----------------------------------------------------
inline constexpr Minutes kUnscheduled = -1;   // unset start / end marker

inline constexpr std::string_view kBreakTitle    = "Break";
inline constexpr std::string_view kStatusInvalid = "invalid time range";
inline constexpr std::string_view kStatusOk      = "ok";
inline constexpr std::string_view kStatusPartial = "partial";

// ============================================================================
// Core data model
// ============================================================================

/// A unit of work or a break, with optional scheduling metadata.
struct Task {
    std::string              id;
    std::string              title;
    Minutes                  duration  = kDefaultTaskDuration;
    int                      priority  = 0;       // higher = more important
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

/// Safely convert a container size to int (clamped to INT_MAX).
template <typename Container>
[[nodiscard]] constexpr int sizeAsInt(const Container& c) noexcept {
    return static_cast<int>(std::min<std::size_t>(
        c.size(), static_cast<std::size_t>(std::numeric_limits<int>::max())));
}

/// Generate a deterministic task ID from its 0-based index.
[[nodiscard]] inline std::string makeTaskId(std::size_t idx) {
    return "task-" + std::to_string(idx + 1);
}

/// Generate a deterministic break ID from its 0-based index.
[[nodiscard]] inline std::string makeBreakId(std::size_t idx) {
    return "break-" + std::to_string(idx + 1);
}

/// Clamp an hour to the valid [0, 24] range.
[[nodiscard]] constexpr int clampHour(int h) noexcept {
    return std::clamp(h, kFirstHour, kLastHour);
}

/// Clamp a work-intensity value to [0, 1].
[[nodiscard]] constexpr double clampIntensity(double intensity) noexcept {
    return std::clamp(intensity, kMinIntensity, kMaxIntensity);
}

/// Check whether [startHour, endHour) is a valid non-empty range
/// within the 24-hour day.
[[nodiscard]] constexpr bool
isValidTimeRange(int startHour, int endHour) noexcept {
    return endHour > startHour;
}

/// Decide whether a break should be inserted before the next task.
///
/// A break is warranted when:
///   1. The accumulated work since the last break meets or exceeds
///      the work-block threshold, AND
///   2. There is enough remaining time for the break *and* the task
///      that follows it (avoids phantom end-of-day breaks).
[[nodiscard]] constexpr bool
shouldInsertBreak(Minutes workedSinceBreak,
                  Minutes workBlock,
                  Minutes cursor,
                  Minutes breakDur,
                  Minutes taskDur,
                  Minutes dayEnd) noexcept {
    return workedSinceBreak >= workBlock &&
           cursor + breakDur + taskDur <= dayEnd;
}

/// Build a work Task from a name plus optional priority / duration.
[[nodiscard]] Task makeTask(std::size_t idx, std::string_view name,
                            int priority = 0,
                            Minutes duration = kDefaultTaskDuration) {
    Task t;
    t.id       = makeTaskId(idx);
    t.title    = std::string{name};
    t.priority = priority;
    t.duration = duration;
    return t;
}

/// Build a break Task at a fixed start time.
[[nodiscard]] Task makeBreak(std::size_t breakIdx,
                             Minutes start, Minutes duration) {
    Task b;
    b.id       = makeBreakId(breakIdx);
    b.title    = std::string{kBreakTitle};
    b.duration = duration;
    b.start    = start;
    b.end      = start + duration;
    b.isBreak  = true;
    return b;
}

/// Convert plain task names → Task objects (legacy wrapper support).
[[nodiscard]] std::vector<Task>
namesToTasks(const std::vector<std::string>& names,
             Minutes dur = kDefaultTaskDuration) {
    std::vector<Task> out;
    out.reserve(names.size());
    for (std::size_t i = 0; i < names.size(); ++i)
        out.push_back(makeTask(i, names[i], 0, dur));
    return out;
}

/// Convert task names + priorities → Task objects (legacy wrapper support).
[[nodiscard]] std::vector<Task>
namesToTasks(const std::vector<std::string>& names,
             const std::vector<int>& priorities) {
    const auto n = std::min(names.size(), priorities.size());
    std::vector<Task> out;
    out.reserve(n);
    for (std::size_t i = 0; i < n; ++i)
        out.push_back(makeTask(i, names[i], priorities[i]));
    return out;
}

/// Append a scheduled-task entry to a JSON array.
/// `order` is included only when provided (omitted for break entries).
void appendScheduledTask(JsonUtils::JsonValue& arr,
                         const Task& t,
                         std::optional<int> order = std::nullopt) {
    JsonUtils::JsonBuilder b;
    b.add("id",               t.id);
    b.add("title",            t.title);
    b.add("startTimeMinutes", t.start);
    b.add("endTimeMinutes",   t.end);
    b.add("durationMinutes",  t.duration);
    b.add("isBreak",          t.isBreak);
    if (order) b.add("order", *order);
    arr.push_back(b.build());
}

} // namespace

// ============================================================================
// Break computation — reusable core logic
// ============================================================================

/// Compute work-block and break durations adjusted for intensity.
///
/// @param preferredBlock  Desired block length (clamped to [25, 90]).
/// @param intensity       Work intensity in [0, 1] (clamped automatically).
/// @return                {work-block, break} durations in minutes.
///
/// High intensity (> 0.8) → shorter blocks (more frequent breaks).
/// Low  intensity (< 0.4) → longer  blocks (fewer breaks).
/// Neutral intensity      → preferred block unchanged.
[[nodiscard]] BreakParams
computeBreakParams(Minutes preferredBlock, double intensity) {
    intensity = clampIntensity(intensity);
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
///
/// Tasks with duration ≤ 0 are silently skipped.
/// Tasks are scheduled in the given order with no breaks inserted.
/// The cursor advances past 24:00 if the total duration exceeds the
/// remaining day — callers should validate totals if this is undesirable.
///
/// @param tasks      Ordered list of tasks to schedule.
/// @param strategy   Label included in the response (e.g. "priority").
/// @param startHour  Hour at which scheduling begins (clamped to [0, 24]).
/// @return JSON object with strategy, taskCount, scheduled flag, and
///         a "tasks" array of scheduled entries.
[[nodiscard]] JsonUtils::JsonValue
scheduleTasksJson(const std::vector<Task>& tasks,
                  std::string_view strategy,
                  int startHour = kDefaultStartHour) {
    const Minutes origin = clampHour(startHour) * kMinutesPerHour;

    JsonUtils::JsonValue arr{JsonUtils::JsonValue::ArrayType{}};
    arr.reserve(tasks.size());

    Minutes cursor = origin;
    int    order   = 1;
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
    builder.add("strategy",  std::string{strategy});
    builder.add("taskCount", sizeAsInt(tasks));
    builder.add("scheduled", true);
    builder.add("tasks",     std::move(arr));
    return builder.build();
}

/// Compute optimal break pattern for a work session.
///
/// @param totalWorkMinutes     Total work to be done (negative → treated as 0).
/// @param preferredWorkBlock   Desired block length (clamped to [25, 90]).
/// @param workIntensity        Intensity in [0, 1] (clamped automatically).
/// @return JSON with workBlockMinutes, breakMinutes, numBlocks,
///         remainingMinutes, totalWorkMinutes, totalBreakMinutes.
[[nodiscard]] JsonUtils::JsonValue
calculateOptimalBreaksJson(Minutes totalWorkMinutes,
                           Minutes preferredWorkBlock,
                           double  workIntensity) {
    const auto [block, brk] =
        computeBreakParams(preferredWorkBlock, workIntensity);

    const Minutes safeTotal     = std::max(0, totalWorkMinutes);
    const int     numBlocks     = safeTotal / block;
    const int     remaining     = safeTotal % block;
    const int     totalBreakMin = std::max(0, numBlocks - 1) * brk;

    JsonUtils::JsonBuilder b;
    b.add("workBlockMinutes",  block);
    b.add("breakMinutes",      brk);
    b.add("numBlocks",         numBlocks);
    b.add("remainingMinutes",  remaining);
    b.add("totalWorkMinutes",  totalWorkMinutes);
    b.add("totalBreakMinutes", totalBreakMin);
    return b.build();
}

/// Sort tasks by descending priority (stable) and return the ordered list.
///
/// Equal-priority tasks retain their original relative order.
///
/// @param tasks  Tasks to prioritize.
/// @return JSON with a "prioritizedTasks" array, each entry containing
///         id, title, priority, and a 1-based order field.
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
///
/// Tasks are packed into [startHour, endHour) in the given order.
/// Breaks are inserted between tasks when accumulated work reaches
/// the block threshold, but only when both the break and the following
/// task still fit before endHour — this avoids phantom end-of-day breaks.
///
/// If a task does not fit in the remaining time, it is skipped and the
/// scheduler continues to the next task (allowing smaller tasks to fill
/// the gap). The status field reports whether all tasks fit ("ok") or
/// some were skipped ("partial"). Invalid time ranges produce an empty
/// schedule with status "invalid time range".
///
/// @param startHour       First hour of the schedule (clamped to [0, 24]).
/// @param endHour         Exclusive end hour (clamped to [0, 24]).
/// @param tasks           Ordered list of tasks to schedule.
/// @param workIntensity   Intensity in [0, 1] (default 0.5).
/// @return JSON with schedule metadata, scheduledTasks array, counts,
///         and status.
[[nodiscard]] JsonUtils::JsonValue
generateDailyScheduleJson(int startHour, int endHour,
                          const std::vector<Task>& tasks,
                          double workIntensity = kDefaultIntensity) {
    startHour = clampHour(startHour);
    endHour   = clampHour(endHour);

    JsonUtils::JsonBuilder builder;
    builder.add("startHour", startHour);
    builder.add("endHour",   endHour);

    // --- Validate time range ------------------------------------------------
    if (!isValidTimeRange(startHour, endHour)) {
        builder.add("totalHours",            0);
        builder.add("totalAvailableMinutes", 0);
        builder.add("scheduledTasks",
            JsonUtils::JsonValue{JsonUtils::JsonValue::ArrayType{}});
        builder.add("status", std::string{kStatusInvalid});
        return builder.build();
    }

    const int     totalHours            = endHour - startHour;
    const int     totalAvailableMinutes = totalHours * kMinutesPerHour;
    const Minutes dayStart              = startHour * kMinutesPerHour;
    const Minutes dayEnd                = endHour   * kMinutesPerHour;

    const auto [workBlock, breakDur] =
        computeBreakParams(kMaxWorkBlock, workIntensity);

    builder.add("totalHours",            totalHours);
    builder.add("totalAvailableMinutes", totalAvailableMinutes);
    builder.add("workBlockMinutes",      workBlock);
    builder.add("breakDurationMinutes",  breakDur);

    // --- Schedule tasks with break insertion --------------------------------
    std::vector<Task> scheduled;
    scheduled.reserve(tasks.size() * 2);   // room for interleaved breaks

    Minutes     cursor             = dayStart;
    Minutes     workedSinceBreak   = 0;
    Minutes     totalWorkScheduled = 0;
    Minutes     totalBreakTime     = 0;
    std::size_t breakCount         = 0;
    int         validTaskCount     = 0;   // tasks with duration > 0
    int         scheduledTaskCount = 0;

    for (const auto& t : tasks) {
        if (t.duration <= 0) continue;
        ++validTaskCount;

        // Skip if this task doesn't fit in the remaining time.
        if (cursor + t.duration > dayEnd) continue;

        // Insert a break before this task if warranted and if both
        // the break and the task still fit before dayEnd.
        if (shouldInsertBreak(workedSinceBreak, workBlock,
                              cursor, breakDur, t.duration, dayEnd)) {
            scheduled.push_back(makeBreak(breakCount, cursor, breakDur));
            cursor           += breakDur;
            workedSinceBreak  = 0;
            totalBreakTime   += breakDur;
            ++breakCount;
        }

        Task s  = t;
        s.start = cursor;
        s.end   = cursor + t.duration;
        scheduled.push_back(std::move(s));
        cursor             += t.duration;
        workedSinceBreak   += t.duration;
        totalWorkScheduled += t.duration;
        ++scheduledTaskCount;
    }

    const int skippedTaskCount = validTaskCount - scheduledTaskCount;

    // --- Serialize scheduled items ------------------------------------------
    JsonUtils::JsonValue arr{JsonUtils::JsonValue::ArrayType{}};
    arr.reserve(scheduled.size());
    for (const auto& t : scheduled)
        appendScheduledTask(arr, t);

    builder.add("scheduledTasks",     std::move(arr));
    builder.add("scheduledTaskCount", scheduledTaskCount);
    builder.add("skippedTaskCount",   skippedTaskCount);
    builder.add("breakCount",         static_cast<int>(breakCount));
    builder.add("totalWorkMinutes",   totalWorkScheduled);
    builder.add("totalBreakMinutes",  totalBreakTime);
    builder.add("status", std::string{
        skippedTaskCount > 0 ? kStatusPartial : kStatusOk});
    return builder.build();
}

// ============================================================================
// Legacy string-based API (backward-compatibility wrappers)
// ============================================================================

/// @name Legacy string wrappers
/// These functions delegate to the JSON API and serialize the result
/// to a compact string. They exist for backward compatibility.
/// @{

[[nodiscard]] std::string
scheduleTasks(const std::vector<std::string>& tasks,
              std::string_view strategy) {
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
                                     namesToTasks(tasks),
                                     workIntensity).serialize(-1);
}

/// @}

} // namespace 