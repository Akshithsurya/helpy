-module(helpy_plan_parser_tests).
-include_lib("eunit/include/eunit.hrl").

%% Comprehensive tests for plan parser covering all input types and edge cases
parser_test_() ->
    [
        %% Default values when no input is provided
        ?_assertMatch(#{duration_minutes := 30}, helpy_plan_parser:parse(""), "Empty input uses default 30 minute duration"),
        
        %% Named preset tests with their defined durations
        ?_assertMatch(#{duration_minutes := 60, used_preset := <<"work">>}, 
            helpy_plan_parser:parse("work"), "Work preset parses correctly to 60 minutes"),
        ?_assertMatch(#{duration_minutes := 45, used_preset := <<"study">>}, 
            helpy_plan_parser:parse("study"), "Study preset parses correctly to 45 minutes"),
        ?_assertMatch(#{duration_minutes := 25, used_preset := <<"focus">>}, 
            helpy_plan_parser:parse("focus"), "Focus preset parses correctly to 25 minutes"),
        ?_assertMatch(#{duration_minutes := 90, used_preset := <<"code">>}, 
            helpy_plan_parser:parse("code"), "Code preset parses correctly to 90 minutes"),
        
        %% Flag/option parsing tests
        ?_assertMatch(#{chunk_size_minutes := 30}, 
            helpy_plan_parser:parse("--chunk 30"), "--chunk flag sets correct chunk size"),
        ?_assertMatch(#{break_minutes := 10}, 
            helpy_plan_parser:parse("--break 10"), "--break flag sets correct break duration"),
        ?_assertMatch(#{goal := <<"Finish project">>}, 
            helpy_plan_parser:parse("--goal Finish project"), "--goal flag captures multi-word goal"),
        ?_assertMatch(#{tags := [<<"work">>, <<"urgent">>]}, 
            helpy_plan_parser:parse("--tags work,urgent"), "--tags flag parses comma-separated tags"),
        
        %% Numeric duration input test
        ?_assertMatch(#{duration_minutes := 120}, 
            helpy_plan_parser:parse("120"), "Raw numeric input sets correct duration"),
        
        %% Custom plan with title and explicit duration
        ?_assertMatch(#{title := <<"My Custom Plan">>, duration_minutes := 45}, 
            helpy_plan_parser:parse("My Custom Plan 45"), "Custom title + duration parses correctly")
    ].
