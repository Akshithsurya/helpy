
#ifndef PLAN_VALIDATOR_ENHANCED_HPP
#define PLAN_VALIDATOR_ENHANCED_HPP

#include "plan_processor.hpp"
#include &lt;string&gt;
#include &lt;vector&gt;

namespace PlanValidatorEnhanced {

enum class ValidationSeverity {
    INFO,
    WARNING,
    ERROR,
    SUCCESS
};

struct ValidationIssue {
    ValidationSeverity severity;
    std::string code;
    std::string message;
    std::string suggestion;
};

struct ValidationReport {
    bool valid;
    int score;
    std::vector&lt;ValidationIssue&gt; issues;
    std::vector&lt;std::string&gt; improvements;
};

class EnhancedValidator {
public:
    EnhancedValidator();

    ValidationReport validate(const PlanProcessor::FullPlan&amp; plan,
                          bool strict_mode = false);

    ValidationReport validate_and_suggest(const PlanProcessor::FullPlan&amp; plan);

    std::string calculate_quality_score(const PlanProcessor::FullPlan&amp; plan);

    std::vector&lt;std::string&gt; suggest_improvements(const PlanProcessor::FullPlan&amp; plan);

    std::string report_to_json(const ValidationReport&amp; report) const;

private:
    void check_duration_constraints(const PlanProcessor::FullPlan&amp; plan,
                                  std::vector&lt;ValidationIssue&gt;&amp; issues);
    void check_task_distribution(const PlanProcessor::FullPlan&amp; plan,
                              std::vector&lt;ValidationIssue&gt;&amp; issues);
    void check_break_pattern(const PlanProcessor::FullPlan&amp; plan,
                           std::vector&lt;ValidationIssue&gt;&amp; issues);
    void check_goal_clarity(const PlanProcessor::FullPlan&amp; plan,
                          std::vector&lt;ValidationIssue&gt;&amp; issues);

    int compute_overall_score(const std::vector&lt;ValidationIssue&gt;&amp; issues);
};

}

#endif
