#include <algorithm>
#include <chrono>
#include <concepts>
#include <iomanip>
#include <iostream>
#include <ranges>
#include <source_location>
#include <stdexcept>
#include <string>
#include <string_view>
#include <type_traits>
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
// Terminal color management -- codes are only emitted when output is a TTY
// -----------------------------------------------------------------------------
namespace colors {

#ifdef _WIN32
void enable_ansi_support() noexcept {
    HANDLE const hOut = GetStdHandle(STD_OUTPUT_HANDLE);
    if (hOut == INVALID_HANDLE_VALUE) {
        return;
    }
    DWORD mode = 0;
    if (GetConsoleMode(hOut, &mode)) {
        SetConsoleMode(hOut, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
    }
}
#endif

[[nodiscard]] constexpr std::string_view green()  noexcept { return "\033[32m"; }
[[nodiscard]] constexpr std::string_view red()    noexcept { return "\033[31m"; }
[[nodiscard]] constexpr std::string_view yellow() noexcept { return "\033[33m"; }
[[nodiscard]] constexpr std::string_view blue()   noexcept { return "\033[34m"; }
[[nodiscard]] constexpr std::string_view reset()  noexcept { return "\033[0m";  }

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
// Assertion helper (replaces macro; uses std::source_location for diagnostics)
// -----------------------------------------------------------------------------
void test_assert(bool cond, std::string_view msg,
                 std::source_location loc = std::source_location::current()) {
    if (!cond) [[unlikely]] {
        throw std::runtime_error(
            "Assertion failed at " + std::string(loc.file_name()) +
            ":" + std::to_string(loc.line()) + ": " + std::string(msg));
    }
}

// -----------------------------------------------------------------------------
// Formatting constants
// -----------------------------------------------------------------------------
namespace fmt {
    constexpr int kStatusWidth  = 8;
    constexpr int kNameWidth    = 30;
    constexpr int kTimeWidth    = 10;
    constexpr int kSummaryLabel = 20;
    constexpr int kSummaryValue = 10;
}

// -----------------------------------------------------------------------------
// Test result record
// -----------------------------------------------------------------------------
struct TestResult {
    std::string test_name;
    bool        passed            = false;
    std::string error_message;
    double      execution_time_ms = 0.0;
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
// Test runner -- encapsulates execution, result collection, and aggregation
// -----------------------------------------------------------------------------
class TestRunner {
    std::vector<TestResult> results_;

public:
    /// Runs a test function, capturing pass/fail status, exceptions, and timing.
    template <typename F>
        requires std::invocable<F>
              && std::convertible_to<std::invoke_result_t<F>, bool>
    void run(std::string_view name, F&& test_func) {
        Stopwatch sw;
        TestResult result;
        result.test_name = std::string(name);

        try {
            result.passed = std::forward<F>(test_func)();
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

    [[nodiscard]] const std::vector<TestResult>& results() const noexcept {
        return results_;
    }

    [[nodiscard]] std::size_t total_count() const noexcept {
        return results_.size();
    }

    [[nodiscard]] std::size_t passed_count() const noexcept {
        return static_cast<std::size_t>(
            std::ranges::count_if(results_,
                [](const TestResult& r) { return r.passed; }));
    }

    [[nodiscard]] std::size_t failed_count() const noexcept {
        return results_.size() - passed_count();
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

/// Prints a successful step message with consistent indentation.
template <typename... Args>
void print_step(Args&&... args) {
    std::cout << "  [OK] ";
    (std::cout << ... << std::forward<Args>(args)) << '\n';
}

void print_test_result(const TestResult& result) {
    if (result.passed) {
        std::cout << colors::code(colors::green())
                  << std::left << std::setw(fmt::kStatusWidth) << "[PASS]"
                  << colors::code(colors::reset())
                  << ' ' << std::setw(fmt::kNameWidth) << result.test_name
                  << std::right << std::setw(fmt::kTimeWidth)
                  << std::fixed << std::setprecision(2)
                  << result.execution_time_ms << " ms\n";
    } else {
        std::cout << colors::code(colors::red())
                  << std::left << std::setw(fmt::kStatusWidth) << "[FAIL]"
                  << colors::code(colors::reset())
                  << ' ' << std::setw(fmt::kNameWidth) << result.test_name
                  << " | Error: " << result.error_message << '\n';
    }
}

void print_summary_line(std::string_view label, int value) {
    std::cout << std::left  << std::setw(fmt::kSummaryLabel) << label
              << std::right << std::setw(fmt::kSummaryValue) << value << '\n';
}

void print_summary_line(std::string_view label, double value,
                        std::string_view suffix = {}) {
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
    print_step("Plan created successfully");

    test_assert(PlanProcessor::validate_plan(45, 25, 5),
                "Validation failed for valid parameters");
    print_step("Validation passed for valid parameters");

    test_assert(!PlanProcessor::validate_plan(0, 25, 5),
                "Validation passed for invalid total duration");
    print_step("Validation correctly failed for invalid total duration");

    test_assert(!plan.tasks.empty(), "No tasks generated");
    print_step("Generated ", plan.tasks.size(), " tasks");

    auto json = PlanProcessor::plan_to_json(plan);
    test_assert(!json.empty(), "JSON generation failed");
    print_step("JSON serialization successful (", json.size(), " bytes)");
    if (json.size() > 100) {
        std::cout << "    Preview: "
                  << std::string_view(json.data(), 100) << "...\n";
    }

    std::cout << "PlanProcessor all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << " ms\n";
    return true;
}

bool test_template_engine() {
    print_section_header("Testing PlanTemplateEngine");
    Stopwatch sw;

    PlanTemplateEngine::TemplateEngine engine;

    auto templates = engine.get_all_templates();
    test_assert(!templates.empty(), "No templates found");
    print_step("Found ", templates.size(), " system templates");

    auto json = engine.templates_to_json(templates);
    test_assert(!json.empty(), "Templates JSON generation failed");
    print_step("Templates JSON generated successfully (", json.size(), " bytes)");

    const auto& first = templates.front();
    auto applied_plan = engine.apply_template(first.id, "custom goal", "test");
    print_step("Template '", first.name, "' applied successfully");

    auto applied_json = PlanProcessor::plan_to_json(applied_plan);
    test_assert(!applied_json.empty(), "Applied plan JSON generation failed");
    print_step("Applied plan JSON serialization successful");

    std::cout << "PlanTemplateEngine all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << " ms\n";
    return true;
}

bool test_smart_planner() {
    print_section_header("Testing SmartTimePlanner");
    Stopwatch sw;

    SmartTimePlanner::SmartPlanner planner;

    auto plan = PlanProcessor::create_plan("code 90 --chunk=30 --break=5", "test");

    auto schedule = planner.generate_schedule(plan, 9, 0);
    test_assert(schedule.success, "Schedule generation failed");
    print_step("Schedule generated with ", schedule.slots.size(), " time slots");

    auto schedule_json = planner.schedule_to_json(schedule);
    test_assert(!schedule_json.empty(), "Schedule JSON generation failed");
    print_step("Schedule JSON serialization successful");

    auto optimized_json = planner.generate_optimized_plan(plan, true);
    test_assert(!optimized_json.empty(), "Plan optimization failed");
    print_step("Optimized plan generated successfully");

    std::vector<PlanProcessor::FullPlan> past_plans;
    past_plans.reserve(2);
    past_plans.push_back(PlanProcessor::create_plan("work 60 --chunk=25 --break=5", "past1"));
    past_plans.push_back(PlanProcessor::create_plan("study 120 --chunk=30 --break=5", "past2"));

    auto stats = planner.analyze_productivity(past_plans);
    auto stats_json = planner.stats_to_json(stats);
    test_assert(!stats_json.empty(), "Productivity analysis failed");
    print_step("Productivity analysis generated for ",
               past_plans.size(), " historical plans");

    std::cout << "SmartTimePlanner all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << " ms\n";
    return true;
}

bool test_validator() {
    print_section_header("Testing PlanValidatorEnhanced");
    Stopwatch sw;

    PlanValidatorEnhanced::EnhancedValidator validator;

    auto plan = PlanProcessor::create_plan(
        "study 60 --chunk=45 --break=10 --goal=Learn C++", "test");

    auto report = validator.validate(plan, false);
    print_step("Validation complete - Score: ", report.score,
               ", Issues found: ", report.issues.size());

    auto full_report = validator.validate_and_suggest(plan);
    print_step("Validation + suggestion analysis complete");

    auto report_json = validator.report_to_json(full_report);
    test_assert(!report_json.empty(), "Report JSON generation failed");
    print_step("Report JSON serialization successful");

    auto score_str = validator.calculate_quality_score(plan);
    print_step("Plan quality score: ", score_str);

    auto improvements = validator.suggest_improvements(plan);
    print_step("Found ", improvements.size(), " improvement suggestions");

    auto edge_plan = PlanProcessor::create_plan(
        "debug 180 --chunk=50 --break=10 --goal=Fix production bug", "edge_test");
    auto edge_report = validator.validate(edge_plan, false);
    print_step("Edge case validation complete - Score: ", edge_report.score);

    std::cout << "PlanValidatorEnhanced all tests passed in "
              << std::fixed << std::setprecision(2) << sw.elapsed_ms() << " ms\n";
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
    const std::size_t total  = runner.total_count();
    const std::size_t passed = runner.passed_count();
    const std::size_t failed = runner.failed_count();

    print_summary_line("Total tests:",    static_cast<int>(total));
    print_summary_line("Passed:",         static_cast<int>(passed));
    print_summary_line("Failed:",         static_cast<int>(failed));

    std::cout << std::left  << std::setw(fmt::kSummaryLabel) << "Success rate:"
              << std::right << std::setw(fmt::kSummaryValue)
              << std::fixed << std::setprecision(1)
              << (total > 0 ? static_cast<double>(passed) / total * 100.0 : 0.0)
              << "%\n";

    print_summary_line("Total execution:", total_time, " ms");

    if (failed == 0) {
        std::cout << '\n' << colors::code(colors::green())
                  << "[PASS] All tests passed successfully!"
                  << colors::code(colors::reset()) << '\n';
        return 0;
    }

    std::cout << '\n' << colors::code(colors::red())
              << "[FAIL] " << failed
              << " test(s) failed. Please check the output above."
              << colors::code(colors::reset()) << '\n';
    return 1;
}