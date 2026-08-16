-module(integration_tests).
-include_lib("eunit/include/eunit.hrl").
-compile([nowarn_export_all, export_all]).

-define(STATUS_COMPLETED, <<"completed">>).
-define(ASSERT_FAIL(Expr, Reason), ?assert(Expr, Reason)).

%% ---------------------------------------------------------------------------
%% EUnit entry point
%% ---------------------------------------------------------------------------
integration_test_() ->
    {setup,
     fun setup/0,
     fun cleanup/1,
     [{inorder, [
        ?_test(test_full_plan_workflow()),
        ?_test(test_analytics_pipeline())
     ]}]}.

%% ---------------------------------------------------------------------------
%% Internal helpers
%% ---------------------------------------------------------------------------
ensure(ok, _Message) -> ok;
ensure({error, Reason}, Message) ->
    error(io_lib:format("~s: ~p", [Message, Reason])).

%% ---------------------------------------------------------------------------
%% Setup / cleanup
%% ---------------------------------------------------------------------------
setup() ->
    ok = ensure(helpy_plan_config:load(), "Failed to load configuration"),
    ok = ensure(helpy_plan_metrics:init(), "Failed to initialize metrics system"),
    #{started_at => erlang:system_time(millisecond)}.

cleanup(#{started_at := _StartedAt}) ->
    catch helpy_plan_metrics:reset(),
    ok.

%% ---------------------------------------------------------------------------
%% Tests
%% ---------------------------------------------------------------------------

%% Create binary title plan (primary implementation)
make_plan(Title) when is_binary(Title), byte_size(Title) > 0 ->
    helpy_plan_service:create_plan(Title, #{});

%% Convert list titles to binary for compatibility
make_plan(Title) when is_list(Title), length(Title) > 0 ->
    case unicode:characters_to_binary(Title) of
        Bin when is_binary(Bin) -> make_plan(Bin);
        {error, _, _} -> error({invalid_unicode_title, Title})
    end.
