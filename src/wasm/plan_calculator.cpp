// productivity.cpp — Emscripten (WASM) productivity planner module.
//
// Dual-build: compiles under Emscripten (-s WASM=1) AND as a plain
// native object (g++ -c productivity.cpp) so it can be unit-tested
// without a browser.
//
// Requires C++17 or later (for std::string_view, std::to_chars, std::from_chars,
// std::optional).
// ===========================================================================

#ifdef __EMSCRIPTEN__
#  include <emscripten.h>
#  define KEEPALIVE [[nodiscard]] EMSCRIPTEN_KEEPALIVE
#else
#  define KEEPALIVE [[nodiscard]]
#endif

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

// ===========================================================================
// StringBuilder — minimal mutable string builder used for assembling JSON
// output. Avoids repeated reallocations of std::string += and the overhead
// of std::ostringstream. Uses C++17 std::to_chars for fast, safe integer
// formatting.
// ===========================================================================
class StringBuilder {
public:
    StringBuilder() { data_.reserve(INITIAL_CAPACITY); }
    explicit StringBuilder(std::size_t capacity) { data_.reserve(capacity); }

    StringBuilder& operator<<(const char* s) {
        if (s) data_.append(s);
        return *this;
    }
    StringBuilder& operator<<(char c) { data_.push_back(c); return *this; }
    StringBuilder& operator<<(const std::string& s) { data_.append(s); return *this; }
    StringBuilder& operator<<(std::string_view s) { data_.append(s); return *this; }

    StringBuilder& operator<<(bool v) {
        data_.append(v ? "true" : "false");
        return *this;
    }

    StringBuilder& operator<<(int v) {
        char buf[16];
        auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), v);
        if (ec == std::errc()) {
            data_.append(buf, static_cast<std::size_t>(ptr - buf));
        }
        return *this;
    }

    StringBuilder& operator<<(unsigned int v) {
        char buf[16];
        auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), v);
        if (ec == std::errc()) {
            data_.append(buf, static_cast<std::size_t>(ptr - buf));
        }
        return *this;
    }

    StringBuilder& operator<<(long long v) {
        char buf[24];
        auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), v);
        if (ec == std::errc()) {
            data_.append(buf, static_cast<std::size_t>(ptr - buf));
        }
        return *this;
    }

    StringBuilder& operator<<(unsigned long long v) {
        char buf[24];
        auto [ptr, ec] = std::to_chars(buf, buf + sizeof(buf), v);
        if (ec == std::errc()) {
            data_.append(buf, static_cast<std::size_t>(ptr - buf));
        }
        return *this;
    }

    StringBuilder& operator<<(double v) {
        char buf[64];
        int n = std::snprintf(buf, sizeof(buf), "%.2f", v);
        if (n > 0) data_.append(buf, static_cast<std::size_t>(n));
        return *this;
    }

    StringBuilder& operator<<(float v) {
        return *this << static_cast<double>(v);
    }

    StringBuilder& append(const char* s, std::size_t n) {
        if (s) data_.append(s, n);
        return *this;
    }

    /// Append a character repeated `n` times.
    StringBuilder& append_char(char c, std::size_t n) {
        data_.append(n, c);
        return *this;
    }

    void reserve(std::size_t n) { data_.reserve(n); }
    const char* c_str() const noexcept { return data_.c_str(); }
    std::size_t length() const noexcept { return data_.size(); }
    bool empty() const noexcept { return data_.empty(); }

    std::string str() const & { return data_; }
    [[nodiscard]] std::string release() { return std::move(data_); }

private:
    static constexpr std::size_t INITIAL_CAPACITY = 512;
    std::string data_;
};

// ===========================================================================
// RAII-friendly C-string duplication. Every export funnels through this
// so malloc-failure handling is uniform (throws std::bad_alloc, which the
// try/catch wrappers in the exported functions turn into JSON error payloads).
// ===========================================================================
[[nodiscard]] char* dup_to_c_string(const char* data, std::size_t n) {
    if (!data) n = 0;
    char* p = static_cast<char*>(std::malloc(n + 1));
    if (!p) throw std::bad_alloc();
    if (n > 0) std::memcpy(p, data, n);
    p[n] = '\0';
    return p;
}
[[nodiscard]] char* dup_to_c_string(const std::string& s) {
    return dup_to_c_string(s.c_str(), s.size());
}
[[nodiscard]] char* dup_to_c_string(const StringBuilder& sb) {
    return dup_to_c_string(sb.c_str(), sb.length());
}

// ===========================================================================
// JSON helpers
// ===========================================================================

/// Escape a string_view for inclusion inside JSON double-quotes.
void json_escape(StringBuilder& sb, std::string_view s) {
    if (s.empty()) return;
    std::size_t start = 0;
    const char* data = s.data();
    std::size_t size = s.size();

    while (start < size) {
        // Fast-skip loop: highly optimizable by compilers.
        std::size_t p = start;
        while (p < size) {
            unsigned char c = static_cast<unsigned char>(data[p]);
            if (c < 0x20 || c == '"' || c == '\\') {
                break;
            }
            ++p;
        }
        if (p > start) {
            sb.append(data + start, p - start);
        }
        if (p == size) {
            break;
        }

        unsigned char c = static_cast<unsigned char>(data[p]);
        switch (c) {
            case '"':  sb << "\\\""; break;
            case '\\': sb << "\\\\"; break;
            case '\b': sb << "\\b";  break;
            case '\f': sb << "\\f";  break;
            case '\n': sb << "\\n";  break;
            case '\r': sb << "\\r";  break;
            case '\t': sb << "\\t";  break;
            default: {
                // RFC 8259: control chars must be \uXXXX-escaped.
                char hex[7] = "\\u0000";
                const char* hex_chars = "0123456789abcdef";
                hex[4] = hex_chars[(c >> 4) & 0xF];
                hex[5] = hex_chars[c & 0xF];
                sb.append(hex, 6);
                break;
            }
        }
        start = p + 1;
    }
}

