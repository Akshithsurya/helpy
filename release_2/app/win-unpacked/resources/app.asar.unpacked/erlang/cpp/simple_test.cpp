#include <iostream>
#include <string>
#include <stdexcept>
#include <vector>
#include <iomanip>
#include "include/plan_processor.hpp"

// Test case structure to organize multiple test scenarios
struct TestCase {
    std::string name;
    std::function<bool()> test_function;
};

int main() {
    int passed_tests = 0;
    int total_tests = 0;
    std::vector<TestCase> test_suite;

    try {
        std::cout << "=== Plan Processor Test Suite ===" << std::endl;

        // Test 1: Create and validate basic plan
        test_suite.push_back({
            "Basic Plan Creation and Validation",
            []() {
                auto plan = PlanProcessor::create_plan("work 45 --goal=Test", "test");
                if (plan.title.empty()) {
                    std::cerr << "Error: Plan title cannot be empty" << std::endl;
                    return false;
                }
                if (plan.tasks.empty()) {
                    std::cerr << "Error: Plan should contain at least one task" << std::endl;
                    return false;
                }
                std::cout << "✓ Plan created successfully: " << plan.title << std::endl;
                std::cout << "✓ Number of tasks in plan: " << plan.tasks.size() << std::endl;
                return true;
            }
        });

        // Test 2: JSON serialization and deserialization
        test_suite.push_back({
            "JSON Serialization and Deserialization",
            []() {
                auto original_plan = PlanProcessor::create_plan("work 45 --goal=JSON Test", "json_test");
                std::string json = PlanProcessor::plan_to_json(original_plan);
                
                if (json.empty()) {
                    std::cerr << "Error: JSON serialization failed: output is empty" << std::endl;
                    return false;
                }

                // Verify we can deserialize the JSON back to a plan
                try {
                    auto deserialized_plan = PlanProcessor::json_to_plan(json);
                    if (deserialized_plan.title != original_plan.title) {
                        std::cerr << "Error: Plan title mismatch after deserialization" << std::endl;
                        return false;
                    }
                } catch (const std::exception& e) {
                    std::cerr << "Error: JSON deserialization failed: " << e.what() << std::endl;
                    return false;
                }

                const size_t preview_length = std::min<size_t>(100, json.size());
                std::cout << "✓ JSON serialization/deserialization successful. Preview: " 
                          << json.substr(0, preview_length);
                if (json.size() > preview_length) {
                    std::cout << "... (full length: " << json.size() << " chars)";
                }
                std::cout << std::endl;
                return true;
            }
        });

        // Execute all tests
        total_tests = test_suite.size();
        for (const auto& test : test_suite) {
            std::cout << "\n[Running Test] " << test.name << "..." << std::endl;
            if (test.test_function()) {
                passed_tests++;
                std::cout << "✓ Test passed: " << test.name << std::endl;
            } else {
                std::cerr << "✗ Test failed: " << test.name << std::endl;
            }
        }

        // Print final summary
        std::cout << "\n==================================" << std::endl;
        std::cout << "Test Summary: " << passed_tests << "/" << total_tests << " tests passed" << std::endl;
        std::cout << "Success rate: " << std::fixed << std::setprecision(1) 
                  << (static_cast<double>(passed_tests) / total_tests * 100) << "%" << std::endl;
        
        return (passed_tests == total_tests) ? 0 : 1;

    } catch (const std::exception& e) {
        std::cerr << "\n✗ Fatal error in test suite: " << e.what() << std::endl;
        return 1;
    }
}
