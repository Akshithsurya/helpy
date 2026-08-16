#include "plan_processor.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <charconv>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstddef>
#include <ctime>
#include <filesystem>
#include <format>
#include <fstream>
#include <expected>
#include <memory>
#include <mutex>
#include <ranges>
#include <shared_mutex>
#include <span>
#include <string>
#include <string_view>
#include <system_error>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

// ---------------------------------------------------------------------------
// StringBuilder – append-only string builder.
// ---------------------------------------------------------------------------

class StringBuilder {
public:
    StringBuilder() = default;
    explicit StringBuilder(std::size_t capacity) { data_.reserve(capacity); }

    StringBuilder& operator<<(std::string_view s) { data_ += s; return *this; }
    StringBuilder& operator<<(const char* s)      { if (s) data_.append(s); return *this; }
    StringBuilder& operator<<(char c)             { data_.push_back(c); return *this; }
    StringBuilder& operator<<(bool v)             { data_.append(v ? "true" : "false"); return *this; }

    template <std::integral T>
    StringBuilder& operator<<(T v) { return append_int(v); }

    StringBuilder& operator<<(double v) {
        char buf[64];
        const int n = std::snprintf(buf, sizeof(buf), "%.2f", v);
        if (n > 0) data_.append(buf, static_cast<std::size_t>(n));
        return *this;
    }

    // std::format-based append. Forwards args as const lvalues to avoid the
    // C++20 make_format_args lifetime pitfall with prvalues.
    template <typename... Args>
    StringBuilder& format(std::string_view fmt, const Args&... args) {
        data_ += std::vformat(fmt, std::make_format_args(args...));
        return *this;
    }

    StringBuilder& append(std::string_view s)              { data_ += s; return *this; }
    StringBuilder& append(const char* s, std::size_t len)  { data_.append(s, len); return *this; }

    void reserve(std::size_t n) { data_.reserve(n); }
    void clear() noexcept       { data_.clear(); }

    [[nodiscard]] bool        empty() const noexcept { return data_.empty(); }
    [[nodiscard]] const char* c_str()  const noexcept { return data_.c_str(); }
    [[nodiscard]] std::size_t size()   const noexcept { return data_.size(); }
    [[nodiscard]] std::string_view view() const noexcept { return data_; }
    [[nodiscard]] std::string release() { return std::move(data_); }

private:
    template <typename T>
    StringBuilder& append_int(T v) {
        char buf[24];
        const auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), v);
        if (ec == std::errc())
            data_.append(buf, static_cast<std::size_t>(ptr - buf));
        return *this;
    }

    std::string data_;
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

enum class PlanError {
    InvalidDuration,
    InvalidChunkSize,
    InvalidBreakDuration,
    InvalidPreset,
    PlanNotFound,
    ParsingError,
    IOError,
};

template <typename T>
using PlanResult = std::expected<T, PlanError>;

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

struct JsonSep {
    bool first = true;
    void next(StringBuilder& sb) { if (!first) sb << ','; first = false; }
};

void json_escape(StringBuilder& sb, std::string_view s) {
    const auto* const data = s.data();
    const std::size_t  size = s.size();
    std::size_t start = 0;

    constexpr char hex_chars[] = "0123456789abcdef";

    for (std::size_t p = 0; p < size; ++p) {
        const unsigned char c = static_cast<unsigned char>(data[p]);
        if (c >= 0x20 && c != '"' && c != '\\') continue;

        if (p > start) sb.append(data + start, p - start);

        switch (c) {
            case '"':  sb.append(R"(\")"); break;
            case '\\': sb.append(R"(\\)"); break;
            case '\b': sb.append(R"(\b)");  break;
            case '\f': sb.append(R"(\f)");  break;
            case '\n': sb.append(R"(\n)");  break;
            case '\r': sb.append(R"(\r)");  break;
            case '\t': sb.append(R"(\t)");  break;
            default: {
                char buf[6] = "\\u00";
                buf[3] = hex_chars[(c >> 4) & 0xF];
                buf[4] = hex_chars[c & 0xF];
                sb.append(buf, 6);
                break;
            }
        }
        start = p + 1;
    }
    if (start < size) sb.append(data + start, size - start);
}

