#include "plan_template_engine.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <ctime>
#include <functional>
#include <random>
#include <span>
#include <string>
#include <string_view>
#include <thread>
#include <utility>

namespace {

using namespace std::literals::string_view_literals;

constexpr std::string_view kHexChars = "0123456789abcdef"sv;

// ── JSON escape table ──────────────────────────────────────────────────

inline constexpr std::array<bool, 256> make_escape_table() {
    std::array<bool, 256> t{};            // zero-initialize
    for (int i = 0; i < 32; ++i) t[i] = true;
    t[static_cast<unsigned char>('"')]  = true;
    t[static_cast<unsigned char>('\\')] = true;
    t[127] = true;                        // DEL
    return t;
}

inline constexpr auto kEscapeTable = make_escape_table();

inline bool needs_escape(unsigned char c) noexcept {
    return kEscapeTable[c];
}

void json_escape(std::string& out, std::string_view s) {
    std::size_t run_start = 0;
    const std::size_t n = s.size();
    for (std::size_t i = 0; i < n; ++i) {
        const auto c = static_cast<unsigned char>(s[i]);
        if (!needs_escape(c)) continue;

        if (i > run_start)
            out.append(s.data() + run_start, i - run_start);
        run_start = i + 1;

        switch (c) {
            case '"':  out.append("\\\""sv, 2); break;
            case '\\': out.append("\\\\"sv, 2); break;
            case '\b': out.append("\\b"sv,  2); break;
            case '\f': out.append("\\f"sv,  2); break;
            case '\n': out.append("\\n"sv,  2); break;
            case '\r': out.append("\\r"sv,  2); break;
            case '\t': out.append("\\t"sv,  2); break;
            default: {
                char hex[6] = {
                    '\\', 'u', '0', '0',
                    static_cast<char>(kHexChars[(c >> 4) & 0xF]),
                    static_cast<char>(kHexChars[c & 0xF])
                };
                out.append(hex, 6);
                break;
            }
        }
    }
    if (run_start < n)
        out.append(s.data() + run_start, n - run_start);
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

void json_kv(std::string& out, std::string_view key, long long value) {
    json_quoted(out, key);
    out.push_back(':');
    char buf[24];
    const auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), value);
    if (ec == std::errc())
        out.append(buf, static_cast<std::size_t>(ptr - buf));
}

void json_string_array(std::string& out, std::string_view key,
                       std::span<const std::string> items) {
    json_quoted(out, key);
    out.append(":["sv, 2);
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (i > 0) out.push_back(',');
        json_quoted(out, items[i]);
    }
    out.push_back(']');
}

// RAII JSON object writer.  The destructor closes the object so early
// returns / exceptions cannot produce malformed JSON.
class json_object_writer {
public:
    explicit json_object_writer(std::string& out) : out_(out) {
        out_.push_back('{');
    }

    json_object_writer(const json_object_writer&)            = delete;
    json_object_writer& operator=(const json_object_writer&) = delete;
    json_object_writer(json_object_writer&&)                 = delete;
    json_object_writer& operator=(json_object_writer&&)      = delete;

    ~json_object_writer() { finish(); }

    void kv(std::string_view key, std::string_view value) {
        sep();
        json_kv(out_, key, value);
    }

    void kv(std::string_view key, long long value) {
        sep();
        json_kv(out_, key, value);
    }

    void string_array(std::string_view key,
                      std::span<const std::string> items) {
        sep();
        json_string_array(out_, key, items);
    }

    void finish() noexcept {
        if (!closed_) {
            out_.push_back('}');
            closed_ = true;
        }
    }

private:
    void sep() noexcept {
        if (first_) first_ = false;
        else        out_.push_back(',');
    }

    std::string& out_;
    bool first_  = true;
    bool closed_ = false;
};

// ── Timestamp ──────────────────────────────────────────────────────────

void append_iso_timestamp(std::string& out) {
    using namespace std::chrono;
    const auto now = system_clock::now();
    const auto t   = system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32];
    const auto len = std::strftime(buf, sizeof(buf),
                                   "%Y-%m-%dT%H:%M:%SZ", &tm);
    out.append(buf, len);
}

std::string make_iso_timestamp() {
    std::string s;
    s.reserve(20);
    append_iso_timestamp(s);
    return s;
}

// ── ID generation ──────────────────────────────────────────────────────
// splitmix64: fast, good distribution, tiny state.

struct splitmix64 {
    std::uint64_t state;

    std::uint64_t operator()() noexcept {
        std::uint64_t z = (state += 0x9e3779b97f4a7c15ULL);
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
        return z ^ (z >> 31);
    }
};

