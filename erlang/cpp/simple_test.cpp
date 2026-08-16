#include <iostream>
#include <string>
#include <stdexcept>
#include <vector>
#include <iomanip>
#include <functional>
#include <algorithm>
#include <cstdlib>
#include <numeric>
#include <sstream>
#include <type_traits>
#include "include/plan_processor.hpp"

// Test result structure to capture detailed test outcomes
struct TestResult {
    std::string test_name;
    bool passed;
    std::vector<std::string> error_messages;
    std::vector<std::string> info_messages;
};

// Test case structure to organize multiple test scenarios
struct TestCase {
    std::string name;
    std::function<TestResult()> test_function;
};

// Generic string converter for error messages
template<typename T>
std::string to_string_impl(const T& value) {
    if constexpr (std::is_same_v<T, std::string>) {
        return value;
    } else if constexpr (std::is_arithmetic_v<T>) {
        return std::to_string(value);
    } else {
        std::ostringstream oss;
        oss << value;
        return oss.str();
    }
}

// Assertion helper to reduce code duplication and standardize error reporting
template<typename T>
void assert_true(bool condition, const std::string& error_msg, T& errors) {
    if (!condition) {
        errors.push_back(error_msg);
    }
}

template<typename T, typename U>
void assert_equal(const T& actual, const U& expected, const std::string& error_msg, std::vector<std::string>& errors) {
    if (!(actual == expected)) {
        std::string detailed_error = error_msg + " (expected: " + to_string_impl(expected) + ", actual: " + to_string_impl(actual) + ")";
        errors.push_back(detailed_error);
    }
}

template<typename T, typename U>
void assert_not_equal(const T& actual, const U& unexpected, const std::string& error_msg, std::vector<std::string>& errors) {
    if (actual == unexpected) {
        std::string detailed_error = error_msg + " (unexpected value: " + to_string_impl(unexpected) + ")";
        errors.push_back(detailed_error);
    }
}

template<typename ExceptionT, typename F>
void assert_throws(F&& func, const std::string& error_msg, std::vector<std::string>& errors) {
    bool threw_correctly = false;
    try {
        std::invoke(std::forward<F>(func));
    } catch (const ExceptionT&) {
        threw_correctly = true;
    } catch (...) {
        // Wrong exception type, leave threw_correctly as false
    }
    if (!threw_correctly) {
        errors.push_back(error_msg);
    }
}

int main() {
    size_t passed_tests = 0;
    std::vector<TestResult> all_results;

    const std::vector<TestCase> test_suite = {
        {
            "Basic Plan Creation and Validation",
            []() {
                TestResult result{"Basic Plan Creation and Validation", true, {}, {}};
                try {
                    auto plan = PlanProcessor::create_plan("work 45 --goal=Test", "test");
                    assert_not_equal(plan.title, "", "Plan title cannot be empty", result.error_messages);
                    assert_not_equal(plan.tasks.size(), 0ULL, "Plan should contain at least one task", result.error_messages);
                    
                    if (result.error_messages.empty()) {
                        result.info_messages.emplace_back("Plan created successfully: " + plan.title);
                        result.info_messages.emplace_back("Number of tasks in plan: " + std::to_string(plan.tasks.size()));
                    }
                } catch (const std::exception& e) {
                    result.error_messages.emplace_back("Unexpected exception: " + std::string(e.what()));
                }
                result.passed = result.error_messages.empty();
                return result;
            }
        },
        {
            "JSON Serialization and Deserialization",
            []() {
                TestResult result{"JSON Serialization and Deserialization", true, {}, {}};
                try {
                    auto original_plan = PlanProcessor::create_plan("work 45 --goal=JSON Test", "json_test");
                    const std::string json = PlanProcessor::plan_to_json(original_plan);
                    
                    assert_not_equal(json.size(), 0ULL, "JSON serialization failed: output is empty", result.error_messages);

                    if (!json.empty()) {
                        const auto deserialized_plan = PlanProcessor::json_to_plan(json);
                        assert_equal(deserialized_plan.title, original_plan.title, "Plan title mismatch after deserialization", result.error_messages);
                        assert_equal(deserialized_plan.tasks.size(), original_plan.tasks.size(), "Task count mismatch after deserialization", result.error_messages);

                        const size_t preview_length = std::min<size_t>(100, json.size());
                        std::string json_preview = "JSON serialization/deserialization successful. Preview: " + json.substr(0, preview_length);
                        if (json.size() > preview_length) {
                            json_preview += "... (full length: " + std::to_string(json.size()) + " chars)";
                        }
                        result.info_messages.push_back(json_preview);
                    }
                } catch (const std::exception& e) {
                    result.error_messages.emplace_back("Error: " + std::string(e.what()));
                }
                result.passed = result.error_messages.empty();
                return result;
            }
        },
        {
            "Empty Input Plan Creation",
            []() {
                TestResult result{"Empty Input Plan Creation", true, {}, {}};
                assert_throws<std::invalid_argument>([](){
                    (void)PlanProcessor::create_plan("", "empty_test");
                }, "Incorrectly accepted empty input (expected invalid_argument)", result.error_messages);
                
                if (result.error_messages.empty()) {
                    result.info_messages.emplace_back("Correctly rejected empty input as expected");
                }
                result.passed = result.error_messages.empty();
                return result;
            }
        },
        {
            "Invalid JSON Deserialization",
            []() {
                TestResult result{"Invalid JSON Deserialization", true, {}, {}};
                assert_throws<std::invalid_argument>([](){
                    (void)PlanProcessor::json_to_plan("{invalid json}");
                }, "Incorrectly accepted invalid JSON (expected invalid_argument)", result.error_messages);
                
                if (result.error_messages.empty()) {
                    result.info_messages.emplace_back("Correctly rejected invalid JSON as expected");
                }
                result.passed = result.error_messages.empty();
                return result;
            }
        }
    };

    const size_t total_tests = test_suite.size();
    std::cout << "=== Plan Processor Test Suite ===" << std::endl;
    std::cout << "Running " << total_tests << " test cases...\n" << std::endl;

    for (const auto& test : test_suite) {
        std::cout << "[Running Test] " << test.name << "..." << std::endl;
        const auto result = test.test_function();
        all_results.push_back(result);
        
        if (result.passed) {
            passed_tests++;
            for (const auto& msg : result.info_messages) {
                std::cout << "  ℹ " << msg << std::endl;
            }
            std::cout << "✓ Test passed: " << test.name << "\n" << std::endl;
        } else {
            for (const auto& err : result.error_messages) {
                std::cerr << "  ✗ " << err << std::endl;
            }
            std::cerr << "✗ Test failed: " << test.name << "\n" << std::endl;
        }
    }

    const size_t failed_tests = total_tests - passed_tests;
    std::cout << "\n==================================" << std::endl;
    std::cout << "Test Summary: " << passed_tests << "/" << total_tests << " tests passed" << std::endl;
    std::cout << "                " << failed_tests << "/" << total_tests << " tests failed" << std::endl;
    if (total_tests > 0) {
        const double pass_rate = (static_cast<double>(passed_tests) / total_tests) * 100;
        std::cout << "Success rate: " << std::fixed << std::setprecision(1) << pass_rate << "%" << std::endl;
    }
    
    return (passed_tests == total_tests) ? EXIT_SUCCESS : EXIT_FAILURE;
}
