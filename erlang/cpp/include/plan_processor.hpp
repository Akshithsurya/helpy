
#ifndef PLAN_PROCESSOR_HPP
#define PLAN_PROCESSOR_HPP

#include &lt;string&gt;
#include &lt;vector&gt;
#include &lt;optional&gt;

namespace PlanProcessor {

struct PlanTask {
    std::string id;
    std::string title;
    int duration_minutes;
    bool completed;
    bool is_break;
};

struct FullPlan {
    std::string id;
    std::string title;
    std::string goal;
    int duration_minutes;
    int chunk_size_minutes;
    int break_minutes;
    std::vector&lt;PlanTask&gt; tasks;
    std::string status;
    std::string created_at;
    std::string source;
    std::vector&lt;std::string&gt; tags;
};

// Parse plan arguments and create a full plan
FullPlan create_plan(const std::string&amp; args_str, const std::string&amp; source = "cpp-nif");

// Validate plan parameters
bool validate_plan(int total_duration, int chunk_size, int break_duration);

// Generate plan as JSON string
std::string plan_to_json(const FullPlan&amp; plan);

// Generate tasks for a plan
std::vector&lt;PlanTask&gt; generate_tasks(const FullPlan&amp; plan);

// Adjust plan based on constraints
FullPlan adjust_plan(const FullPlan&amp; plan, 
                    int new_chunk_size = -1, 
                    int new_break_minutes = -1);

// Export plan to different formats
std::string export_plan_to_json(const FullPlan&amp; plan);
std::string export_plan_to_markdown(const FullPlan&amp; plan);
std::string export_plan_to_csv(const FullPlan&amp; plan);

// Batch create multiple plans
std::vector<FullPlan> create_batch_plans(const std::vector<std::string>& args_list);

// Compare two plans and provide analysis
std::string compare_plans(const FullPlan&amp; plan1, const FullPlan&amp; plan2);

}

#endif
