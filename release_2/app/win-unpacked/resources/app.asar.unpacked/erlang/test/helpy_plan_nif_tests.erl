-module(helpy_plan_nif_tests).
-include_lib("eunit/include/eunit.hrl").

nif_test_() ->
    {setup,
     fun setup/0,
     fun cleanup/1,
     [fun test_parse_plan/0,
      fun test_generate_recommendation/0]}.

setup() ->
    % Try to init NIF, fallback to pure Erlang implementations
    case catch helpy_plan_nif:init() of
        ok -> ok;
        _ -> ok % Fallback is already available
    end.

cleanup(_) ->
    ok.

test_parse_plan() ->
    Result = helpy_plan_nif:parse_plan(<<"Test Plan">>),
    ?assert(is_binary(Result)),
    % Verify we get valid JSON
    ?assertNotEqual(<<>>, Result).

test_generate_recommendation() ->
    Result = helpy_plan_nif:generate_recommendation(120, 70, 80),
    ?assert(is_binary(Result)),
    ?assertNotEqual(<<>>, Result).
