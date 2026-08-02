-module(helpy_plan_analytics).

-export([
    analyze_plans/1,
    calculate_completion_rate/1,
    find_optimal_focus_time/1,
    generate_recommendations/1,
    track_plan_completion/1
]).

-type plan() :: helpy_plan_service:plan().
-type analytics_result() :: #{
    total_plans        => non_neg_integer(),
    completed_plans    => non_neg_integer(),
    completion_rate    => float(),
    average_duration   => float(),
    optimal_focus_time => pos_integer(),
    recommendations    => [binary()]
}.

-define(COMPLETED_STATUS,          <<"completed">>).
-define(DEFAULT_FOCUS_TIME,        25).
-define(MIN_FOCUS_TIME,            1).
-define(MAX_FOCUS_TIME,            90).
-define(LOW_COMPLETION_THRESHOLD,  0.3).
-define(HIGH_COMPLETION_THRESHOLD, 0.7).

%%%===================================================================
%%% Public API
%%%===================================================================

-spec analyze_plans([plan()]) -> analytics_result().
analyze_plans(Plans) when is_list(Plans) ->
    {Total, Completed, DurSum} = aggregate_plans(Plans),
    CompletionRate = safe_divide(Completed, Total),
    AvgDuration    = safe_divide(DurSum, Completed),
    #{
        total_plans        => Total,
        completed_plans    => Completed,
        completion_rate    => CompletionRate,
        average_duration   => AvgDuration,
        optimal_focus_time => optimal_focus_time(AvgDuration),
        recommendations    => recommendations_for(CompletionRate, Total)
    }.

-spec calculate_completion_rate([plan()]) -> float().
calculate_completion_rate(Plans) when is_list(Plans) ->
    {Total, Completed, _} = aggregate_plans(Plans),
    safe_divide(Completed, Total).

-spec find_optimal_focus_time([plan()]) -> pos_integer().
find_optimal_focus_time(Plans) when is_list(Plans) ->
    {_, Completed, DurSum} = aggregate_plans(Plans),
    optimal_focus_time(safe_divide(DurSum, Completed)).

-spec generate_recommendations([plan()]) -> [binary()].
generate_recommendations(Plans) when is_list(Plans) ->
    {Total, Completed, _} = aggregate_plans(Plans),
    recommendations_for(safe_divide(Completed, Total), Total).

-spec track_plan_completion(plan()) -> ok.
track_plan_completion(#{status := ?COMPLETED_STATUS} = Plan) ->
    Duration = maps:get(duration_minutes, Plan, 0),
    helpy_plan_metrics:observe(focus_duration, Duration),
    helpy_plan_metrics:increment(plans_completed);
track_plan_completion(_Plan) ->
    ok.

%%%===================================================================
%%% Internal helpers
%%%===================================================================

%% Returns {TotalPlans, CompletedPlans, SumOfCompletedDurations}.
-spec aggregate_plans([plan()]) ->
    {non_neg_integer(), non_neg_integer(), non_neg_integer()}.
aggregate_plans(Plans) ->
    lists:foldl(
        fun(Plan, {Total, Completed, DurSum}) ->
            case maps:get(status, Plan, undefined) of
                ?COMPLETED_STATUS ->
                    {Total + 1,
                     Completed + 1,
                     DurSum + maps:get(duration_minutes, Plan, 0)};
                _Status ->
                    {Total + 1, Completed, DurSum}
            end
        end,
        {0, 0, 0},
        Plans).

%% Convert average duration (minutes) to a clamped focus-window length.
-spec optimal_focus_time(number()) -> pos_integer().
optimal_focus_time(AvgDuration) when not is_number(AvgDuration); AvgDuration =< 0 ->
    ?DEFAULT_FOCUS_TIME;
optimal_focus_time(AvgDuration) ->
    Raw = round(AvgDuration),
    max(?MIN_FOCUS_TIME, min(?MAX_FOCUS_TIME, Raw)).

-spec safe_divide(number(), number()) -> float().
safe_divide(_N, D) when D == 0 -> 0.0;
safe_divide(N, D) when is_number(N), is_number(D) -> N / D.

-spec recommendations_for(float(), non_neg_integer()) -> [binary()].
recommendations_for(_Rate, 0) ->
    [<<"No plans yet. Start by creating a small, achievable goal to build momentum.">>];
recommendations_for(Rate, _Total) when Rate < ?LOW_COMPLETION_THRESHOLD ->
    low_completion_recommendations();
recommendations_for(Rate, _Total) when Rate < ?HIGH_COMPLETION_THRESHOLD ->
    medium_completion_recommendations();
recommendations_for(_Rate, _Total) ->
    high_completion_recommendations().

-spec low_completion_recommendations() -> [binary()].
low_completion_recommendations() ->
    [
        <<"Your completion rate is below 30% – try setting smaller, more achievable goals to build consistency.">>,
        <<"Break large plans into 15-20 minute focus sessions to reduce overwhelm and boost finishing rates.">>,
        <<"Track progress after each session to identify what's slowing you down.">>
    ].

-spec medium_completion_recommendations() -> [binary()].
medium_completion_recommendations() ->
    [
        <<"Great progress! Your 30-70% completion rate shows consistent effort. Keep up this pace.">>,
        <<"Schedule focus sessions at the same time daily to build a reliable, automatic habit.">>,
        <<"Experiment with adding 5 minutes to your current focus windows to gradually increase capacity.">>
    ].

-spec high_completion_recommendations() -> [binary()].
high_completion_recommendations() ->
    [
        <<"Excellent work! Your completion rate is over 70% – you've mastered consistent execution.">>,
        <<"Try extending your focus sessions by 5-10 minutes to take on more challenging tasks.">>,
        <<"You're ready to tackle complex, multi-step plans that align with your long-term goals.">>
    ].