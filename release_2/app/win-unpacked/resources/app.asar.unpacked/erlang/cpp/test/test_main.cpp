#include <algorithm>
#include <chrono>
#include <functional>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <ranges>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// Platform-specific TTY/ANSI support
#ifdef _WIN32
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <windows.h>
    #include <io.h>
    #define PLATFORM_ISATTY _isatty
    #define PLATFORM_FILENO _fileno
#else
    #include <unistd.h>
    #define PLATFORM_ISATTY isatty
    #define PLATFORM_FILENO fileno
#endif

#include "../include/plan_processor.hpp"
#include "../include/plan_template_engine.hpp"
#include "../include/smart_time_planner.hpp"
#include "../include/plan_validator_enhanced.hpp"

// =============================================================================
// Anonymous namespace: test infrastructure utilities
// =============================================================================
namespace {

// -----------------------------------------------------------------------------
// Terminal color management — codes are only emitted when output is a TTY
// -----------------------------------------------------------------------------
namespace colors {

#ifdef _WIN32
void enable_ansi_support() noexcept {
    if (HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE); hOut != INVALID_HANDLE_VALUE) {
        DWORD mode = 0;
        if (GetConsoleMode(hOut, &mode)) {
            SetConsoleMode(hOut, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
    }
}
#endif

[[nodiscard]] constexpr std::string_view green()  noexcept { return "\033[32m"; }
[[nodiscard]] constexpr std::string_view red()    noexcept { return "\033[31m"; }
[[nodiscard]] constexpr std::string_view yellow() noexcept { return "\033[33m"; }
[[nodiscard]] constexpr std::string_view blue()   noexcept { return "\033[34m"; }
[[nodiscard]] constexpr std::string_view reset()  noexcept { return "\033[0m"; }

[[nodiscard]] bool is_tty() noexcept {
    return PLATFORM_ISATTY(PLATFORM_FILENO(stdout)) != 0;
}

/// Returns the color code if stdout is a TTY, otherwise an empty view.
/// Caches the TTY check for efficiency.
[[nodiscard]] std::string_view code(std::string_view c) noexcept {
    static const bool tty = is_tty();
    return tty ? c : std::string_view{};
}

} // namespace colors

// -----------------------------------------------------------------------------
// Custom assertion macro — active in both debug and release builds
// -----------------------------------------------------------------------------
#define TEST_ASSERT(cond, msg)                                      \
    do {                                                            \
        if (!(cond)) [[unlikely]] {                                 \
            throw std::runtime_error(                               \
                std::string("Assertion failed: ") + (msg));         \
        }                                                           \
    } while (0)

// -----------------------------------------------------------------------------
// Formatting constants
// -----------------------------------------------------------------------------
namespace fmt {
    constexpr int kStatusWidth    = 7;
    constexpr int kNameWidth      = 30;
    constexpr int kTimeWidth      = 9;
    constexpr int kSummaryLabel   = 20;
    constexpr int kSummaryValue   = 8;
}

// -----------------------------------------------------------------------------
// Test result record
// -----------------------------------------------------------------------------
struct TestResult {
    std::string test_name;
    bool        passed             = false;
    std::string error_message;
    double      execution_time_ms  = 0.0;
};

// -----------------------------------------------------------------------------
// Monotonic stopwatch for benchmarking
// -----------------------------------------------------------------------------
class Stopwatch {
    using clock = std::chrono::steady_clock;
    clock::time_point start_;
public:
    Stopwatch() noexcept : start_(clock::now()) {}
    void reset() noexcept { start_ = clock::now(); }
    [[nodiscard]] double elapsed_ms() const noexcept {
        return std::chrono::duration<double, std::milli>(clock::now() - start_).count();
    }
};

// -----------------------------------------------------------------------------
// Test runner — encapsulates execution, result collection, and aggregation
// -----------------------------------------------------------------------------
class TestRunner {
    std::vector<TestResult> results_;

public:
    void run(std::string_view name, const std::function<bool()>& test_func) {
        Stopwatch sw;
        TestResult result;
        result.test_name = std::string(name);
        try {
            result.passed = test_func();
            if (!result.passed) {
                result.error_message = "Test returned false";
            }
        } catch (const std::exception& e) {
            result.passed = false;
            result.error_message = std::string("Exception: ") + e.what();
        } catch (...) {
            result.passed = false;
            result.error_message = "Unknown exception";
        }
        result.execution_time_ms = sw.elapsed_ms();
        results_.push_back(std::move(result));
    }