splitmix64 make_thread_rng() {
    const auto t  = std::chrono::system_clock::now().time_since_epoch();
    const auto ns = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(t).count());
    const auto tid = static_cast<std::uint64_t>(
        std::hash<std::thread::id>{}(std::this_thread::get_id()));

    std::random_device rd;
    const auto r1 = static_cast<std::uint64_t>(rd());
    const auto r2 = static_cast<std::uint64_t>(rd());

    // Mix thoroughly so even low-quality entropy sources disperse well.
    std::uint64_t seed = ns ^ tid ^ (r1 << 32) ^ r2 ^ 0xa5a5a5a5a5a5a5a5ULL;
    seed ^= seed >> 33;
    seed *= 0xff51afd7ed558ccdULL;
    seed ^= seed >> 33;
    return splitmix64{seed};
}

std::string generate_id() {
    thread_local splitmix64 rng = make_thread_rng();

    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::system_clock::now().time_since_epoch())
                        .count();
    const auto r  = rng();

    std::string id;
    id.reserve(40);
    id.append("tpl-"sv);

    char buf[24];
    const auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf),
                                         static_cast<long long>(ms));
    if (ec == std::errc())
        id.append(buf, static_cast<std::size_t>(ptr - buf));

    id.push_back('-');

    // 16 hex nibbles from a 64-bit random value — ample collision
    // resistance for this use case.
    for (int shift = 60; shift >= 0; shift -= 4)
        id.push_back(static_cast<char>(kHexChars[(r >> shift) & 0xF]));

    return id;
}

// ── ASCII case-insensitive search ──────────────────────────────────────

constexpr unsigned char ascii_tolower(unsigned char c) noexcept {
    return (c >= 'A' && c <= 'Z') ? static_cast<unsigned char>(c | 0x20) : c;
}

// Branch-light scan, sufficient for the small inputs in this module.
bool icontains(std::string_view haystack, std::string_view needle) noexcept {
    if (needle.empty()) return true;
    if (haystack.size() < needle.size()) return false;

    const std::size_t n = needle.size();
    const std::size_t m = haystack.size() - n;
    const auto first = ascii_tolower(static_cast<unsigned char>(needle[0]));

    for (std::size_t i = 0; i <= m; ++i) {
        if (ascii_tolower(static_cast<unsigned char>(haystack[i])) != first)
            continue;
        std::size_t j = 1;
        for (; j < n; ++j) {
            if (ascii_tolower(static_cast<unsigned char>(haystack[i + j])) !=
                ascii_tolower(static_cast<unsigned char>(needle[j])))
                break;
        }
        if (j == n) return true;
    }
    return false;
}

// ── Template JSON serialization ────────────────────────────────────────

void append_template_json(std::string& out, const PlanTemplate& tpl) {
    json_object_writer obj(out);
    obj.kv("id"sv,                     tpl.id);
    obj.kv("name"sv,                   tpl.name);
    obj.kv("description"sv,            tpl.description);
    obj.kv("category"sv,               tpl.category);
    obj.kv("defaultDurationMinutes"sv, static_cast<long long>(tpl.default_duration_minutes));
    obj.kv("defaultChunkSize"sv,       static_cast<long long>(tpl.default_chunk_size));
    obj.kv("defaultBreakMinutes"sv,    static_cast<long long>(tpl.default_break_minutes));
    obj.kv("defaultGoal"sv,            tpl.default_goal);
    obj.string_array("defaultTags"sv,  tpl.default_tags);
    obj.kv("createdAt"sv,              tpl.created_at);
}

} // anonymous namespace

