
-module(helpy_plan_parser_tests).
-include_lib("eunit/include/eunit.hrl").

parser_test_() ->
    [
        ?_assertMatch(#{duration_minutes := 30}, helpy_plan_parser:parse("")),
        ?_assertMatch(#{duration_minutes := 60, used_preset := <<"work">>}, helpy_plan_parser:parse("work")),
        ?_assertMatch(#{duration_minutes := 45, used_preset := <<"study">>}, helpy_plan_parser:parse("study")),
        ?_assertMatch(#{duration_minutes := 25, used_preset := <<"focus">>}, helpy_plan_parser:parse("focus")),
        ?_assertMatch(#{duration_minutes := 90, used_preset := <<"code">>}, helpy_plan_parser:parse("code")),
        ?_assertMatch(#{chunk_size_minutes := 30}, helpy_plan_parser:parse("--chunk 30")),
        ?_assertMatch(#{break_minutes := 10}, helpy_plan_parser:parse("--break 10")),
        ?_assertMatch(#{goal := <<"Finish project">>}, helpy_plan_parser:parse("--goal Finish project")),
        ?_assertMatch(#{tags := [<<"work">>, <<"urgent">>]}, helpy_plan_parser:parse("--tags work,urgent")),
        ?_assertMatch(#{duration_minutes := 120}, helpy_plan_parser:parse("120")),
        ?_assertMatch(#{title := <<"My Custom Plan">>, duration_minutes := 45}, helpy_plan_parser:parse("My Custom Plan 45"))
    ].
