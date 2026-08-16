
-module(helpy_plan_service_tests).
-include_lib("eunit/include/eunit.hrl").

service_test_() ->
    [
        ?_assertMatch({ok, #{}}, helpy_plan_service:create_plan_safe("", #{})),
        ?_assertMatch({error, _}, helpy_plan_service:create_plan_safe("", #{duration_minutes => 1})),
        ?_assertMatch(#{tasks := [_ | _]}, helpy_plan_service:create_plan("", #{})),
        ?_assertMatch(#{tasks := [_, #{is_break := true} | _]}, helpy_plan_service:create_plan("", #{include_breaks => true})),
        ?_assertMatch(#{title := <<"work">>}, helpy_plan_service:create_plan("work", #{})),
        ?_assertMatch(#{duration_minutes := 90}, helpy_plan_service:create_plan("90", #{})),
        ?_assertMatch(#{tags := [<<"test">>, <<"urgent">>]}, helpy_plan_service:create_plan("", #{tags => [<<"test">>, <<"urgent">>]}))
    ].
