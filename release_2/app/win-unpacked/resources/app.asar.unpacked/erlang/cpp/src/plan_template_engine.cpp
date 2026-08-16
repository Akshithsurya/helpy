#include "plan_template_engine.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <ctime>
#include <random>
#include <string>
#include <string_view>
#include <utility>

namespace {

constexpr std::string_view kHexChars = "0123456789abcdef";

// ── JSON helpers ───────────────────────────────────────────────────────

void json_escape(std::string& out, std::string_view s) {
    std::size_t run_start = 0;
    for (std::size_t i = 0; i < s.size(); ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        if (c >= 0x20 && c != '"' && c != '\\') continue;

        if (i > run_start)
            out.append(s.data() + run_start, i - run_start);
        run_start = i + 1;

        switch (c) {
            case '"':  out.append("\\\""); break;
            case '\\': out.append("\\\\"); break;
            case '\b': out.append("\\b");  break;
            case '\f': out.append("\\f");  break;
            case '\n': out.append("\\n");  break;
            case '\r': out.append("\\r");  break;
            case '\t': out.append("\\t");  break;
            default: {
                const char hex[6] = {
                    '\\', 'u', '0', '0',
                    static_cast<char>(kHexChars[(c >> 4) & 0xF]),
                    static_cast<char>(kHexChars[c & 0xF])
                };
                out.append(hex, 6);
                break;
            }
        }
    }
    if (run_start < s.size())
        out.append(s.data() + run_start, s.size() - run_start);
}

void json_quoted(std::string& out, std::string_view s) {
    out.push_back('"');
    json_escape(out, s);
    out.push_back('"');
}

void json_kv(std::string& out, std::string_view key, std::string_view value) {
    json_quoted(out, key);
    out.push_back(':');
    json_quoted(out, value);
}

void json_kv(std::string& out, std::string_view key, int value) {
    json_quoted(out, key);
    out.push_back(':');
    char buf[24];
    const auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), value);
    if (ec == std::errc())
        out.append(buf, static_cast<std::size_t>(ptr - buf));
}

void json_string_array(std::string& out, std::string_view key,
                       const std::vector<std::string>& items) {
    json_quoted(out, key);
    out.append(":[");
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (i > 0) out.push_back(',');
        json_quoted(out, items[i]);
    }
    out.push_back(']');
}

// Comma-safe JSON object writer.  Adding or removing a field cannot
// produce malformed JSON due to missing or doubled commas.
class json_object_writer {
public:
    explicit json_object_writer(std::string& out) : out_(out) {
        out_.push_back('{');
    }

    json_object_writer(const json_object_writer&) = delete;
    json_object_writer& operator=(const json_object_writer&) = delete;

    void kv(std::string_view key, std::string_view value) {
        maybe_comma();
        json_kv(out_, key, value);
    }

    void kv(std::string_view key, int value) {
        maybe_comma();
        json_kv(out_, key, value);
    }

    void string_array(std::string_view key,
                      const std::vector<std::string>& items) {
        maybe_comma();
        json_string_array(out_, key, items);
    }

    void finish() { out_.push_back('}'); }

private:
    void maybe_comma() {
        if (first_) first_ = false;
        else out_.push_back(',');
    }

    std::string& out_;
    bool first_ = true;
};

// ── Timestamp ──────────────────────────────────────────────────────────

std::string make_iso_timestamp() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32];
    const auto len = std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return {buf, len};
}

// ── ID generation ──────────────────────────────────────────────────────

std::string generate_id() {
    thread_local std::mt19937 rng{std::random_device{}()};

    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch())
                        .count();
    const auto r = rng();

    std::string id;
    id.reserve(32);
    id.append("tpl-");

    char ms_buf[24];
    const auto [ptr, ec] = std::to_chars(ms_buf, ms_buf + sizeof(ms_buf), ms);
    if (ec == std::errc())
        id.append(ms_buf, static_cast<std::size_t>(ptr - ms_buf));

    id.push_back('-');

    for (int i = 28; i >= 0; i -= 4)
        id.push_back(kHexChars[(r >> i) & 0xF]);

    return id;
}