/// Write a JSON string literal (with surrounding double-quotes).
void json_string(StringBuilder& sb, std::string_view s) {
    sb << '"';
    json_escape(sb, s);
    sb << '"';
}

/// Write a JSON key-value pair with a string value.
void json_kv_string(StringBuilder& sb, std::string_view key, std::string_view value) {
    json_string(sb, key);
    sb << ':';
    json_string(sb, value);
}

/// Write a JSON key-value pair with an integer value.
void json_kv_int(StringBuilder& sb, std::string_view key, long long value) {
    json_string(sb, key);
    sb << ':' << value;
}

/// Write a JSON key-value pair with a boolean value.
void json_kv_bool(StringBuilder& sb, std::string_view key, bool value) {
    json_string(sb, key);
    sb << ':' << (value ? "true" : "false");
}

/// Write a JSON array of strings.
void json_string_array(StringBuilder& sb, const std::vector<std::string>& items) {
    sb << '[';
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (i > 0) sb << ',';
        json_string(sb, items[i]);
    }
    sb << ']';
}

/// Build a JSON error object and duplicate to a C string.
[[nodiscard]] char* json_error(const char* msg) {
    StringBuilder sb;
    sb << "{\"error\":\"";
    json_escape(sb, std::string_view(msg ? msg : "Unknown error"));
    sb << "\"}";
    return dup_to_c_string(sb);
}

// ===========================================================================
// String utilities
// ===========================================================================
constexpr std::string_view trim_view(std::string_view s) {
    if (s.empty()) return s;
    std::size_t start = 0, end = s.size();
    while (start < end && std::isspace(static_cast<unsigned char>(s[start]))) ++start;
    while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) --end;
    return s.substr(start, end - start);
}

[[nodiscard]] std::string trim(std::string_view s) {
    return std::string(trim_view(s));
}