namespace PlanTemplateEngine {

TemplateEngine::TemplateEngine() {
    initialize_default_templates();
}

std::string TemplateEngine::generate_id() {
    return ::generate_id();
}

void TemplateEngine::initialize_default_templates() {
    struct Def {
        std::string_view name;
        std::string_view description;
        std::string_view category;
        int duration;
        int chunk;
        int brk;
        std::string_view goal;
        std::array<std::string_view, 3> tags;
    };

    static constexpr Def defaults[] = {
        {"Deep Focus",         "A focused work session with minimal breaks",    "Work",        45, 25,  5, "Concentrated deep work",           {"focus",      "work",         "productivity"}},
        {"Quick Sprint",       "Short burst of intense productivity",           "Work",        25, 25,  0, "Get things done quickly",          {"sprint",     "quick",       "urgent"}},
        {"Study Session",      "Effective learning with spaced breaks",         "Learning",    60, 45, 10, "Learn and retain new information", {"study",      "learning",    "education"}},
        {"Coding Session",     "Optimized for programming and problem-solving", "Development", 90, 30,  5, "Write clean, efficient code",      {"coding",     "development", "programming"}},
        {"Creative Writing",   "Structured creative writing session",           "Creativity",  60, 20,  5, "Create compelling content",        {"writing",    "creativity",  "content"}},
        {"Exercise Plan",      "Structured physical activity routine",          "Health",      45, 15,  5, "Improve physical fitness",         {"exercise",   "health",      "fitness"}},
        {"Meditation & Relax", "Mindfulness and relaxation practice",           "Wellness",    30, 10,  5, "Calm the mind and reduce stress",  {"meditation", "relaxation",  "wellness"}},
        {"Review & Planning",  "Review past work and plan ahead",               "Planning",    30, 15,  5, "Organize and prioritize tasks",    {"planning",   "review",      "organization"}},
    };

    templates_.reserve(std::size(defaults));
    const std::string ts = make_iso_timestamp();

    for (const auto& d : defaults) {
        PlanTemplate tpl;
        tpl.id                        = ::generate_id();
        tpl.name                      = d.name;
        tpl.description               = d.description;
        tpl.category                  = d.category;
        tpl.default_duration_minutes  = d.duration;
        tpl.default_chunk_size        = d.chunk;
        tpl.default_break_minutes     = d.brk;
        tpl.default_goal              = d.goal;
        tpl.default_tags.reserve(d.tags.size());
        for (const auto t : d.tags) tpl.default_tags.emplace_back(t);
        tpl.created_at                = ts;

        // try_emplace reads tpl.id before moving the value out.
        templates_.try_emplace(tpl.id, std::move(tpl));
    }
}

PlanTemplate TemplateEngine::create_template(
        std::string name, std::string description,
        std::string category, int duration_minutes,
        int chunk_size, int break_minutes, std::string goal) {
    PlanTemplate tpl;
    tpl.id                       = ::generate_id();
    tpl.name                     = std::move(name);
    tpl.description              = std::move(description);
    tpl.category                 = std::move(category);
    tpl.default_duration_minutes = std::clamp(duration_minutes, 5,  240);
    tpl.default_chunk_size       = std::clamp(chunk_size,       1,   60);
    tpl.default_break_minutes    = std::clamp(break_minutes,    0,   30);
    tpl.default_goal             = std::move(goal);
    tpl.created_at               = make_iso_timestamp();

    const auto [it, inserted] = templates_.try_emplace(tpl.id, std::move(tpl));
    return it->second;
}

[[nodiscard]] const PlanTemplate* TemplateEngine::get_template(
        std::string_view id) const noexcept {
    const auto it = templates_.find(id);
    return it != templates_.end() ? &it->second : nullptr;
}

[[nodiscard]] std::vector<PlanTemplate>
TemplateEngine::get_all_templates() const {
    std::vector<PlanTemplate> result;
    result.reserve(templates_.size());
    for (const auto& [_, tpl] : templates_)
        result.push_back(tpl);
    return result;
}

[[nodiscard]] std::vector<PlanTemplate>
TemplateEngine::get_templates_by_category(std::string_view category) const {
    std::vector<PlanTemplate> result;
    for (const auto& [_, tpl] : templates_)
        if (tpl.category == category)
            result.push_back(tpl);
    return result;
}

[[nodiscard]] std::vector<PlanTemplate>
TemplateEngine::search_templates(std::string_view query) const {
    std::vector<PlanTemplate> result;
    for (const auto& [_, tpl] : templates_)
        if (icontains(tpl.name, query) || icontains(tpl.description, query))
            result.push_back(tpl);
    return result;
}

bool TemplateEngine::delete_template(std::string_view id) noexcept {
    return templates_.erase(id) > 0;
}

bool TemplateEngine::update_template(PlanTemplate tpl) {
    const auto it = templates_.find(tpl.id);
    if (it == templates_.end()) return false;
    it->second = std::move(tpl);
    return true;
}

[[nodiscard]] PlanProcessor::FullPlan TemplateEngine::apply_template(
        std::string_view template_id,
        std::string_view args_str,
        std::string_view source) const {
    const auto* tpl = get_template(template_id);
    if (!tpl)
        return PlanProcessor::create_plan(std::string(args_str),
                                          std::string(source));

    // Build the combined string in one allocation.
    std::string combined;
    combined.reserve(tpl->name.size() + 1 + args_str.size());
    combined.append(tpl->name);
    if (!args_str.empty()) {
        combined.push_back(' ');
        combined.append(args_str);
    }

    auto plan = PlanProcessor::create_plan(combined, std::string(source));
    plan.goal                = tpl->default_goal;
    plan.chunk_size_minutes  = tpl->default_chunk_size;
    plan.break_minutes       = tpl->default_break_minutes;
    plan.duration_minutes    = tpl->default_duration_minutes;
    plan.tags                = tpl->default_tags;
    plan.tasks               = PlanProcessor::generate_tasks(plan);
    return plan;
}

[[nodiscard]] std::string TemplateEngine::template_to_json(
        const PlanTemplate& tpl) {
    std::string out;
    out.reserve(512);
    append_template_json(out, tpl);
    return out;
}

[[nodiscard]] std::string TemplateEngine::templates_to_json(
        std::span<const PlanTemplate> tpls) {
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