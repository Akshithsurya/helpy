-module(helpy_plan_service_tests).
-include_lib("eunit/include/eunit.hrl").

%% Test group for core plan creation functionality
create_plan_test_() ->
    [
        % Basic plan generation produces non-empty task list
        ?_assertMatch(#{tasks := [_ | _]}, helpy_plan_service:create_plan("", #{})),
        % Plan correctly persists input title
        ?_assertMatch(#{title := <<"work">>}, helpy_plan_service:create_plan("work", #{})),
        % Numeric input correctly parsed to duration value
        ?_assertMatch(#{duration_minutes := 90}, helpy_plan_service:create_plan("90", #{})),
        % Custom tags are properly attached to generated plan
        ?_assertMatch(#{tags := [<<"test">>, <<"urgent">>]}, helpy_plan_service:create_plan("", #{tags => [<<"test">>, <<"urgent">>]})),
        % Break insertion adds break task in task list when enabled
        ?_assertMatch(#{tasks := [_, #{is_break := true} | _]}, helpy_plan_service:create_plan("", #{include_breaks => true}))
    ].

%% Test group for safe plan creation with input validation
create_plan_safe_test_() ->
    [
        % Valid empty input produces successful plan creation
        ?_assertMatch({ok, #{}}, helpy_plan_service:create_plan_safe("", #{})),
        % Invalid duration input correctly returns validation error
        ?_assertMatch({error, {invalid_duration, 1}}, helpy_plan_service:create_plan_safe("", #{duration_minutes => 1}))
    ].