// ── ASCII case-insensitive search ──────────────────────────────────────
// Replaced std::tolower with a constexpr ASCII-only lowercasing function.
// std::tolower is locale-dependent and can produce surprising results
// (e.g. Turkish dotless-i); ascii_tolower is deterministic and faster.

constexpr char ascii_tolower(char c) noexcept {
    return (c >= 'A' && c <= 'Z') ? static_cast<char>(c + 0x20) : c;
}

bool icontains(std::string_view haystack, std::string_view needle) noexcept {
    if (needle.empty()) return true;
    if (haystack.size() < needle.size()) return false;

    const auto eq_ic = [](char a, char b) noexcept {
        return ascii_tolower(a) == ascii_tolower(b);
    };
    return std::search(haystack.begin(), haystack.end(),
                       needle.begin(), needle.end(), eq_ic) != haystack.end();
}

// ── Template JSON serialization ────────────────────────────────────────

void append_template_json(std::string& out, const PlanTemplate& tpl) {
    json_object_writer obj(out);
    obj.kv("id", tpl.id);
    obj.kv("name", tpl.name);
    obj.kv("description", tpl.description);
    obj.kv("category", tpl.category);
    obj.kv("defaultDurationMinutes", tpl.default_duration_minutes);
    obj.kv("defaultChunkSize", tpl.default_chunk_size);
    obj.kv("defaultBreakMinutes", tpl.default_break_minutes);
    obj.kv("defaultGoal", tpl.default_goal);
    obj.string_array("defaultTags", tpl.default_tags);
    obj.kv("createdAt", tpl.created_at);
    obj.finish();
}

} // anonymous namespace

