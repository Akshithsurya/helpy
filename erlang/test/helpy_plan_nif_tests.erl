-module(helpy_plan_nif_tests).
-include_lib("eunit/include/eunit.hrl").
-include_lib("jiffy.hrl"). % For JSON validation, add this dependency if not present

nif_test_() ->
    {setup,
     fun setup/0,
     fun cleanup/1,
     [fun test_parse_plan_valid_input/1,
      fun test_parse_plan_invalid_input/1,
      fun test_generate_recommendation_valid_vitals/1,
      fun test_generate_recommendation_edge_cases/1]}.

setup() ->
    % Try to init NIF, fallback to pure Erlang implementations
    case catch helpy_plan_nif:init() of
        ok -> ok;
        Error -> 
            io:format("NIF initialization failed, falling back to Erlang implementation: ~p~n", [Error]),
            ok
    end.

cleanup(_) ->
    ok.

test_parse_plan_valid_input(_) ->
    % Test with realistic plan input
    Input = <<"I need to complete 3 project milestones by end of month, allocate 10 hours per week">>,
    Result = helpy_plan_nif:parse_plan(Input),
    % Verify binary type and non-empty
    ?assert(is_binary(Result)),
    ?assertNotEqual(<<>>, Result),
    % Verify valid JSON structure
    try jiffy:decode(Result) of
        {Plan} when is_list(Plan) ->
            % Check for expected top-level keys in parsed plan
            ?assert(lists:keymember(<<"tasks">>, 1, Plan), "Parsed plan missing 'tasks' key"),
            ?assert(lists:keymember(<<"timeline">>, 1, Plan), "Parsed plan missing 'timeline' key"),
            ?assert(lists:keymember(<<"hours_allocated">>, 1, Plan), "Parsed plan missing 'hours_allocated' key");
        Invalid ->
            ?assert(false, "Invalid JSON structure returned: " ++ binary_to_list(term_to_binary(Invalid)))
    catch
        _:_ ->
            ?assert(false, "Failed to parse plan output as valid JSON: " ++ binary_to_list(Result))
    end.

test_parse_plan_invalid_input(_) ->
    % Test with empty input
    EmptyResult = helpy_plan_nif:parse_plan(<<>>),
    ?assert(is_binary(EmptyResult)),
    % Verify error is properly formatted in JSON
    try jiffy:decode(EmptyResult) of
        {Error} when is_list(Error) ->
            ?assert(lists:keymember(<<"error">>, 1, Error), "Invalid input error missing 'error' key");
        _ ->
            ?assert(false, "Empty input did not return structured error")
    catch
        _:_ ->
            ?assert(false, "Empty input returned invalid JSON error: " ++ binary_to_list(EmptyResult))
    end,
    
    % Test with non-UTF8 binary input
    InvalidUtf8 = <<16#ff, 16#fe, 16#fd>>,
    BadUtf8Result = helpy_plan_nif:parse_plan(InvalidUtf8),
    ?assert(is_binary(BadUtf8Result)),
    ?assertNotEqual(<<>>, BadUtf8Result).

test_generate_recommendation_valid_vitals(_) ->
    % Test with normal vital signs (systolic, diastolic, heart rate)
    Systolic = 120,
    Diastolic = 70,
    HeartRate = 80,
    Result = helpy_plan_nif:generate_recommendation(Systolic, Diastolic, HeartRate),
    ?assert(is_binary(Result)),
    ?assertNotEqual(<<>>, Result),
    % Validate recommendation JSON structure
    try jiffy:decode(Result) of
        {Rec} when is_list(Rec) ->
            ?assert(lists:keymember(<<"risk_level">>, 1, Rec), "Recommendation missing 'risk_level' key"),
            ?assert(lists:keymember(<<"advice">>, 1, Rec), "Recommendation missing 'advice' key"),
            % Verify risk level is one of expected values
            {<<"risk_level">>, Level} = lists:keyfind(<<"risk_level">>, 1, Rec),
            ?assert(lists:member(Level, [<<"low">>, <<"medium">>, <<"high">>]), "Invalid risk level returned");
        _ ->
            ?assert(false, "Recommendation returned invalid JSON structure")
    catch
        _:_ ->
            ?assert(false, "Failed to parse recommendation as valid JSON: " ++ binary_to_list(Result))
    end.

test_generate_recommendation_edge_cases(_) ->
    % Test critical high blood pressure
    CriticalResult = helpy_plan_nif:generate_recommendation(180, 120, 110),
    ?assert(is_binary(CriticalResult)),
    ?assertNotEqual(<<>>, CriticalResult),
    % Verify critical case returns high risk
    {CriticalJson} = jiffy:decode(CriticalResult),
    ?assertEqual(<<"high">>, proplists:get_value(<<"risk_level">>, CriticalJson)),
    
    % Test very low vitals
    LowResult = helpy_plan_nif:generate_recommendation(90, 60, 50),
    ?assert(is_binary(LowResult)),
    ?assertNotEqual(<<>>, LowResult),
    
    % Test out of bounds inputs (negative vitals)
    InvalidResult = helpy_plan_nif:generate_recommendation(-10, -5, -3),
    ?assert(is_binary(InvalidResult)),
    {InvalidJson} = jiffy:decode(InvalidResult),
    ?assert(lists:keymember(<<"error">>, 1, InvalidJson), "Invalid vitals did not return error").