constexpr int clamp_int(int v, int lo, int hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

[[nodiscard]] int parse_int(std::string_view sv, int default_val) noexcept {
    int result = default_val;
    if (!sv.empty()) {
        std::from_chars(sv.data(), sv.data() + sv.size(), result);
    }
    return result;
}

constexpr bool starts_with(std::string_view sv, std::string_view prefix) noexcept {
    return sv.size() >= prefix.size() && sv.substr(0, prefix.size()) == prefix;
}

// ===========================================================================
// Deterministic PRNG — xorshift32 seeded once from the steady_clock.
// ===========================================================================
class Rng {
public:
    static Rng& instance() {
        static Rng r;
        return r;
    }
    unsigned int next() noexcept {
        x_ ^= x_ << 13;
        x_ ^= x_ >> 17;
        x_ ^= x_ << 5;
        return x_;
    }
    unsigned int next_mod(unsigned int m) noexcept {
        if (m == 0) return 0;
        return next() % m;
    }
private:
    Rng() {
        auto seed = static_cast<unsigned long long>(
            std::chrono::steady_clock::now().time_since_epoch().count());
        seed ^= reinterpret_cast<uintptr_t>(this);
        x_ = static_cast<unsigned int>(seed | 1u);  // xorshift32 needs nonzero state
        for (int i = 0; i < 4; ++i) {  // warm up
            next();
        }
    }
    unsigned int x_;
};

// ===========================================================================
// Timer mode configuration
// ===========================================================================
struct TimerModeConfig {
    int work_duration;
    int break_duration;
    int long_break_duration;
    int long_break_interval;
};

constexpr std::array<TimerModeConfig, 4> TIMER_CONFIGS = {{
    {25, 5,  15, 4},  // TIMER_MODE_POMODORO
    {90, 20, 30, 1},  // TIMER_MODE_ULTRADIAN
    {90, 20, 30, 1},  // TIMER_MODE_90MINUTE
    {25, 5,  15, 4},  // TIMER_MODE_CUSTOM
}};

constexpr const TimerModeConfig& get_timer_config(int mode) noexcept {
    if (mode < 0 || mode >= static_cast<int>(TIMER_CONFIGS.size())) {
        return TIMER_CONFIGS[0];
    }
    return TIMER_CONFIGS[mode];
}

// ===========================================================================
// Plan argument parsing
// ===========================================================================
constexpr int MIN_PLAN_DURATION     = 5;
constexpr int MAX_PLAN_DURATION     = 240;
constexpr int DEFAULT_PLAN_DURATION = 30;
constexpr int DEFAULT_CHUNK_SIZE    = 15;
constexpr int DEFAULT_BREAK_MINUTES = 5;
constexpr int MIN_CHUNK_SIZE        = 1;
constexpr int MAX_CHUNK_SIZE        = 60;
constexpr int MIN_BREAK_MINUTES     = 1;
constexpr int MAX_BREAK_MINUTES     = 30;

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

struct ParsedPlanArgs {
    std::string title        = "Planned session";
    std::string goal;
    int duration_minutes     = DEFAULT_PLAN_DURATION;
    int chunk_size_minutes   = DEFAULT_CHUNK_SIZE;
    int break_minutes        = DEFAULT_BREAK_MINUTES;
    std::vector<std::string> tags;
    std::string used_preset;
};

/// Tokenize a command-line style string into string_views.
[[nodiscard]] std::vector<std::string_view> tokenize(std::string_view s) {
    std::vector<std::string_view> tokens;
    tokens.reserve(16);
    std::size_t i = 0;
    while (i < s.size()) {
        while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
        if (i >= s.size()) break;

        if (s[i] == '"' || s[i] == '\'') {
            char quote = s[i];
            std::size_t start = ++i;  // skip opening quote
            while (i < s.size() && s[i] != quote) ++i;
            tokens.push_back(s.substr(start, i - start));
            if (i < s.size()) ++i;  // skip closing quote
        } else {
            std::size_t start = i;
            while (i < s.size() && !std::isspace(static_cast<unsigned char>(s[i]))) ++i;
            tokens.push_back(s.substr(start, i - start));
        }
    }
    return tokens;
}

/// Extract a flag value from either "--flag=value" or "--flag value" form.
/// Returns nullopt if `tok` doesn't match `flag`. When the value comes from
/// the next token, `i` is advanced.
std::optional<std::string_view> flag_value(
    std::string_view tok, std::string_view flag,
    std::size_t& i, const std::vector<std::string_view>& tokens)
{
    if (!starts_with(tok, flag)) return std::nullopt;
    if (tok.size() == flag.size()) {
        // "--flag" → consume next token as value
        if (i + 1 < tokens.size()) {
            return tokens[++i];
        }
        return std::nullopt;
    }
    if (tok[flag.size()] == '=') {
        // "--flag=value"
        return tok.substr(flag.size() + 1);
    }
    return std::nullopt;  // "--flagXYZ" doesn't match "--flag"
}

/// Parse a comma-separated tag list into a vector of trimmed strings.
void parse_tags(std::string_view tags_str, std::vector<std::string>& out) {
    std::size_t start = 0;
    while (start < tags_str.size()) {
        std::size_t end = tags_str.find(',', start);
        if (end == std::string_view::npos) end = tags_str.size();
        auto token = trim_view(tags_str.substr(start, end - start));
        if (!token.empty()) out.emplace_back(token);
        start = end + 1;
    }
}

/// Check if a string_view is entirely digits (and non-empty).
bool is_all_digits(std::string_view sv) noexcept {
    if (sv.empty()) return false;
    for (char c : sv) {
        if (!std::isdigit(static_cast<unsigned char>(c))) return false;
    }
    return true;
}

[[nodiscard]] ParsedPlanArgs parse_plan_arguments(std::string_view args_str) {
    ParsedPlanArgs r;
    auto tokens = tokenize(trim_view(args_str));
    std::vector<std::string_view> title_parts;
    title_parts.reserve(tokens.size());

    for (std::size_t i = 0; i < tokens.size(); ++i) {
        std::string_view tok = tokens[i];

        if (auto v = flag_value(tok, "--goal", i, tokens)) {
            r.goal = std::string(*v);
        } else if (auto v = flag_value(tok, "--chunk", i, tokens)) {
            r.chunk_size_minutes = parse_int(*v, r.chunk_size_minutes);
        } else if (auto v = flag_value(tok, "--break", i, tokens)) {
            r.break_minutes = parse_int(*v, r.break_minutes);
        } else if (auto v = flag_value(tok, "--tags", i, tokens)) {
            parse_tags(*v, r.tags);
        } else if (auto v = flag_value(tok, "--duration", i, tokens)) {
            int d = parse_int(*v, 0);
            if (d > 0) r.duration_minutes = clamp_int(d, MIN_PLAN_DURATION, MAX_PLAN_DURATION);
        } else {
            // Check if it's a preset
            bool is_preset = false;
            for (const auto& p : DEFAULT_PRESETS) {
                if (tok == p.name) {
                    r.title = std::string(p.title);
                    r.duration_minutes = p.duration;
                    if (r.goal.empty()) r.goal = std::string(p.goal);
                    r.used_preset = std::string(p.name);
                    is_preset = true;
                    break;
                }
            }
            if (!is_preset) {
                // Check if it's a standalone number (duration override)
                if (is_all_digits(tok)) {
                    int d = parse_int(tok, 0);
                    if (d > 0) {
                        r.duration_minutes = clamp_int(d, MIN_PLAN_DURATION, MAX_PLAN_DURATION);
                    }
                } else {
                    title_parts.push_back(tok);
                }
            }
        }
    }

    if (!title_parts.empty()) {
        StringBuilder title_sb;
        for (std::size_t i = 0; i < title_parts.size(); ++i) {
            if (i > 0) title_sb << ' ';
            title_sb << title_parts[i];
        }
        r.title = title_sb.release();
    } else if (r.title.empty()) {
        r.title = "Planned session";
    }

    r.chunk_size_minutes = clamp_int(r.chunk_size_minutes, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE);
    r.break_minutes      = clamp_int(r.break_minutes, MIN_BREAK_MINUTES, MAX_BREAK_MINUTES);
    r.duration_minutes   = clamp_int(r.duration_minutes, MIN_PLAN_DURATION, MAX_PLAN_DURATION);
    return r;
}

// ===========================================================================
// Plan domain types
// ===========================================================================
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
    std::vector<PlanTask> tasks;
    std::string status;
    std::string created_at;
    std::string source;
    std::vector<std::string> tags;
};

[[nodiscard]] std::string generate_plan_id() {
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    char hex[9];
    for (int i = 0; i < 8; ++i) {
        hex[i] = "0123456789abcdef"[Rng::instance().next() & 15];
    }
    hex[8] = '\0';

    StringBuilder sb(40);
    sb << "plan-" << ms << '-' << hex;
    return sb.release();
}

[[nodiscard]] std::string make_iso_timestamp() {
    auto now = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    char buf[32];
    std::tm tm_buf{};
#if defined(_WIN32)
    gmtime_s(&tm_buf, &t);
#else
    gmtime_r(&t, &tm_buf);
#endif
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm_buf);
    return std::string(buf);
}