void json_kv_string(StringBuilder& sb, std::string_view key, std::string_view value) {
    sb << '"';
    json_escape(sb, key);
    sb << "\":\"";
    json_escape(sb, value);
    sb << '"';
}

void json_kv_int(StringBuilder& sb, std::string_view key, int value) {
    sb << '"';
    json_escape(sb, key);
    sb << "\":" << value;
}

void json_kv_bool(StringBuilder& sb, std::string_view key, bool value) {
    sb << '"';
    json_escape(sb, key);
    sb << "\":" << (value ? "true" : "false");
}

template <typename T, typename F>
void json_serialize_array(StringBuilder& sb, std::span<const T> elements, F&& serialize_element) {
    bool first = true;
    for (const auto& elem : elements) {
        if (!first) sb << ',';
        first = false;
        serialize_element(sb, elem);
    }
}

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

constexpr bool is_space(unsigned char c) noexcept {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

constexpr std::string_view trim_view(std::string_view s) noexcept {
    while (!s.empty() && is_space(static_cast<unsigned char>(s.front()))) s.remove_prefix(1);
    while (!s.empty() && is_space(static_cast<unsigned char>(s.back())))  s.remove_suffix(1);
    return s;
}

[[nodiscard]] int parse_int(std::string_view sv, int default_val) noexcept {
    if (sv.empty()) return default_val;
    int result = 0;
    const auto [ptr, ec] = std::from_chars(sv.data(), sv.data() + sv.size(), result);
    return ec == std::errc() ? result : default_val;
}

// Splits on ',' and trims each piece. Plain loop keeps it portable across
// compilers whose views::split subrange isn't string_view-constructible.
void parse_tags_into(std::string_view tags_str, std::vector<std::string>& out) {
    std::size_t start = 0;
    while (start <= tags_str.size()) {
        std::size_t comma = tags_str.find(',', start);
        const std::size_t end = (comma == std::string_view::npos) ? tags_str.size() : comma;
        auto tag = trim_view(tags_str.substr(start, end - start));
        if (!tag.empty()) out.emplace_back(tag);
        if (comma == std::string_view::npos) break;
        start = comma + 1;
    }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

constexpr int MIN_PLAN_DURATION     = 5;
constexpr int MAX_PLAN_DURATION     = 240;
constexpr int DEFAULT_PLAN_DURATION = 30;
constexpr int MIN_CHUNK_SIZE        = 1;
constexpr int MAX_CHUNK_SIZE        = 60;
constexpr int DEFAULT_CHUNK_SIZE    = 15;
constexpr int MIN_BREAK_MINUTES     = 1;
constexpr int MAX_BREAK_MINUTES     = 30;
constexpr int DEFAULT_BREAK_MINUTES = 5;

struct Preset {
    std::string_view name;
    std::string_view title;
    int duration;
    std::string_view goal;
};

constexpr std::array<Preset, 17> DEFAULT_PRESETS = {{
    {"work",      "Work Session",       60, "Focus on work tasks"},
    {"study",     "Study Session",      45, "Focus on studying"},
    {"focus",     "Deep Focus",         25, "Deep focus session"},
    {"code",      "Coding Session",     90, "Write code and solve problems"},
    {"design",    "Design Session",     60, "Create and refine designs"},
    {"write",     "Writing Session",    45, "Write articles, docs, or content"},
    {"read",      "Reading Session",    30, "Read and learn new things"},
    {"exercise",  "Exercise Session",   45, "Physical activity or workout"},
    {"meditate",  "Meditation Session", 15, "Practice mindfulness and meditation"},
    {"clean",     "Cleaning Session",   30, "Clean and organize space"},
    {"review",    "Review Session",     45, "Review work or materials"},
    {"plan",      "Planning Session",   30, "Plan and organize tasks"},
    {"sprint",    "Quick Focus Sprint", 25, "Short, focused burst of work"},
    {"blitz",     "Task Blitz",         15, "Knock out small tasks quickly"},
    {"micro",     "Micro Focus",        10, "Ultra-short focus session"},
    {"deep",      "Deep Dive",          45, "Extended focused work"},
    {"quicktask", "Quick Task Blitz",   10, "Tackle one small task"},
}};

[[nodiscard]] constexpr const Preset* find_preset(std::string_view name) noexcept {
    for (const auto& p : DEFAULT_PRESETS)
        if (p.name == name) return &p;
    return nullptr;
}

[[nodiscard]] std::vector<std::string_view> get_all_preset_names() {
    std::vector<std::string_view> names;
    names.reserve(DEFAULT_PRESETS.size());
    for (const auto& p : DEFAULT_PRESETS)
        names.push_back(p.name);
    return names;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

struct ParsedPlanArgs {
    std::string title        = "Planned session";
    std::string goal;
    int duration_minutes     = DEFAULT_PLAN_DURATION;
    int chunk_size_minutes   = DEFAULT_CHUNK_SIZE;
    int break_minutes        = DEFAULT_BREAK_MINUTES;
    std::vector<std::string> tags;
};

struct MatchResult {
    std::string_view value;
    bool consumed_next = false;
    bool matched       = false;
    [[nodiscard]] explicit operator bool() const noexcept { return matched; }
};

[[nodiscard]] constexpr MatchResult match_option(
    std::string_view tok,
    std::string_view name,
    std::string_view next_tok,
    bool has_next) noexcept
{
    // --key=value  (value must be non-empty)
    if (tok.starts_with(name) &&
        tok.size() > name.size() + 1 &&
        tok[name.size()] == '=')
        return {tok.substr(name.size() + 1), false, true};
    // --key value
    if (tok == name && has_next)
        return {next_tok, true, true};
    return {};
}

// Tokenizer that ALSO unescapes \" and \\ inside quoted strings.
[[nodiscard]] std::vector<std::string> tokenize(std::string_view s) {
    std::vector<std::string> tokens;
    tokens.reserve(16);
    std::size_t i = 0;

    while (i < s.size()) {
        while (i < s.size() && is_space(static_cast<unsigned char>(s[i]))) ++i;
        if (i >= s.size()) break;

        const char ch = s[i];
        if (ch == '"' || ch == '\'') {
            ++i;  // skip opening quote
            std::string token;
            token.reserve(16);
            while (i < s.size() && s[i] != ch) {
                if (s[i] == '\\' && i + 1 < s.size() &&
                    (s[i + 1] == ch || s[i + 1] == '\\')) {
                    token.push_back(s[i + 1]);  // unescape
                    i += 2;
                } else {
                    token.push_back(s[i]);
                    ++i;
                }
            }
            if (i < s.size()) ++i;  // skip closing quote
            tokens.push_back(std::move(token));
        } else {
            const std::size_t start = i;
            while (i < s.size() && !is_space(static_cast<unsigned char>(s[i]))) ++i;
            tokens.emplace_back(s.data() + start, i - start);
        }
    }
    return tokens;
}

[[nodiscard]] ParsedPlanArgs parse_plan_arguments(std::string_view args_str) {
    ParsedPlanArgs r;
    auto tokens = tokenize(trim_view(args_str));
    std::vector<std::string> title_parts;
    title_parts.reserve(tokens.size());

    for (std::size_t i = 0; i < tokens.size(); ++i) {
        const std::string_view tok  = tokens[i];
        const bool has_next         = i + 1 < tokens.size();
        const std::string_view next = has_next ? std::string_view{tokens[i + 1]} : std::string_view{};
        bool consumed_next = false;

        if (auto m = match_option(tok, "--goal", next, has_next)) {
            r.goal = m.value;
            consumed_next = m.consumed_next;
        } else if (auto m = match_option(tok, "--chunk", next, has_next)) {
            r.chunk_size_minutes = parse_int(m.value, r.chunk_size_minutes);
            consumed_next = m.consumed_next;
        } else if (auto m = match_option(tok, "--break", next, has_next)) {
            r.break_minutes = parse_int(m.value, r.break_minutes);
            consumed_next = m.consumed_next;
        } else if (auto m = match_option(tok, "--tags", next, has_next)) {
            parse_tags_into(m.value, r.tags);
            consumed_next = m.consumed_next;
        } else if (auto m = match_option(tok, "--duration", next, has_next)) {
            const int d = parse_int(m.value, 0);
            if (d > 0) r.duration_minutes = std::clamp(d, MIN_PLAN_DURATION, MAX_PLAN_DURATION);
            consumed_next = m.consumed_next;
        } else if (const Preset* p = find_preset(tok)) {
            r.title             = std::string(p->title);
            r.duration_minutes  = p->duration;
            if (r.goal.empty()) r.goal = std::string(p->goal);
        } else {
            title_parts.push_back(tokens[i]);
        }

        if (consumed_next) ++i;
    }

    StringBuilder title_sb;
    bool have_title = false;
    for (const auto& part : title_parts) {
        if (!part.empty() && std::isdigit(static_cast<unsigned char>(part[0]))) {
            int d;
            const auto [ptr, ec] =
                std::from_chars(part.data(), part.data() + part.size(), d);
            if (ec == std::errc() && ptr == part.data() + part.size() && d > 0) {
                r.duration_minutes = std::clamp(d, MIN_PLAN_DURATION, MAX_PLAN_DURATION);
                continue;
            }
        }
        if (have_title) title_sb << ' ';
        title_sb << part;
        have_title = true;
    }

    if (have_title)         r.title = title_sb.release();
    else if (r.title.empty()) r.title = "Planned session";

    r.chunk_size_minutes = std::clamp(r.chunk_size_minutes, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE);
    r.break_minutes      = std::clamp(r.break_minutes,      MIN_BREAK_MINUTES, MAX_BREAK_MINUTES);
    r.duration_minutes   = std::clamp(r.duration_minutes,   MIN_PLAN_DURATION, MAX_PLAN_DURATION);
    if (r.chunk_size_minutes > r.duration_minutes)
        r.chunk_size_minutes = r.duration_minutes;

    return r;
}

// ---------------------------------------------------------------------------
// Time / ID helpers
// ---------------------------------------------------------------------------

[[nodiscard]] std::string make_iso_timestamp() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tm_buf{};
#if defined(_WIN32)
    gmtime_s(&tm_buf, &t);
#else
    gmtime_r(&t, &tm_buf);
#endif
    char buf[32];
    const std::size_t n = std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm_buf);
    return (n > 0) ? std::string(buf, n) : std::string{};
}

// Counters are monotonic and don't guard any other memory; relaxed is enough.
[[nodiscard]] std::string generate_plan_id() {
    static std::atomic<std::uint64_t> seq{0};
    const auto n  = seq.fetch_add(1, std::memory_order_relaxed);
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    StringBuilder sb(32);
    sb.format("plan-{}-{}", ms, n);
    return sb.release();
}

[[nodiscard]] std::uint64_t next_task_group_id() noexcept {
    static std::atomic<std::uint64_t> tg_seq{0};
    return tg_seq.fetch_add(1, std::memory_order_relaxed);
}

// ---------------------------------------------------------------------------
// Task descriptor selection
// ---------------------------------------------------------------------------

constexpr std::array<std::string_view, 5> DESCRIPTORS = {
    "Start strong", "Keep going", "Making progress", "Almost there", "Final push"
};

[[nodiscard]] constexpr std::string_view descriptor_for_progress(double fraction) noexcept {
    if (fraction < 0.0) fraction = 0.0;
    if (fraction > 1.0) fraction = 1.0;
    const auto idx = static_cast<std::size_t>(fraction * DESCRIPTORS.size());
    return DESCRIPTORS[std::min(idx, DESCRIPTORS.size() - 1)];
}

[[nodiscard]] constexpr bool validate_plan(
    int total_duration, int chunk_size, int break_duration) noexcept
{
    return total_duration >= MIN_PLAN_DURATION && total_duration <= MAX_PLAN_DURATION &&
           chunk_size     >= MIN_CHUNK_SIZE    && chunk_size     <= total_duration &&
           break_duration >= MIN_BREAK_MINUTES && break_duration <= MAX_BREAK_MINUTES;
}

// ---------------------------------------------------------------------------
// Plan storage (thread-safe, heterogeneous-lookup unordered_map)
// ---------------------------------------------------------------------------

struct StringHash {
    using is_transparent = void;
    using hash_type = std::hash<std::string_view>;
    std::size_t operator()(std::string_view sv) const noexcept { return hash_type{}(sv); }
    std::size_t operator()(const std::string& s)      const noexcept { return hash_type{}(s); }
    std::size_t operator()(const char* s)              const noexcept { return hash_type{}(s); }
};

using PlanMap = std::unordered_map<std::string, FullPlan, StringHash, std::equal_to<>>;

class PlanStore {
public:
    void add_plan(FullPlan plan) {
        std::unique_lock lock(mutex_);
        const std::string id = plan.id;
        plans_[std::move(id)] = std::move(plan);
    }

    [[nodiscard]] PlanResult<FullPlan> get_plan(std::string_view id) const {
        std::shared_lock lock(mutex_);
        auto it = plans_.find(id);
        if (it == plans_.end()) return std::unexpected(PlanError::PlanNotFound);
        return it->second;
    }

    [[nodiscard]] PlanResult<std::vector<FullPlan>> get_all_plans() const {
        std::shared_lock lock(mutex_);
        std::vector<FullPlan> result;
        result.reserve(plans_.size());
        for (const auto& [_, plan] : plans_) result.push_back(plan);
        return result;
    }

    PlanResult<void> delete_plan(std::string_view id) {
        std::unique_lock lock(mutex_);
        if (auto it = plans_.find(id); it != plans_.end()) {
            plans_.erase(it);
            return {};
        }
        return std::unexpected(PlanError::PlanNotFound);
    }

    [[nodiscard]] PlanResult<void> save_to_file(const std::filesystem::path& path) const {
        std::shared_lock lock(mutex_);
        std::ofstream file(path);
        if (!file.is_open()) return std::unexpected(PlanError::IOError);

        file << '[';
        bool first = true;
        for (const auto& [_, plan] : plans_) {
            if (!first) file << ',';
            first = false;
            file << plan_to_json(plan);
        }
        file << ']';
        file.flush();
        if (!file) return std::unexpected(PlanError::IOError);
        return {};
    }

private:
    mutable std::shared_mutex mutex_;
    PlanMap plans_;
};

}  // namespace