    [[nodiscard]] const std::vector<TestResult>& results() const noexcept { return results_; }

    [[nodiscard]] int passed_count() const noexcept {
        return static_cast<int>(
            std::ranges::count_if(results_, [](const TestResult& r) { return r.passed; }));
    }

    [[nodiscard]] int failed_count() const noexcept {
        return static_cast<int>(results_.size()) - passed_count();
    }
};

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------
void print_section_header(std::string_view title) {
    std::cout << '\n' << colors::code(colors::blue())
              << "=== " << title << " ==="
              << colors::code(colors::reset()) << '\n';
}

void print_test_result(const TestResult& result) {
    if (result.passed) {
        std::cout << colors::code(colors::green())
                  << std::setw(fmt::kStatusWidth) << "[PASS]"
                  << colors::code(colors::reset())
                  << ' ' << std::left << std::setw(fmt::kNameWidth) << result.test_name
                  << std::right << std::setw(fmt::kTimeWidth)
                  << std::fixed << std::setprecision(2)
                  << result.execution_time_ms << "ms\n";
    } else {
        std::cout << colors::code(colors::red())
                  << std::setw(fmt::kStatusWidth) << "[FAIL]"
                  << colors::code(colors::reset())
                  << ' ' << std::left << std::setw(fmt::kNameWidth) << result.test_name
                  << std::right << std::setw(fmt::kTimeWidth) << ' '
                  << " | Error: " << result.error_message << '\n';
    }
}

void print_summary_line(std::string_view label, int value) {
    std::cout << std::left  << std::setw(fmt::kSummaryLabel) << label
              << std::right << std::setw(fmt::kSummaryValue) << value << '\n';
}

void print_summary_line(std::string_view label, double value, std::string_view suffix = {}) {
    std::cout << std::left  << std::setw(fmt::kSummaryLabel) << label
              << std::right << std::setw(fmt::kSummaryValue)
              << std::fixed << std::setprecision(2) << value << suffix << '\n';
}

} // anonymous namespace

// =============================================================================
// Individual test functions
// =============================================================================
bool test_plan_processor() {
    print_section_header("Testing PlanProcessor");
    Stopwatch sw;

    auto plan = PlanProcessor::create_plan(
        "work 45 --goal=Finish project --chunk=25 --break=5", "test");
    std::cout << "✓ Plan created successfully\n";

    TEST_ASSERT(PlanProcessor::validate_plan(45, 25, 5),
                "Validation failed for valid parameters");
    std::cout << "✓ Validation passed for valid parameters\n";

    TEST_ASSERT(!PlanProcessor::validate_plan(0, 25, 5),
                "Validation passed for invalid total duration");
    std::cout << "✓ Validation correctly failed for invalid total duration\n";

    TEST_ASSERT(!plan.tasks.empty(), "No tasks generated");
    std::cout << "✓ Generated " << plan.tasks.size() << " tasks\n";

    auto json = PlanProcessor::plan_to_json(plan);
    TEST_ASSERT(!json.empty(), "JSON generation failed");
    std::cout << "✓ JSON serialization successful (" << json.size() << " bytes)\n";
    if (json.size() > 100) {
        std::cout << "  Preview: " << std::string_view(json.data(), 100) << "...\n";
    }

    std::cout << "PlanProcessor all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

bool test_template_engine() {
    print_section_header("Testing PlanTemplateEngine");
    Stopwatch sw;

    PlanTemplateEngine::TemplateEngine engine;

    auto templates = engine.get_all_templates();
    TEST_ASSERT(!templates.empty(), "No templates found");
    std::cout << "✓ Found " << templates.size() << " system templates\n";

    auto json = engine.templates_to_json(templates);
    TEST_ASSERT(!json.empty(), "Templates JSON generation failed");
    std::cout << "✓ Templates JSON generated successfully (" << json.size() << " bytes)\n";

    const auto& first = templates.front();
    auto applied_plan = engine.apply_template(first.id, "custom goal", "test");
    std::cout << "✓ Template '" << first.name << "' applied successfully\n";

    auto applied_json = PlanProcessor::plan_to_json(applied_plan);
    TEST_ASSERT(!applied_json.empty(), "Applied plan JSON generation failed");
    std::cout << "✓ Applied plan JSON serialization successful\n";

    std::cout << "PlanTemplateEngine all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

bool test_smart_planner() {
    print_section_header("Testing SmartTimePlanner");
    Stopwatch sw;

    SmartTimePlanner::SmartPlanner planner;

    auto plan = PlanProcessor::create_plan("code 90 --chunk=30 --break=5", "test");

    auto schedule = planner.generate_schedule(plan, 9, 0);
    TEST_ASSERT(schedule.success, "Schedule generation failed");
    std::cout << "✓ Schedule generated with " << schedule.slots.size() << " time slots\n";

    auto schedule_json = planner.schedule_to_json(schedule);
    TEST_ASSERT(!schedule_json.empty(), "Schedule JSON generation failed");
    std::cout << "✓ Schedule JSON serialization successful\n";

    auto optimized_json = planner.generate_optimized_plan(plan, true);
    TEST_ASSERT(!optimized_json.empty(), "Plan optimization failed");
    std::cout << "✓ Optimized plan generated successfully\n";

    std::vector<PlanProcessor::FullPlan> past_plans;
    past_plans.reserve(2);
    past_plans.push_back(PlanProcessor::create_plan("work 60 --chunk=25 --break=5", "past1"));
    past_plans.push_back(PlanProcessor::create_plan("study 120 --chunk=30 --break=5", "past2"));

    auto stats = planner.analyze_productivity(past_plans);
    auto stats_json = planner.stats_to_json(stats);
    TEST_ASSERT(!stats_json.empty(), "Productivity analysis failed");
    std::cout << "✓ Productivity analysis generated for "
              << past_plans.size() << " historical plans\n";

    std::cout << "SmartTimePlanner all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

bool test_validator() {
    print_section_header("Testing PlanValidatorEnhanced");
    Stopwatch sw;

    PlanValidatorEnhanced::EnhancedValidator validator;

    auto plan = PlanProcessor::create_plan(
        "study 60 --chunk=45 --break=10 --goal=Learn C++", "test");

    auto report = validator.validate(plan, false);
    std::cout << "✓ Validation complete - Score: " << report.score
              << ", Issues found: " << report.issues.size() << '\n';

    auto full_report = validator.validate_and_suggest(plan);
    std::cout << "✓ Validation + suggestion analysis complete\n";

    auto report_json = validator.report_to_json(full_report);
    TEST_ASSERT(!report_json.empty(), "Report JSON generation failed");
    std::cout << "✓ Report JSON serialization successful\n";

    auto score_str = validator.calculate_quality_score(plan);
    std::cout << "✓ Plan quality score: " << score_str << '\n';

    auto improvements = validator.suggest_improvements(plan);
    std::cout << "✓ Found " << improvements.size() << " improvement suggestions\n";

    auto edge_plan = PlanProcessor::create_plan(
        "debug 180 --chunk=50 --break=10 --goal=Fix production bug", "edge_test");
    auto edge_report = validator.validate(edge_plan, false);
    std::cout << "✓ Edge case validation complete - Score: " << edge_report.score << '\n';

    std::cout << "PlanValidatorEnhanced all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

// =============================================================================
// Main entry point
// =============================================================================
int main() {
#ifdef _WIN32
    colors::enable_ansi_support();
#endif

    std::cout << colors::code(colors::blue())
              << "=== Starting Plan Module Tests ==="
              << colors::code(colors::reset()) << '\n';

    TestRunner runner;
    Stopwatch   total_sw;

    runner.run("PlanProcessor",         test_plan_processor);
    runner.run("PlanTemplateEngine",    test_template_engine);
    runner.run("SmartTimePlanner",      test_smart_planner);
    runner.run("PlanValidatorEnhanced", test_validator);

    const double total_time = total_sw.elapsed_ms();

    // Detailed results
    print_section_header("Detailed Test Results");
    for (const auto& result : runner.results()) {
        print_test_result(result);
    }

    // Summary
    print_section_header("Final Test Summary");
    const int total  = static_cast<int>(runner.results().size());
    const int passed = runner.passed_count();
    const int failed = runner.failed_count();

    print_summary_line("Total tests:", total);
    print_summary_line("Passed:", passed);
    print_summary_line("Failed:", failed);

    std::cout << std::left << std::setw(fmt::kSummaryLabel) << "Success rate:"
              << std::right << std::setw(fmt::kSummaryValue)
              << std::fixed << std::setprecision(1)
              << (total > 0 ? static_cast<double>(passed) / total * 100.0 : 0.0) << "%\n";

    print_summary_line("Total execution:", total_time, "ms");

    if (failed == 0) {
        std::cout << '\n' << colors::code(colors::green())
                  << "✅ All tests passed successfully!"
                  << colors::code(colors::reset()) << '\n';
        return 0;
    }

    std::cout << '\n' << colors::code(colors::red())
              << "❌ " << failed << " test(s) failed. Please check the output above."
              << colors::code(colors::reset()) << '\n';
    return 1;
}#include <algorithm>
#include <chrono>
#include <functional>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <ranges>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// Platform-specific TTY/ANSI support
#ifdef _WIN32
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <windows.h>
    #include <io.h>
    #define PLATFORM_ISATTY _isatty
    #define PLATFORM_FILENO _fileno
#else
    #include <unistd.h>
    #define PLATFORM_ISATTY isatty
    #define PLATFORM_FILENO fileno
#endif

#include "../include/plan_processor.hpp"
#include "../include/plan_template_engine.hpp"
#include "../include/smart_time_planner.hpp"
#include "../include/plan_validator_enhanced.hpp"

// =============================================================================
// Anonymous namespace: test infrastructure utilities
// =============================================================================
namespace {

// -----------------------------------------------------------------------------
// Terminal color management — codes are only emitted when output is a TTY
// -----------------------------------------------------------------------------
namespace colors {

#ifdef _WIN32
void enable_ansi_support() noexcept {
    if (HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE); hOut != INVALID_HANDLE_VALUE) {
        DWORD mode = 0;
        if (GetConsoleMode(hOut, &mode)) {
            SetConsoleMode(hOut, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
    }
}
#endif

[[nodiscard]] constexpr std::string_view green()  noexcept { return "\033[32m"; }
[[nodiscard]] constexpr std::string_view red()    noexcept { return "\033[31m"; }
[[nodiscard]] constexpr std::string_view yellow() noexcept { return "\033[33m"; }
[[nodiscard]] constexpr std::string_view blue()   noexcept { return "\033[34m"; }
[[nodiscard]] constexpr std::string_view reset()  noexcept { return "\033[0m"; }

[[nodiscard]] bool is_tty() noexcept {
    return PLATFORM_ISATTY(PLATFORM_FILENO(stdout)) != 0;
}

/// Returns the color code if stdout is a TTY, otherwise an empty view.
/// Caches the TTY check for efficiency.
[[nodiscard]] std::string_view code(std::string_view c) noexcept {
    static const bool tty = is_tty();
    return tty ? c : std::string_view{};
}

} // namespace colors

// -----------------------------------------------------------------------------
// Custom assertion macro — active in both debug and release builds
// -----------------------------------------------------------------------------
#define TEST_ASSERT(cond, msg)                                      \
    do {                                                            \
        if (!(cond)) [[unlikely]] {                                 \
            throw std::runtime_error(                               \
                std::string("Assertion failed: ") + (msg));         \
        }                                                           \
    } while (0)

// -----------------------------------------------------------------------------
// Formatting constants
// -----------------------------------------------------------------------------
namespace fmt {
    constexpr int kStatusWidth    = 7;
    constexpr int kNameWidth      = 30;
    constexpr int kTimeWidth      = 9;
    constexpr int kSummaryLabel   = 20;
    constexpr int kSummaryValue   = 8;
}

// -----------------------------------------------------------------------------
// Test result record
// -----------------------------------------------------------------------------
struct TestResult {
    std::string test_name;
    bool        passed             = false;
    std::string error_message;
    double      execution_time_ms  = 0.0;
};

// -----------------------------------------------------------------------------
// Monotonic stopwatch for benchmarking
// -----------------------------------------------------------------------------
class Stopwatch {
    using clock = std::chrono::steady_clock;
    clock::time_point start_;
public:
    Stopwatch() noexcept : start_(clock::now()) {}
    void reset() noexcept { start_ = clock::now(); }
    [[nodiscard]] double elapsed_ms() const noexcept {
        return std::chrono::duration<double, std::milli>(clock::now() - start_).count();
    }
};

// -----------------------------------------------------------------------------
// Test runner — encapsulates execution, result collection, and aggregation
// -----------------------------------------------------------------------------
class TestRunner {
    std::vector<TestResult> results_;

public:
    void run(std::string_view name, const std::function<bool()>& test_func) {
        Stopwatch sw;
        TestResult result;
        result.test_name = std::string(name);
        try {
            result.passed = test_func();
            if (!result.passed) {
                result.error_message = "Test returned false";
            }
        } catch (const std::exception& e) {
            result.passed = false;
            result.error_message = std::string("Exception: ") + e.what();
        } catch (...) {
            result.passed = false;
            result.error_message = "Unknown exception";
        }
        result.execution_time_ms = sw.elapsed_ms();
        results_.push_back(std::move(result));
    }

    [[nodiscard]] const std::vector<TestResult>& results() const noexcept { return results_; }

    [[nodiscard]] int passed_count() const noexcept {
        return static_cast<int>(
            std::ranges::count_if(results_, [](const TestResult& r) { return r.passed; }));
    }

    [[nodiscard]] int failed_count() const noexcept {
        return static_cast<int>(results_.size()) - passed_count();
    }
};

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------
void print_section_header(std::string_view title) {
    std::cout << '\n' << colors::code(colors::blue())
              << "=== " << title << " ==="
              << colors::code(colors::reset()) << '\n';
}

void print_test_result(const TestResult& result) {
    if (result.passed) {
        std::cout << colors::code(colors::green())
                  << std::setw(fmt::kStatusWidth) << "[PASS]"
                  << colors::code(colors::reset())
                  << ' ' << std::left << std::setw(fmt::kNameWidth) << result.test_name
                  << std::right << std::setw(fmt::kTimeWidth)
                  << std::fixed << std::setprecision(2)
                  << result.execution_time_ms << "ms\n";
    } else {
        std::cout << colors::code(colors::red())
                  << std::setw(fmt::kStatusWidth) << "[FAIL]"
                  << colors::code(colors::reset())
                  << ' ' << std::left << std::setw(fmt::kNameWidth) << result.test_name
                  << std::right << std::setw(fmt::kTimeWidth) << ' '
                  << " | Error: " << result.error_message << '\n';
    }
}

void print_summary_line(std::string_view label, int value) {
    std::cout << std::left  << std::setw(fmt::kSummaryLabel) << label
              << std::right << std::setw(fmt::kSummaryValue) << value << '\n';
}

void print_summary_line(std::string_view label, double value, std::string_view suffix = {}) {
    std::cout << std::left  << std::setw(fmt::kSummaryLabel) << label
              << std::right << std::setw(fmt::kSummaryValue)
              << std::fixed << std::setprecision(2) << value << suffix << '\n';
}

} // anonymous namespace

// =============================================================================
// Individual test functions
// =============================================================================
bool test_plan_processor() {
    print_section_header("Testing PlanProcessor");
    Stopwatch sw;

    auto plan = PlanProcessor::create_plan(
        "work 45 --goal=Finish project --chunk=25 --break=5", "test");
    std::cout << "✓ Plan created successfully\n";

    TEST_ASSERT(PlanProcessor::validate_plan(45, 25, 5),
                "Validation failed for valid parameters");
    std::cout << "✓ Validation passed for valid parameters\n";

    TEST_ASSERT(!PlanProcessor::validate_plan(0, 25, 5),
                "Validation passed for invalid total duration");
    std::cout << "✓ Validation correctly failed for invalid total duration\n";

    TEST_ASSERT(!plan.tasks.empty(), "No tasks generated");
    std::cout << "✓ Generated " << plan.tasks.size() << " tasks\n";

    auto json = PlanProcessor::plan_to_json(plan);
    TEST_ASSERT(!json.empty(), "JSON generation failed");
    std::cout << "✓ JSON serialization successful (" << json.size() << " bytes)\n";
    if (json.size() > 100) {
        std::cout << "  Preview: " << std::string_view(json.data(), 100) << "...\n";
    }

    std::cout << "PlanProcessor all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

bool test_template_engine() {
    print_section_header("Testing PlanTemplateEngine");
    Stopwatch sw;

    PlanTemplateEngine::TemplateEngine engine;

    auto templates = engine.get_all_templates();
    TEST_ASSERT(!templates.empty(), "No templates found");
    std::cout << "✓ Found " << templates.size() << " system templates\n";

    auto json = engine.templates_to_json(templates);
    TEST_ASSERT(!json.empty(), "Templates JSON generation failed");
    std::cout << "✓ Templates JSON generated successfully (" << json.size() << " bytes)\n";

    const auto& first = templates.front();
    auto applied_plan = engine.apply_template(first.id, "custom goal", "test");
    std::cout << "✓ Template '" << first.name << "' applied successfully\n";

    auto applied_json = PlanProcessor::plan_to_json(applied_plan);
    TEST_ASSERT(!applied_json.empty(), "Applied plan JSON generation failed");
    std::cout << "✓ Applied plan JSON serialization successful\n";

    std::cout << "PlanTemplateEngine all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

bool test_smart_planner() {
    print_section_header("Testing SmartTimePlanner");
    Stopwatch sw;

    SmartTimePlanner::SmartPlanner planner;

    auto plan = PlanProcessor::create_plan("code 90 --chunk=30 --break=5", "test");

    auto schedule = planner.generate_schedule(plan, 9, 0);
    TEST_ASSERT(schedule.success, "Schedule generation failed");
    std::cout << "✓ Schedule generated with " << schedule.slots.size() << " time slots\n";

    auto schedule_json = planner.schedule_to_json(schedule);
    TEST_ASSERT(!schedule_json.empty(), "Schedule JSON generation failed");
    std::cout << "✓ Schedule JSON serialization successful\n";

    auto optimized_json = planner.generate_optimized_plan(plan, true);
    TEST_ASSERT(!optimized_json.empty(), "Plan optimization failed");
    std::cout << "✓ Optimized plan generated successfully\n";

    std::vector<PlanProcessor::FullPlan> past_plans;
    past_plans.reserve(2);
    past_plans.push_back(PlanProcessor::create_plan("work 60 --chunk=25 --break=5", "past1"));
    past_plans.push_back(PlanProcessor::create_plan("study 120 --chunk=30 --break=5", "past2"));

    auto stats = planner.analyze_productivity(past_plans);
    auto stats_json = planner.stats_to_json(stats);
    TEST_ASSERT(!stats_json.empty(), "Productivity analysis failed");
    std::cout << "✓ Productivity analysis generated for "
              << past_plans.size() << " historical plans\n";

    std::cout << "SmartTimePlanner all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

bool test_validator() {
    print_section_header("Testing PlanValidatorEnhanced");
    Stopwatch sw;

    PlanValidatorEnhanced::EnhancedValidator validator;

    auto plan = PlanProcessor::create_plan(
        "study 60 --chunk=45 --break=10 --goal=Learn C++", "test");

    auto report = validator.validate(plan, false);
    std::cout << "✓ Validation complete - Score: " << report.score
              << ", Issues found: " << report.issues.size() << '\n';

    auto full_report = validator.validate_and_suggest(plan);
    std::cout << "✓ Validation + suggestion analysis complete\n";

    auto report_json = validator.report_to_json(full_report);
    TEST_ASSERT(!report_json.empty(), "Report JSON generation failed");
    std::cout << "✓ Report JSON serialization successful\n";

    auto score_str = validator.calculate_quality_score(plan);
    std::cout << "✓ Plan quality score: " << score_str << '\n';

    auto improvements = validator.suggest_improvements(plan);
    std::cout << "✓ Found " << improvements.size() << " improvement suggestions\n";

    auto edge_plan = PlanProcessor::create_plan(
        "debug 180 --chunk=50 --break=10 --goal=Fix production bug", "edge_test");
    auto edge_report = validator.validate(edge_plan, false);
    std::cout << "✓ Edge case validation complete - Score: " << edge_report.score << '\n';

    std::cout << "PlanValidatorEnhanced all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << "ms\n";
    return true;
}

// =============================================================================
// Main entry point
// =============================================================================
int main() {
#ifdef _WIN32
    colors::enable_ansi_support();
#endif

    std::cout << colors::code(colors::blue())
              << "=== Starting Plan Module Tests ==="
              << colors::code(colors::reset()) << '\n';

    TestRunner runner;
    Stopwatch   total_sw;

    runner.run("PlanProcessor",         test_plan_processor);
    runner.run("PlanTemplateEngine",    test_template_engine);
    runner.run("SmartTimePlanner",      test_smart_planner);
    runner.run("PlanValidatorEnhanced", test_validator);

    const double total_time = total_sw.elapsed_ms();

    // Detailed results
    print_section_header("Detailed Test Results");
    for (const auto& result : runner.results()) {
        print_test_result(result);
    }

    // Summary
    print_section_header("Final Test Summary");
    const int total  = static_cast<int>(runner.results().size());
    const int passed = runner.passed_count();
    const int failed = runner.failed_count();

    print_summary_line("Total tests:", total);
    print_summary_line("Passed:", passed);
    print_summary_line("Failed:", failed);

    std::cout << std::left << std::setw(fmt::kSummaryLabel) << "Success rate:"
              << std::right << std::setw(fmt::kSummaryValue)
              << std::fixed << std::setprecision(1)
              << (total > 0 ? static_cast<double>(passed) / total * 100.0 : 0.0) << "%\n";

    print_summary_line("Total execution:", total_time, "ms");

    if (failed == 0) {
        std::cout << '\n' << colors::code(colors::green())
                  << "✅ All tests passed successfully!"
                  << colors::code(colors::reset()) << '\n';
        return 0;
    }

    std::cout << '\n' << colors::code(colors::red())
              << "❌ " << failed << " test(s) failed. Please check the output above."
              << colors::code(colors::reset()) << '\n';
    return 1;
}