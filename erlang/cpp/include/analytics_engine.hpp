#ifndef ANALYTICS_ENGINE_HPP
#define ANALYTICS_ENGINE_HPP

#include <string>
#include <vector>
#include <map>
#include <optional>

namespace PlanProcessor {

// Struct to hold plan statistics
struct PlanStats {
    int total_plans = 0;
    int completed_plans = 0;
    double completion_rate = 0.0;
    double average_duration_minutes = 0.0;
    std::map<std::string, int> popular_tags;
    std::vector<std::string> suggestions;
};

// Struct to hold time optimization recommendations
struct TimeOptimization {
    int optimal_work_minutes = 25;
    int optimal_break_minutes = 5;
    int num_blocks = 0;
    int remaining_minutes = 0;
    std::string recommendation;
};

class AnalyticsEngine {
public:
    AnalyticsEngine();
    ~AnalyticsEngine();

    // Analyze plan history and provide statistics
    PlanStats analyze_plans(const std::vector<std::string>& plan_jsons, 
                           int time_of_day = -1);

    // Optimize time distribution for a plan
    TimeOptimization optimize_time(int total_work_minutes, 
                                  int preferred_block_size = 25);

    // Calculate productivity score based on completed tasks
    double calculate_productivity_score(const std::vector<std::string>& completed_tasks);

    // Schedule tasks with priority
    std::vector<std::string> schedule_tasks(const std::vector<std::string>& tasks,
                                           const std::vector<int>& priorities,
                                           const std::string& strategy = "priority");

private:
    // Helper to parse plan JSON
    std::optional<std::map<std::string, std::string>> parse_plan_json(const std::string& json);
    
    // Generate time-based suggestions
    std::vector<std::string> generate_time_suggestions(int hour);
    
    // Generate history-based suggestions
    std::vector<std::string> generate_history_suggestions(int avg_duration,
                                                          const std::map<std::string, int>& tag_counts);
};

} // namespace PlanProcessor

#endif // ANALYTICS_ENGINE_HPP
