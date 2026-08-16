-module(helpy_plan_validator_tests).
-include_lib("eunit/include/eunit.hrl").

%% Base valid plan configuration used as a baseline for test cases
base_valid_plan() ->
    #{duration_minutes => 30, chunk_size_minutes => 15, break_minutes => 5}.

%% Test suite covering both valid and invalid plan scenarios
basic_validation_test_() ->
    ValidPlan = base_valid_plan(),
    [
        % Happy path: valid base plan should pass validation
        ?_assertEqual(ok, helpy_plan_validator:validate_plan(ValidPlan)),
        
        % Invalid total duration (too short: minimum allowed is 5 minutes)
        ?_assertMatch({error, #{duration_minutes := invalid_range}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{duration_minutes => 1})),
        % Invalid total duration (too long: maximum allowed is 480 minutes / 8 hours)
        ?_assertMatch({error, #{duration_minutes := invalid_range}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{duration_minutes => 300})),
        
        % Invalid chunk size (too small: minimum allowed is 5 minutes)
        ?_assertMatch({error, #{chunk_size_minutes := invalid_range}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{chunk_size_minutes => 1})),
        % Invalid chunk size (too large: exceeds maximum allowed 120 minutes / 2 hours)
        ?_assertMatch({error, #{chunk_size_minutes := invalid_range}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{chunk_size_minutes => 150})),
        
        % Invalid break duration (too short: minimum 1 minute required)
        ?_assertMatch({error, #{break_minutes := invalid_range}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{break_minutes => 0})),
        % Invalid break duration (too long: maximum 30 minutes allowed)
        ?_assertMatch({error, #{break_minutes := invalid_range}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{break_minutes => 60})),
        
        % Additional logical constraint: chunk size cannot exceed total duration
        ?_assertMatch({error, #{chunk_size_minutes := exceeds_total_duration}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{duration_minutes => 10, chunk_size_minutes => 15})),
        % Additional logical constraint: break cannot be longer than chunk size
        ?_assertMatch({error, #{break_minutes := exceeds_chunk_size}}, 
            helpy_plan_validator:validate_plan(ValidPlan#{break_minutes => 20}))
    ].
