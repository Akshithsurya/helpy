
#ifndef PLAN_TEMPLATE_ENGINE_HPP
#define PLAN_TEMPLATE_ENGINE_HPP

#include "plan_processor.hpp"
#include &lt;string&gt;
#include &lt;vector&gt;
#include &lt;unordered_map&gt;

namespace PlanTemplateEngine {

struct PlanTemplate {
    std::string id;
    std::string name;
    std::string description;
    std::string category;
    int default_duration_minutes;
    int default_chunk_size;
    int default_break_minutes;
    std::string default_goal;
    std::vector&lt;std::string&gt; default_tags;
    std::string created_at;
};

class TemplateEngine {
public:
    TemplateEngine();

    PlanTemplate create_template(const std::string&amp; name, const std::string&amp; description,
                                const std::string&amp; category, int duration_minutes,
                                int chunk_size, int break_minutes, const std::string&amp; goal);

    const PlanTemplate* get_template(const std::string&amp; id) const;
    std::vector&lt;PlanTemplate&gt; get_all_templates() const;
    std::vector&lt;PlanTemplate&gt; get_templates_by_category(const std::string&amp; category) const;
    std::vector&lt;PlanTemplate&gt; search_templates(const std::string&amp; query) const;

    bool delete_template(const std::string&amp; id);
    bool update_template(const PlanTemplate&amp; tpl);

    PlanProcessor::FullPlan apply_template(const std::string&amp; template_id,
                                           const std::string&amp; args_str,
                                           const std::string&amp; source = "template") const;

    std::string template_to_json(const PlanTemplate&amp; tpl) const;
    std::string templates_to_json(const std::vector&lt;PlanTemplate&gt;&amp; tpls) const;

private:
    std::unordered_map&lt;std::string, PlanTemplate&gt; templates_;
    std::string generate_id() const;
    void initialize_default_templates();
};

}

#endif
