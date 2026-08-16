-module(helpy_plan_analytics_tests).
-include_lib("eunit/include/eunit.hrl").

analytics_test_() ->
    {setup,
     fun setup/0,
     fun cleanup/1,
     [fun test_calculate_completion_rate/0,
      fun test_analyze_plans/0]}.

setup() ->
    ok.

cleanup(_) ->
    ok.

test_calculate_completion_rate() ->
    Plans = [
        #{<<"status">> => <<"completed">>},
        #{<<"status">> => <<"completed">>},
        #{<<"status">> => <<"pending">>},
        #{<<"status">> => <<"in_progress">>}
    ],
    Rate = helpy_plan_analytics:calculate_completion_rate(Plans),
    ?assertEqual(0.5, Rate).

test_analyze_plans() ->
    Plans = [
        #{<<"status">> => <<"completed">>, <<"duration_minutes">> => 30},
        #{<<"status">> => <<"completed">>, <<"duration_minutes">> => 45},
        #{<<"status">> => <<"pending">>, <<"duration_minutes">> => 60}
    ],
    Analytics = helpy_plan_analytics:analyze_plans(Plans),
    ?assertEqual(3, maps:get(total_plans, Analytics)),
    ?assertEqual(2, maps:get(completed_plans, Analytics)).