// ===========================================================================
// Public API
// ===========================================================================

namespace PlanProcessor {

namespace {
    PlanStore global_plan_store;
}

[[nodiscard]] FullPlan create_plan(std::string_view args_str, std::string source) {
    ParsedPlanArgs parsed = parse_plan_arguments(args_str);

    FullPlan plan;
    plan.id                 = generate_plan_id();
    plan.title              = std::move(parsed.title);
    plan.goal               = std::move(parsed.goal);
    plan.duration_minutes   = parsed.duration_minutes;
    plan.chunk_size_minutes = parsed.chunk_size_minutes;
    plan.break_minutes      = parsed.break_minutes;
    plan.status             = "pending";
    plan.source             = std::move(source);
    plan.tags               = std::move(parsed.tags);
    plan.created_at         = make_iso_timestamp();
    plan.tasks              = generate_tasks(plan);

    global_plan_store.add_plan(plan);
    return plan;
}

[[nodiscard]] std::vector<PlanTask> generate_tasks(const FullPlan& plan) {
    std::vector<PlanTask> tasks;
    const int total = plan.duration_minutes;
    const int chunk = plan.chunk_size_minutes;
    const int brk   = plan.break_minutes;
    if (total <= 0 || chunk <= 0) return tasks;

    const auto group_id = next_task_group_id();
    int remaining = total;
    int elapsed   = 0;
    int idx       = 0;

    tasks.reserve(static_cast<std::size_t>(total / std::max(chunk, 1)) * 2 + 2);

    while (remaining > 0) {
        const int dur = std::min(chunk, remaining);
        const double progress = static_cast<double>(elapsed) / static_cast<double>(total);
        const std::string_view desc = descriptor_for_progress(progress);

        PlanTask t;
        {
            StringBuilder id_sb;
            id_sb.format("task-{}-{}", group_id, idx);
            t.id = id_sb.release();
        }
        {
            StringBuilder title_sb;
            if (!plan.goal.empty()) title_sb.format("{}: {}", desc, plan.goal);
            else                    title_sb.format("{} - Part {}", desc, idx + 1);
            t.title = title_sb.release();
        }
        t.duration_minutes = dur;
        t.completed        = false;
        t.is_break         = false;
        tasks.push_back(std::move(t));

        remaining -= dur;
        elapsed   += dur;
        ++idx;

        if (remaining > 0 && brk > 0) {
            PlanTask b;
            {
                StringBuilder bid_sb;
                bid_sb.format("task-{}-{}-break", group_id, idx);
                b.id = bid_sb.release();
            }
            b.title             = "Take a break";
            b.duration_minutes  = brk;
            b.completed         = false;
            b.is_break          = true;
            tasks.push_back(std::move(b));
            ++idx;
        }
    }
    return tasks;
}

[[nodiscard]] std::string plan_to_json(const FullPlan& plan) {
    StringBuilder sb;
    sb.reserve(256 +
               plan.title.size() + plan.goal.size() +
               plan.source.size() + plan.id.size() +
               plan.tags.size()  * 16 +
               plan.tasks.size() * 96);

    sb << '{';
    JsonSep sep;
    sep.next(sb); json_kv_string(sb, "id",               plan.id);
    sep.next(sb); json_kv_string(sb, "title",            plan.title);
    sep.next(sb); json_kv_string(sb, "goal",             plan.goal);
    sep.next(sb); json_kv_int   (sb, "durationMinutes",  plan.duration_minutes);
    sep.next(sb); json_kv_int   (sb, "chunkSizeMinutes", plan.chunk_size_minutes);
    sep.next(sb); json_kv_int   (sb, "breakMinutes",     plan.break_minutes);
    sep.next(sb); json_kv_string(sb, "status",           plan.status);
    sep.next(sb); json_kv_string(sb, "createdAt",        plan.created_at);
    sep.next(sb); json_kv_string(sb, "source",           plan.source);

    sep.next(sb);
    sb << "\"tags\":[";
    json_serialize_array(sb, std::span<const std::string>(plan.tags),
        [](StringBuilder& asb, const std::string& tag) {
            asb << '"';
            json_escape(asb, tag);
            asb << '"';
        });
    sb << ']';

    sep.next(sb);
    sb << "\"tasks\":[";
    json_serialize_array(sb, std::span<const PlanTask>(plan.tasks),
        [](StringBuilder& asb, const PlanTask& task) {
            asb << '{';
            JsonSep ts;
            ts.next(asb); json_kv_string(asb, "id",              task.id);
            ts.next(asb); json_kv_string(asb, "title",           task.title);
            ts.next(asb); json_kv_int   (asb, "durationMinutes", task.duration_minutes);
            ts.next(asb); json_kv_bool  (asb, "completed",       task.completed);
            ts.next(asb); json_kv_bool  (asb, "isBreak",         task.is_break);
            asb << '}';
        });
    sb << ']';

    sb << '}';
    return sb.release();
}

[[nodiscard]] PlanResult<FullPlan> get_plan(std::string_view id) {
    return global_plan_store.get_plan(id);
}

[[nodiscard]] PlanResult<std::vector<FullPlan>> get_all_plans() {
    return global_plan_store.get_all_plans();
}

PlanResult<void> delete_plan(std::string_view id) {
    return global_plan_store.delete_plan(id);
}

PlanResult<void> save_plans(const std::filesystem::path& path) {
    return global_plan_store.save_to_file(path);
}

[[nodiscard]] std::vector<std::string_view> get_preset_names() {
    return get_all_preset_names();
}

}  // namespace PlanProcessor