[[nodiscard]] std::vector<PlanTask> build_plan_tasks(const FullPlan& plan) {
    static constexpr std::array<std::string_view, 5> DESCRIPTORS = {
        "Start strong", "Keep going", "Making progress", "Almost there", "Final push"
    };

    std::vector<PlanTask> tasks;
    const int total = plan.duration_minutes;
    const int chunk = plan.chunk_size_minutes;
    const int brk   = plan.break_minutes;
    if (total <= 0 || chunk <= 0) return tasks;

    unsigned int seed = Rng::instance().next();
    int remaining = total;
    int chunk_index = 0;

    tasks.reserve(static_cast<std::size_t>(total / chunk) * 2 + 2);

    while (remaining > 0) {
        int dur = std::min(chunk, remaining);
        std::size_t desc_idx = std::min(static_cast<std::size_t>(chunk_index),
                                        DESCRIPTORS.size() - 1);

        PlanTask t;
        StringBuilder id_sb;
        id_sb << "task-" << seed << '-' << chunk_index;
        t.id = id_sb.release();

        StringBuilder title_sb;
        if (!plan.goal.empty()) {
            title_sb << DESCRIPTORS[desc_idx] << ": " << plan.goal;
        } else {
            title_sb << DESCRIPTORS[desc_idx] << " - Part " << (chunk_index + 1);
        }
        t.title = title_sb.release();
        t.duration_minutes = dur;
        t.completed = false;
        t.is_break = false;
        tasks.push_back(std::move(t));

        remaining -= dur;
        ++chunk_index;

        if (remaining > 0 && brk > 0) {
            PlanTask b;
            StringBuilder bid_sb;
            bid_sb << "task-" << seed << '-' << chunk_index << "-break";
            b.id = bid_sb.release();
            b.title = "Take a break";
            b.duration_minutes = brk;
            b.completed = false;
            b.is_break = true;
            tasks.push_back(std::move(b));
            ++chunk_index;
        }
    }
    return tasks;
}

[[nodiscard]] FullPlan create_full_plan(std::string_view args_str,
                                        std::string_view source = "cpp-wasm") {
    ParsedPlanArgs parsed = parse_plan_arguments(args_str);
    FullPlan plan;
    plan.id                = generate_plan_id();
    plan.title             = std::move(parsed.title);
    plan.goal              = std::move(parsed.goal);
    plan.duration_minutes  = parsed.duration_minutes;
    plan.chunk_size_minutes= parsed.chunk_size_minutes;
    plan.break_minutes     = parsed.break_minutes;
    plan.status            = "pending";
    plan.source            = std::string(source);
    plan.tags              = std::move(parsed.tags);
    plan.created_at        = make_iso_timestamp();
    plan.tasks             = build_plan_tasks(plan);
    return plan;
}

// ===========================================================================
// Smart plan recommendation (internal helper)
// ===========================================================================
struct SmartPlanRecommendation {
    int optimal_work_minutes;
    int optimal_break_minutes;
    int estimated_productivity_gain;
    std::string recommendation;
};

[[nodiscard]] SmartPlanRecommendation compute_smart_plan_recommendation(
    int total_available_minutes, int work_intensity, int user_energy_level)
{
    SmartPlanRecommendation r{};
    work_intensity          = clamp_int(work_intensity, 1, 100);
    user_energy_level       = clamp_int(user_energy_level, 1, 100);
    total_available_minutes = std::max(15, total_available_minutes);

    if (user_energy_level >= 80 && work_intensity >= 70) {
        r.optimal_work_minutes = 60;
        r.recommendation = "You're in deep work mode! Take advantage of your high energy with longer focus blocks.";
    } else if (user_energy_level >= 60) {
        r.optimal_work_minutes = 45;
        r.recommendation = "Balanced energy levels - standard focus blocks with moderate breaks should work well.";
    } else if (user_energy_level >= 40) {
        r.optimal_work_minutes = 30;
        r.recommendation = "Lower energy levels - shorter, more frequent focus blocks will help maintain productivity.";
    } else {
        r.optimal_work_minutes = 20;
        r.recommendation = "Low energy - consider light tasks with very short focus bursts.";
    }

    if (total_available_minutes < 30) {
        r.optimal_work_minutes = std::min(r.optimal_work_minutes, 20);
    } else if (total_available_minutes < 60) {
        r.optimal_work_minutes = std::min(r.optimal_work_minutes, 30);
    }

    r.optimal_break_minutes = clamp_int(r.optimal_work_minutes / 5, 3, 15);
    r.estimated_productivity_gain = std::min(35, 10 + (work_intensity / 10) + (user_energy_level / 20));
    return r;
}

} // anonymous namespace

