
#ifndef SMART_TIME_PLANNER_HPP
#define SMART_TIME_PLANNER_HPP

#include "plan_processor.hpp"
#include &lt;string&gt;
#include &lt;vector&gt;
#include &lt;unordered_map&gt;
#include &lt;optional&gt;

namespace SmartTimePlanner {

struct TimeSlot {
    std::string id;
    int start_minute;
    int duration_minutes;
    std::string task_id;
    std::string task_title;
    bool is_break;
};

struct ScheduleResult {
    bool success;
    std::string error_message;
    std::vector&lt;TimeSlot&gt; slots;
    int total_time_available_minutes;
    int total_work_minutes;
    int total_break_minutes;
};

struct ProductivityStats {
    double efficiency_score;
    double focus_score;
    double recommended_chunk_size;
    std::vector&lt;std::string&gt; recommendations;
};

class SmartPlanner {
public:
    SmartPlanner();

    ScheduleResult generate_schedule(const PlanProcessor::FullPlan&amp; plan,
                                int start_hour = 9,
                                int start_minute = 0);

    ScheduleResult optimize_schedule(const PlanProcessor::FullPlan&amp; plan,
                                const std::vector&lt;int&gt;&amp; available_slots,
                                bool prioritize_busy = true);

    ProductivityStats analyze_productivity(const std::vector&lt;PlanProcessor::FullPlan&gt;&amp; past_plans);

    std::string generate_optimized_plan(const PlanProcessor::FullPlan&amp; plan,
                                   bool auto_adjust = true);

    std::string schedule_to_json(const ScheduleResult&amp; schedule) const;
    std::string stats_to_json(const ProductivityStats&amp; stats) const;

private:
    int calculate_optimal_chunk(int available_time,
                            int desired_duration,
                            int break_ratio = 5);
    bool is_slot_available(int slot_start, int slot_duration,
                         const std::vector&lt;std::pair&lt;int, int&gt;&gt;&amp; busy_slots);
};

}

#endif
