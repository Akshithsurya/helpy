
#ifndef TASK_SCHEDULER_HPP
#define TASK_SCHEDULER_HPP

#include "json_utils.hpp"
#include &lt;string&gt;
#include &lt;vector&gt;

namespace TaskScheduler {

struct Task {
    std::string id;
    std::string title;
    std::string description;
    int durationMinutes;
    int priority;
    int startTimeMinutes;
    int endTimeMinutes;
    bool isBreak;
    std::vector&lt;std::string&gt; tags;
};

// New JSON-based functions
JsonUtils::JsonValue scheduleTasksJson(const std::vector&lt;Task&gt;&amp; tasks, const std::string&amp; strategy);
JsonUtils::JsonValue calculateOptimalBreaksJson(int totalWorkMinutes, int preferredWorkBlock, double workIntensity);
JsonUtils::JsonValue prioritizeTasksJson(const std::vector&lt;Task&gt;&amp; tasks);
JsonUtils::JsonValue generateDailyScheduleJson(int startHour, int endHour, const std::vector&lt;Task&gt;&amp; tasks);

// Legacy string-based functions for backward compatibility
std::string scheduleTasks(const std::vector&lt;std::string&gt;&amp; tasks, const std::string&amp; strategy);
std::string calculateOptimalBreaks(int totalWorkMinutes, int preferredWorkBlock);
std::string prioritizeTasks(const std::vector&lt;std::string&gt;&amp; tasks, const std::vector&lt;int&gt;&amp; priorities);
std::string generateDailySchedule(int startHour, int endHour, const std::vector&lt;std::string&gt;&amp; tasks);

} // namespace TaskScheduler

#endif // TASK_SCHEDULER_HPP
