
-module(helpy_plan_validator_tests).
-include_lib("eunit/include/eunit.hrl").

basic_validation_test_() ->
    [
        ?_assertEqual(ok, helpy_plan_validator:validate_plan(#{duration_minutes => 30, chunk_size_minutes => 15, break_minutes => 5})),
        ?_assertMatch({error, _}, helpy_plan_validator:validate_plan(#{duration_minutes => 1, chunk_size_minutes => 15, break_minutes => 5})),
        ?_assertMatch({error, _}, helpy_plan_validator:validate_plan(#{duration_minutes => 300, chunk_size_minutes => 15, break_minutes => 5})),
        ?_assertMatch({error, _}, helpy_plan_validator:validate_plan(#{duration_minutes => 30, chunk_size_minutes => 1, break_minutes => 5})),
        ?_assertMatch({error, _}, helpy_plan_validator:validate_plan(#{duration_minutes => 30, chunk_size_minutes => 150, break_minutes => 5})),
        ?_assertMatch({error, _}, helpy_plan_validator:validate_plan(#{duration_minutes => 30, chunk_size_minutes => 15, break_minutes => 0})),
        ?_assertMatch({error, _}, helpy_plan_validator:validate_plan(#{duration_minutes => 30, chunk_size_minutes => 15, break_minutes => 60}))
    ].