namespace PlanTemplateEngine {

TemplateEngine::TemplateEngine() {
    initialize_default_templates();
}

// TODO: Could be made static — does not depend on object state.
// Would require updating the header declaration accordingly.
std::string TemplateEngine::generate_id() const {
    return ::generate_id();
}

void TemplateEngine::initialize_default_templates() {
    struct Def {
        const char* name;
        const char* description;
        const char* category;
        int duration;
        int chunk;
        int brk;
        const char* goal;
        std::array<const char*, 3> tags;
    };

    static constexpr Def defaults[] = {
        {"Deep Focus",         "A focused work session with minimal breaks",   "Work",       45, 25, 5,  "Concentrated deep work",         {"focus",      "work",         "productivity"}},
        {"Quick Sprint",       "Short burst of intense productivity",          "Work",       25, 25, 0,  "Get things done quickly",         {"sprint",     "quick",        "urgent"}},
        {"Study Session",      "Effective learning with spaced breaks",        "Learning",   60, 45, 10, "Learn and retain new information", {"study",      "learning",     "education"}},
        {"Coding Session",     "Optimized for programming and problem-solving","Development",90, 30, 5,  "Write clean, efficient code",     {"coding",     "development",  "programming"}},
        {"Creative Writing",   "Structured creative writing session",          "Creativity", 60, 20, 5,  "Create compelling content",       {"writing",    "creativity",   "content"}},
        {"Exercise Plan",      "Structured physical activity routine",         "Health",     45, 15, 5,  "Improve physical fitness",        {"exercise",   "health",       "fitness"}},
        {"Meditation & Relax", "Mindfulness and relaxation practice",          "Wellness",   30, 10, 5,  "Calm the mind and reduce stress", {"meditation", "relaxation",   "wellness"}},
        {"Review & Planning",  "Review past work and plan ahead",              "Planning",   30, 15, 5,  "Organize and prioritize tasks",   {"planning",   "review",       "organization"}},
    };

    templates_.reserve(std::size(defaults));
    for (const auto& d : defaults) {
        PlanTemplate tpl;
        tpl.id = ::generate_id();
        tpl.name = d.name;
        tpl.description = d.description;
        tpl.category = d.category;
        tpl.default_duration_minutes = d.duration;
        tpl.default_chunk_size = d.chunk;
        tpl.default_break_minutes = d.brk;
        tpl.default_goal = d.goal;
        tpl.default_tags.assign(d.tags.begin(), d.tags.end());
        tpl.created_at = make_iso_timestamp();

        // BUG FIX: Capture the id before moving tpl.  The argument
        // evaluation order in emplace() is unspecified — reading
        // tpl.id after std::move(tpl) is undefined behavior.
        const auto id = tpl.id;
        templates_.emplace(id, std::move(tpl));
    }
}

PlanTemplate TemplateEngine::create_template(
        std::string name, std::string description,
        std::string category, int duration_minutes,
        int chunk_size, int break_minutes, std::string goal) {
    PlanTemplate tpl;
    tpl.id = ::generate_id();
    tpl.name = std::move(name);
    tpl.description = std::move(description);
    tpl.category = std::move(category);
    tpl.default_duration_minutes = std::clamp(duration_minutes, 5, 240);
    tpl.default_chunk_size = std::clamp(chunk_size, 1, 60);
    tpl.default_break_minutes = std::clamp(break_minutes, 0, 30);
    tpl.default_goal = std::move(goal);
    tpl.created_at = make_iso_timestamp();

    // BUG FIX: Same evaluation-order issue as initialize_default_templates.
    const auto id = tpl.id;
    const auto [it, inserted] = templates_.emplace(id, std::move(tpl));
    return it->second;
}

[[nodiscard]] const PlanTemplate* TemplateEngine::get_template(
        const std::string& id) const {
    const auto it = templates_.find(id);
    return it != templates_.end() ? &it->second : nullptr;
}

[[nodiscard]] std::vector<PlanTemplate> TemplateEngine::get_all_templates() const {
    std::vector<PlanTemplate> result;
    result.reserve(templates_.size());
    for (const auto& [id, tpl] : templates_)
        result.push_back(tpl);
    return result;
}

// Changed from const std::string& to std::string_view — no ownership
// needed, and callers can now pass string literals or views directly
// without materializing a temporary std::string.
// (Header declaration must be updated to match.)

[[nodiscard]] std::vector<PlanTemplate> TemplateEngine::get_templates_by_category(
        std::string_view category) const {
    std::vector<PlanTemplate> result;
    for (const auto& [id, tpl] : templates_) {
        if (tpl.category == category)
            result.push_back(tpl);
    }
    return result;
}

[[nodiscard]] std::vector<PlanTemplate> TemplateEngine::search_templates(
        std::string_view query) const {
    std::vector<PlanTemplate> result;
    for (const auto& [id, tpl] : templates_) {
        if (icontains(tpl.name, query) || icontains(tpl.description, query))
            result.push_back(tpl);
    }
    return result;
}

bool TemplateEngine::delete_template(const std::string& id) {
    return templates_.erase(id) > 0;
}

bool TemplateEngine::update_template(PlanTemplate tpl) {
    const auto it = templates_.find(tpl.id);
    if (it == templates_.end()) return false;
    it->second = std::move(tpl);
    return true;
}

[[nodiscard]] PlanProcessor::FullPlan TemplateEngine::apply_template(
        const std::string& template_id,
        const std::string& args_str,
        const std::string& source) const {
    const auto* tpl = get_template(template_id);
    if (!tpl)
        return PlanProcessor::create_plan(args_str, source);

    std::string combined;
    combined.reserve(tpl->name.size() + 1 + args_str.size());
    combined = tpl->name;
    if (!args_str.empty()) {
        combined.push_back(' ');
        combined.append(args_str);
    }

    auto plan = PlanProcessor::create_plan(combined, source);
    plan.goal = tpl->default_goal;
    plan.chunk_size_minutes = tpl->default_chunk_size;
    plan.break_minutes = tpl->default_break_minutes;
    plan.duration_minutes = tpl->default_duration_minutes;
    plan.tags = tpl->default_tags;
    plan.tasks = PlanProcessor::generate_tasks(plan);
    return plan;
}

[[nodiscard]] std::string TemplateEngine::template_to_json(
        const PlanTemplate& tpl) const {
    std::string out;
    out.reserve(512);
    append_template_json(out, tpl);
    return out;
}

[[nodiscard]] std::string TemplateEngine::templates_to_json(
        const std::vector<PlanTemplate>& tpls) const {
    std::string out;
    out.reserve(tpls.size() * 256 + 4);
    out.push_back('[');
    bool first = true;
    for (const auto& tpl : tpls) {
        if (!first) out.push_back(',');
        first = false;
        append_template_json(out, tpl);
    }
    out.push_back(']');
    return out;
}

} // namespace PlanTemplateEngine