// ===========================================================================
// Exported C ABI. Every KEEPALIVE function below preserves its original
// name AND signature so existing JS callers do not break.
// ===========================================================================
extern "C" {

KEEPALIVE
int calculate_num_chunks(int total_duration, int chunk_size) {
    if (chunk_size <= 0) chunk_size = 15;
    if (total_duration <= 0) return 1;
    return (total_duration + chunk_size - 1) / chunk_size;
}

KEEPALIVE
int calculate_chunk_duration(int total_duration, int chunk_size,
                             int chunk_index, int num_chunks) {
    if (chunk_index < 0 || chunk_index >= num_chunks) return 0;
    if (chunk_index < num_chunks - 1) return chunk_size;
    int last = total_duration - chunk_size * (num_chunks - 1);
    return last > 0 ? last : chunk_size;
}

KEEPALIVE
char* generate_task_title(const char* goal, const char* descriptor, int part_number) {
    try {
        std::string_view goal_sv = goal ? std::string_view(goal) : "";
        std::string_view desc_sv = descriptor ? std::string_view(descriptor) : "Task";

        StringBuilder sb;
        if (!goal_sv.empty()) {
            sb << desc_sv << ": ";
            json_escape(sb, goal_sv);
        } else {
            sb << desc_sv << " - Part " << part_number;
        }
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate task title");
    }
}

KEEPALIVE
void free_string(char* str) {
    if (str) std::free(str);
}

KEEPALIVE
int validate_plan(int total_duration, int chunk_size, int break_duration) {
    return (total_duration > 0 &&
            chunk_size > 0 &&
            chunk_size <= total_duration &&
            break_duration >= 0) ? 1 : 0;
}

KEEPALIVE
int calculate_num_breaks(int total_duration, int chunk_size, int break_duration) {
    (void)break_duration;
    int num_chunks = calculate_num_chunks(total_duration, chunk_size);
    return num_chunks > 1 ? num_chunks - 1 : 0;
}

KEEPALIVE
int calculate_total_duration_with_breaks(int total_duration, int chunk_size, int break_duration) {
    int num_breaks = calculate_num_breaks(total_duration, chunk_size, break_duration);
    return total_duration + num_breaks * break_duration;
}

KEEPALIVE
char* generate_full_plan_json(int total_duration, int chunk_size,
                              int break_duration, const char* goal,
                              const char* descriptor) {
    try {
        int num_chunks = calculate_num_chunks(total_duration, chunk_size);
        StringBuilder sb(static_cast<std::size_t>(num_chunks) * 160);

        std::string_view goal_sv = goal ? std::string_view(goal) : "";
        std::string_view desc_sv = descriptor ? std::string_view(descriptor) : "";

        sb << '[';
        for (int i = 0; i < num_chunks; ++i) {
            int chunk_dur = calculate_chunk_duration(total_duration, chunk_size, i, num_chunks);
            sb << "{\"type\":\"task\",\"title\":";

            if (!goal_sv.empty()) {
                StringBuilder title_sb;
                if (!desc_sv.empty()) {
                    title_sb << desc_sv << ": ";
                }
                title_sb << goal_sv;
                json_string(sb, title_sb.str());
            } else {
                StringBuilder title_sb;
                if (!desc_sv.empty()) {
                    title_sb << desc_sv << " - Part " << (i + 1);
                } else {
                    title_sb << "Task - Part " << (i + 1);
                }
                json_string(sb, title_sb.str());
            }
            sb << ",\"duration\":" << chunk_dur << '}';

            if (i < num_chunks - 1 && break_duration > 0) {
                sb << ",{\"type\":\"break\",\"title\":\"Take a break\",\"duration\":"
                   << break_duration << '}';
            }
        }
        sb << ']';
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate full plan JSON");
    }
}

KEEPALIVE
int optimize_chunk_size(int total_duration, int avg_focus_time, int distraction_rate) {
    if (avg_focus_time <= 0) avg_focus_time = 25;
    distraction_rate = clamp_int(distraction_rate, 0, 100);
    int base = avg_focus_time;
    int adjustment = (100 - distraction_rate) / 10;
    int optimal = clamp_int(base + adjustment, 10, 60);
    if (optimal > total_duration) optimal = total_duration;
    return optimal;
}

KEEPALIVE
int optimize_break_duration(int chunk_size, int work_intensity) {
    work_intensity = clamp_int(work_intensity, 0, 100);
    float ratio = work_intensity / 100.0f;
    int base_break = chunk_size / 5;
    int optimal = static_cast<int>(base_break * (1.0f + ratio * 0.5f));
    return clamp_int(optimal, 3, 15);
}

KEEPALIVE
int calculate_productivity_score(int total_duration, int chunk_size,
                                 int break_duration, int num_completed_tasks) {
    if (total_duration <= 0) return 0;
    int num_chunks = calculate_num_chunks(total_duration, chunk_size);
    if (num_chunks <= 0) return 0;
    float efficiency = static_cast<float>(num_completed_tasks) / num_chunks;
    int score = static_cast<int>(efficiency * 100);
    if (chunk_size > 0) {
        float break_ratio = static_cast<float>(break_duration) / chunk_size;
        if (break_ratio >= 0.2f && break_ratio <= 0.4f) score += 10;
    }
    return clamp_int(score, 0, 100);
}

KEEPALIVE
int validate_dependencies(const char* dependencies_json) {
    if (!dependencies_json || dependencies_json[0] == '\0') return 1;
    int open = 0;
    bool in_string = false;
    bool escaped = false;
    for (const char* p = dependencies_json; *p; ++p) {
        char c = *p;
        if (escaped) { escaped = false; continue; }
        if (c == '\\') { escaped = true; continue; }
        if (c == '"') { in_string = !in_string; continue; }
        if (in_string) continue;
        if (c == '[' || c == '{') ++open;
        else if (c == ']' || c == '}') {
            --open;
            if (open < 0) return 0;
        }
    }
    return (open == 0 && !in_string) ? 1 : 0;
}

KEEPALIVE
int topological_sort_check(int num_tasks, const char* adjacency_list) {
    (void)num_tasks;
    (void)adjacency_list;
    return 1;
}

#define TIMER_MODE_POMODORO  0
#define TIMER_MODE_ULTRADIAN 1
#define TIMER_MODE_90MINUTE  2
#define TIMER_MODE_CUSTOM    3

KEEPALIVE int get_work_duration_for_mode(int mode) { return get_timer_config(mode).work_duration; }
KEEPALIVE int get_break_duration_for_mode(int mode) { return get_timer_config(mode).break_duration; }
KEEPALIVE int get_long_break_for_mode(int mode) { return get_timer_config(mode).long_break_duration; }
KEEPALIVE int get_long_break_interval_for_mode(int mode) { return get_timer_config(mode).long_break_interval; }

KEEPALIVE
char* generate_timer_plan(int mode, int total_cycles) {
    try {
        if (total_cycles <= 0)  total_cycles = 4;
        if (total_cycles > 20)  total_cycles = 20;
        const auto& cfg = get_timer_config(mode);
        StringBuilder sb(static_cast<std::size_t>(total_cycles) * 120);
        sb << '[';
        for (int i = 0; i < total_cycles; ++i) {
            sb << "{\"type\":\"work\",\"cycle\":" << (i + 1)
               << ",\"duration\":" << cfg.work_duration << '}';
            if (i < total_cycles - 1) {
                int cur_break = ((i + 1) % cfg.long_break_interval == 0)
                                ? cfg.long_break_duration : cfg.break_duration;
                sb << ",{\"type\":\"break\",\"cycle\":" << (i + 1)
                   << ",\"duration\":" << cur_break << '}';
            }
        }
        sb << ']';
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate timer plan");
    }
}

KEEPALIVE
char* generate_pomodoro_plan(int work_min, int short_break, int long_break,
                             int cycles_before_long, int total_cycles) {
    try {
        if (work_min <= 0)            work_min = 25;
        if (short_break <= 0)         short_break = 5;
        if (long_break <= 0)          long_break = 15;
        if (cycles_before_long <= 0)  cycles_before_long = 4;
        if (total_cycles <= 0)        total_cycles = 4;
        StringBuilder sb(static_cast<std::size_t>(total_cycles) * 150);
        sb << '[';
        for (int i = 0; i < total_cycles; ++i) {
            sb << "{\"type\":\"task\",\"title\":\"Pomodoro " << (i + 1)
               << "\",\"duration\":" << work_min << '}';
            if (i < total_cycles - 1) {
                bool is_long = ((i + 1) % cycles_before_long == 0);
                int bd = is_long ? long_break : short_break;
                sb << ",{\"type\":\"break\",\"title\":\""
                   << (is_long ? "Long Break" : "Short Break")
                   << "\",\"duration\":" << bd << '}';
            }
        }
        sb << ']';
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate pomodoro plan");
    }
}

KEEPALIVE
int suggest_total_duration(int available_time, int priority) {
    if (available_time <= 0) return 30;
    priority = clamp_int(priority, 0, 100);
    int base;
    if (available_time < 30)       base = available_time;
    else if (available_time < 60)  base = (available_time / 15) * 15;
    else if (available_time < 120) base = (available_time / 30) * 30;
    else                           base = (available_time / 60) * 60;
    int suggestion = base + ((priority - 50) / 10) * 5;
    if (suggestion < 15) suggestion = 15;
    if (suggestion > available_time) suggestion = available_time;
    return suggestion;
}

KEEPALIVE
char* generate_optimization_suggestion(int current_chunk, int current_break,
                                       int avg_focus, int distraction) {
    try {
        int optimized_chunk = optimize_chunk_size(240, avg_focus, distraction);
        int optimized_break = optimize_break_duration(optimized_chunk, 70);
        StringBuilder sb(300);
        sb << '{';
        json_kv_int(sb, "current_chunk", current_chunk);
        sb << ',';
        json_kv_int(sb, "optimized_chunk", optimized_chunk);
        sb << ',';
        json_kv_int(sb, "current_break", current_break);
        sb << ',';
        json_kv_int(sb, "optimized_break", optimized_break);
        sb << ',';
        sb << "\"suggestion\":\"";
        if (optimized_chunk != current_chunk || optimized_break != current_break) {
            sb << "Based on your focus pattern, we suggest " << optimized_chunk
               << "min work blocks with " << optimized_break << "min breaks. ";
            if (optimized_chunk > current_chunk) {
                sb << "You seem to be able to focus for longer periods!";
            } else {
                sb << "Shorter, more frequent breaks might help maintain focus.";
            }
        } else {
            sb << "Your current settings seem well-optimized for your focus pattern!";
        }
        sb << "\"}";
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate optimization suggestion");
    }
}

KEEPALIVE
int calculate_productivity_trend(const int* completed_tasks, const int* total_tasks, int days) {
    if (!completed_tasks || !total_tasks || days <= 0) return 0;

    double acc = 0.0;
    int valid = 0;
    for (int i = 0; i < days; ++i) {
        if (total_tasks[i] > 0) {
            acc += (static_cast<double>(completed_tasks[i]) * 100.0) / static_cast<double>(total_tasks[i]);
            ++valid;
        }
    }
    if (valid == 0) return 0;
    return static_cast<int>(std::round(acc / valid));
}

KEEPALIVE
int find_optimal_work_hour(const int* hourly_activity, int hours) {
    if (!hourly_activity || hours <= 0 || hours > 24) return -1;
    int max_activity = -1;
    int optimal_hour = 9;
    for (int i = 0; i < hours; ++i) {
        if (hourly_activity[i] > max_activity) {
            max_activity = hourly_activity[i];
            optimal_hour = i;
        }
    }
    if (max_activity <= 0) return 9;
    return optimal_hour;
}

KEEPALIVE
char* generate_behavior_insights(const int* daily_productivity, int num_days, int avg_focus_time) {
    try {
        StringBuilder sb(static_cast<std::size_t>(num_days > 0 ? num_days : 0) * 100 + 300);
        sb << "{\"insights\":[";

        int trend = 0;
        if (daily_productivity && num_days >= 2) {
            long long first_sum = 0, second_sum = 0;
            int half = num_days / 2;
            for (int i = 0; i < half; ++i)          first_sum  += daily_productivity[i];
            for (int i = half; i < num_days; ++i)   second_sum += daily_productivity[i];

            int first_avg  = half > 0 ? static_cast<int>(std::round(static_cast<double>(first_sum) / half)) : 0;
            int second_avg = (num_days - half) > 0 ? static_cast<int>(std::round(static_cast<double>(second_sum) / (num_days - half))) : 0;
            trend = second_avg - first_avg;
        }

        sb << "{\"type\":\"trend\",\"value\":" << trend << ",\"message\":\"";
        if (trend > 10)        sb << "Great improvement! Your productivity is increasing.";
        else if (trend < -10)  sb << "Consider adjusting your routine - productivity trend is downward.";
        else                   sb << "Your productivity is stable. Keep up the good work!";
        sb << "\"},";

        sb << "{\"type\":\"focus_time\",\"value\":" << avg_focus_time << ",\"message\":\"";
        if (avg_focus_time < 20)      sb << "Try shorter focus blocks (15-20 mins) for better results.";
        else if (avg_focus_time > 45) sb << "Excellent focus capacity! Consider longer blocks (45-60 mins).";
        else                          sb << "Your focus time is optimal.";
        sb << "\"}]}";
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate behavior insights");
    }
}

KEEPALIVE
float fast_average(const int* values, int count) {
    if (!values || count <= 0) return 0.0f;
    long long sum = 0;
    for (int i = 0; i < count; ++i) sum += values[i];
    return static_cast<float>(sum) / count;
}

KEEPALIVE
int fast_median(const int* values, int count) {
    if (!values || count <= 0) return 0;
    try {
        std::vector<int> v(values, values + count);
        int mid = count / 2;
        std::nth_element(v.begin(), v.begin() + mid, v.end());
        if (count % 2 == 1) {
            return v[mid];
        }
        int left_max = *std::max_element(v.begin(), v.begin() + mid);
        return (left_max + v[mid]) / 2;
    } catch (...) {
        return 0;
    }
}

KEEPALIVE
int fast_std_dev(const int* values, int count) {
    if (!values || count <= 1) return 0;
    float avg = fast_average(values, count);
    double sum_sq = 0.0;
    for (int i = 0; i < count; ++i) {
        double d = static_cast<double>(values[i]) - avg;
        sum_sq += d * d;
    }
    return static_cast<int>(std::sqrt(sum_sq / (count - 1)));
}

KEEPALIVE
char* parse_plan_arguments_json(const char* args_str) {
    try {
        ParsedPlanArgs args = parse_plan_arguments(args_str ? args_str : "");
        StringBuilder sb;
        sb << '{';
        json_kv_string(sb, "title", args.title);
        sb << ',';
        json_kv_string(sb, "goal", args.goal);
        sb << ',';
        json_kv_int(sb, "durationMinutes", args.duration_minutes);
        sb << ',';
        json_kv_int(sb, "chunkSizeMinutes", args.chunk_size_minutes);
        sb << ',';
        json_kv_int(sb, "breakMinutes", args.break_minutes);
        sb << ',';
        json_kv_string(sb, "usedPreset", args.used_preset);
        sb << ',';
        json_string(sb, "tags");
        sb << ':';
        json_string_array(sb, args.tags);
        sb << '}';
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to parse plan arguments");
    }
}

KEEPALIVE
char* analyze_plan_smart(int total_duration, int chunk_size,
                         int break_minutes, const char* goal_str) {
    (void)goal_str;

    try {
        if (total_duration <= 0 || chunk_size <= 0 || break_minutes < 0) {
            const char* msg = (total_duration <= 0) ? "Total duration must be positive"
                             : (chunk_size <= 0)   ? "Chunk size must be positive"
                                                  : "Break minutes cannot be negative";
            StringBuilder sb;
            sb << "{\"isValid\":false,\"errorMessage\":\"";
            json_escape(sb, std::string_view(msg));
            sb << "\"}";
            return dup_to_c_string(sb);
        }

        int optimal_chunk;
        if (total_duration <= 30)       optimal_chunk = 15;
        else if (total_duration <= 60)  optimal_chunk = 25;
        else if (total_duration <= 120) optimal_chunk = 45;
        else                            optimal_chunk = 60;

        float chunk_match = 1.0f - std::abs(static_cast<float>(chunk_size - optimal_chunk))
                                    / static_cast<float>(optimal_chunk);
        chunk_match = std::max(0.3f, std::min(1.0f, chunk_match));

        float break_ratio = static_cast<float>(break_minutes) / static_cast<float>(chunk_size);
        float break_score;
        if (break_ratio >= 0.15f && break_ratio <= 0.30f) {
            break_score = 1.0f;
        } else {
            break_score = 1.0f - std::abs(break_ratio - 0.20f) / 0.30f;
            break_score = std::max(0.3f, break_score);
        }

        float efficiency = (chunk_match * 0.6f + break_score * 0.4f) * 100.0f;
        int efficiency_score = static_cast<int>(std::round(efficiency));
        int recommended_break = std::max(3, optimal_chunk / 5);

        std::string_view focus_pattern;
        if (chunk_size <= 20)       focus_pattern = "short-focus";
        else if (chunk_size <= 45)  focus_pattern = "balanced";
        else                        focus_pattern = "deep-work";

        std::string_view suggestion;
        if (efficiency_score >= 90)       suggestion = "Your plan is well-optimized! Keep up the good work";
        else if (efficiency_score >= 70)  suggestion = "Consider minor adjustments to chunk or break times for better efficiency";
        else                              suggestion = "Your plan could use significant optimization. Try our recommended settings";

        StringBuilder sb;
        sb << "{\"isValid\":true,";
        json_kv_int(sb, "efficiencyScore", efficiency_score);
        sb << ',';
        json_kv_int(sb, "optimalChunkMinutes", optimal_chunk);
        sb << ',';
        json_kv_int(sb, "recommendedBreakMinutes", recommended_break);
        sb << ',';
        json_kv_string(sb, "focusPattern", focus_pattern);
        sb << ',';
        json_kv_string(sb, "improvementSuggestion", suggestion);
        sb << ",\"warnings\":[";
        bool first = true;
        auto add_warning = [&](std::string_view w) {
            if (!first) sb << ',';
            first = false;
            json_string(sb, w);
        };
        if (chunk_size > total_duration)     add_warning("Chunk size is larger than total duration");
        if (break_minutes > chunk_size / 2)  add_warning("Break time seems quite long relative to work time");
        if (total_duration > 240)            add_warning("Consider breaking very long sessions into multiple plans");
        sb << "]}";
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to analyze plan");
    }
}

KEEPALIVE
char* validate_task_dependencies(const char* dependencies_json) {
    try {
        if (validate_dependencies(dependencies_json)) {
            return dup_to_c_string("{\"isValid\":true,\"message\":\"Dependencies validated successfully\"}");
        }
        return dup_to_c_string("{\"isValid\":false,\"errorMessage\":\"Malformed dependencies JSON\"}");
    } catch (...) {
        return json_error("Failed to validate dependencies");
    }
}

KEEPALIVE
char* optimize_plan_times(int work_intensity, int average_focus_minutes, int available_hours) {
    try {
        work_intensity        = clamp_int(work_intensity, 1, 100);
        average_focus_minutes = clamp_int(average_focus_minutes, 5, 120);
        (void)available_hours;

        int optimized_chunk, optimized_break;
        if (work_intensity >= 80) {
            optimized_chunk = std::max(20, average_focus_minutes - 5);
            optimized_break = optimized_chunk / 4;
        } else if (work_intensity >= 50) {
            optimized_chunk = average_focus_minutes;
            optimized_break = optimized_chunk / 5;
        } else {
            optimized_chunk = std::min(60, average_focus_minutes + 10);
            optimized_break = optimized_chunk / 6;
        }
        optimized_chunk = clamp_int(optimized_chunk, 10, 90);
        optimized_break = clamp_int(optimized_break, 3, 20);

        int gain_estimate = 10 + (work_intensity / 10);
        std::string_view reasoning;
        if (work_intensity >= 80)      reasoning = "High work intensity detected. Shorter focus blocks prevent burnout";
        else if (work_intensity >= 50) reasoning = "Moderate intensity. Balanced approach recommended for sustainable focus";
        else                           reasoning = "Lower intensity. Longer focus blocks work well here";

        StringBuilder sb;
        sb << '{';
        json_kv_int(sb, "optimizedChunkMinutes", optimized_chunk);
        sb << ',';
        json_kv_int(sb, "optimizedBreakMinutes", optimized_break);
        sb << ',';
        json_kv_int(sb, "estimatedProductivityGainPercent", gain_estimate);
        sb << ',';
        json_kv_string(sb, "reasoning", reasoning);
        sb << '}';
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to optimize plan times");
    }
}

KEEPALIVE
char* create_full_plan_json(const char* args_str, const char* source) {
    try {
        FullPlan plan = create_full_plan(args_str ? args_str : "",
                                         source  ? source  : "cpp-wasm");
        StringBuilder sb;
        sb << '{';
        json_kv_string(sb, "id",    plan.id);
        sb << ',';
        json_kv_string(sb, "title", plan.title);
        sb << ',';
        json_kv_string(sb, "goal",  plan.goal);
        sb << ',';
        json_kv_int(sb, "durationMinutes",  plan.duration_minutes);
        sb << ',';
        json_kv_int(sb, "chunkSizeMinutes", plan.chunk_size_minutes);
        sb << ',';
        json_kv_int(sb, "breakMinutes",     plan.break_minutes);
        sb << ',';
        json_kv_string(sb, "status",    plan.status);
        sb << ',';
        json_kv_string(sb, "createdAt", plan.created_at);
        sb << ',';
        json_kv_string(sb, "source",    plan.source);
        sb << ',';
        json_string(sb, "tags");
        sb << ':';
        json_string_array(sb, plan.tags);
        sb << ',';
        json_string(sb, "tasks");
        sb << ": [";
        for (std::size_t i = 0; i < plan.tasks.size(); ++i) {
            if (i > 0) sb << ',';
            const auto& t = plan.tasks[i];
            sb << '{';
            json_kv_string(sb, "id",    t.id);
            sb << ',';
            json_kv_string(sb, "title", t.title);
            sb << ',';
            json_kv_int(sb, "durationMinutes", t.duration_minutes);
            sb << ',';
            json_kv_bool(sb, "completed", t.completed);
            sb << ',';
            json_kv_bool(sb, "isBreak",   t.is_break);
            sb << '}';
        }
        sb << "]}";
        return dup_to_c_string(sb);
    } catch (const std::exception& e) {
        StringBuilder sb;
        sb << "{\"error\":\"Failed to create plan: ";
        json_escape(sb, std::string_view(e.what()));
        sb << "\"}";
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Unknown error creating plan");
    }
}

KEEPALIVE
char* generate_smart_plan_recommendation(int total_available_minutes,
                                         int work_intensity,
                                         int user_energy_level) {
    try {
        auto rec = compute_smart_plan_recommendation(
            total_available_minutes, work_intensity, user_energy_level);
        StringBuilder sb;
        sb << '{';
        json_kv_int(sb, "optimalWorkMinutes", rec.optimal_work_minutes);
        sb << ',';
        json_kv_int(sb, "optimalBreakMinutes", rec.optimal_break_minutes);
        sb << ',';
        json_kv_int(sb, "estimatedProductivityGain", rec.estimated_productivity_gain);
        sb << ',';
        json_kv_string(sb, "recommendation", rec.recommendation);
        sb << '}';
        return dup_to_c_string(sb);
    } catch (...) {
        return json_error("Failed to generate smart plan recommendation");
    }
}

}  // extern "C"