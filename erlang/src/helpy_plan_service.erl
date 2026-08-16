-module(helpy_plan_service).

%% API
-export([
    parse_plan/1,
    create_plan/2, create_plan_safe/2,
    break_down_into_tasks/6,
    start_plan/1, complete_plan/1, cancel_plan/1, complete_task/2,
    export_plan/2, calculate_session_stats/1,
    enqueue_plan/2, dequeue_plan/0, peek_plan/0, list_queue/0,
    clear_queue/0, queue_size/0,
    generate_smart_recommendation/3
]).

-export_type([
    plan/0, task/0, plan_options/0, export_options/0,
    create_result/0, lifecycle_result/0, priority/0
]).

-on_load(init_queue/0).

%%%===================================================================
%%% Constants
%%%===================================================================

-define(DEFAULT_PLAN_DURATION, 30).
-define(DEFAULT_CHUNK_SIZE,    15).
-define(DEFAULT_BREAK_MINUTES,  5).

-define(MIN_SESSION_MINUTES,   15).
-define(DEQUEUE_MAX_RETRIES,    8).
-define(QUEUE_TABLE, helpy_plan_queue).

%% Task descriptors — tuple for O(1) lookup via element/2.
%% Cycled via rem when there are more tasks than descriptors.
-define(DESCRIPTORS, {
    <<"Start strong">>,
    <<"Keep going">>,
    <<"Making progress">>,
    <<"Almost there">>,
    <<"Final push">>
}).
-define(DESCRIPTOR_COUNT, 5).

%% Statuses
-define(STATUS_PENDING,     <<"pending">>).
-define(STATUS_IN_PROGRESS, <<"in_progress">>).
-define(STATUS_COMPLETED,   <<"completed">>).
-define(STATUS_CANCELLED,   <<"cancelled">>).

%% Recommendation thresholds
-define(MAX_PRODUCTIVITY_GAIN,  35).
-define(BASE_PRODUCTIVITY_GAIN, 10).
-define(MIN_BREAK_MINUTES,       3).
-define(MAX_BREAK_MINUTES,      15).
-define(BREAK_DIVISOR,           5).

%% Availability caps — {ThresholdMinutes, CapMinutes}, first match wins.
-define(AVAILABILITY_BANDS, [
    {30, 20},
    {60, 30}
]).

%% Work bands — first match wins. {MinEnergy, MinIntensity, WorkMin, Message}.
-define(WORK_BANDS, [
    {80, 70, 60, <<"You're in deep work mode! Take advantage of your high energy with longer focus blocks.">>},
    {60,  0, 45, <<"Balanced energy levels - standard focus blocks with moderate breaks should work well.">>},
    {40,  0, 30, <<"Lower energy levels - shorter, more frequent focus blocks will help maintain productivity.">>},
    { 0,  0, 20, <<"Low energy - consider light tasks with very short focus bursts.">>}
]).
-define(FALLBACK_WORK, 20).
-define(FALLBACK_MSG,  <<"Low energy - consider light tasks with very short focus bursts.">>).

%%%===================================================================
%%% Types
%%%===================================================================

-type status() :: ?STATUS_PENDING | ?STATUS_IN_PROGRESS
                | ?STATUS_COMPLETED | ?STATUS_CANCELLED.

-type parsed_plan() :: helpy_plan_parser:parsed_plan().

-type task() :: #{
    id               := binary(),
    title            := binary(),
    duration_minutes := non_neg_integer(),
    completed        := boolean(),
    completed_at      := undefined | integer(),
    is_break         := boolean()
}.

-type plan() :: #{
    id                 := binary(),
    title              := binary(),
    goal               := binary(),
    duration_minutes   := non_neg_integer(),
    tasks              := [task()],
    chunk_size_minutes := non_neg_integer(),
    break_minutes      := non_neg_integer(),
    next_queue         := [plan()],
    source             := binary(),
    created_at         := integer(),
    status             := status(),
    tags               := [binary()],
    started_at         => integer(),
    completed_at       => integer(),
    cancelled_at       => integer()
}.

-type plan_options() :: #{
    chunk_size_minutes => non_neg_integer(),
    break_minutes      => non_neg_integer(),
    include_breaks     => boolean(),
    created_at         => integer(),
    source             => binary(),
    next_queue         => [plan()],
    title              => binary(),
    goal               => binary(),
    duration_minutes   => non_neg_integer(),
    tags               => [binary()]
}.

-type export_format()  :: json | markdown | text.
-type export_options() :: #{
    format           => export_format(),
    include_tasks    => boolean(),
    include_metadata => boolean()
}.

-type create_result()    :: {ok, plan()} | {error, term()}.
-type lifecycle_result() :: {ok, plan()} | {error, {invalid_transition, status(), status()}}.
-type priority()         :: integer().

%%%===================================================================
%%% ETS queue initialisation
%%%===================================================================

-spec init_queue() -> ok | {error, term()}.
init_queue() ->
    try
        ensure_queue_table(),
        ok
    catch
        C:R:_ -> {error, {C, R}}
    end.

-spec ensure_queue_table() -> ok.
ensure_queue_table() ->
    case ets:whereis(?QUEUE_TABLE) of
        undefined ->
            _ = ets:new(?QUEUE_TABLE, [
                named_table, public, ordered_set,
                {read_concurrency,  true},
                {write_concurrency, true}
            ]),
            ok;
        _ ->
            ok
    end.

%%%===================================================================
%%% Parsing & creation
%%%===================================================================

-spec parse_plan(Args :: string() | binary()) -> parsed_plan().
parse_plan(Args) ->
    helpy_plan_parser:parse(Args).

-spec create_plan_safe(Args, Options) -> create_result()
    when Args     :: string() | binary(),
         Options :: plan_options().
create_plan_safe(Args, Options) ->
    try
        maybe
            Parsed = parse_plan(Args),
            Merged = maps:merge(Parsed, Options),
            ok ?= helpy_plan_validator:validate_plan(Merged),
            {ok, build_plan(Merged)}
        end
    catch
        C:R -> {error, {C, R}}
    end.

-spec create_plan(Args, Options) -> plan()
    when Args     :: string() | binary(),
         Options :: plan_options().
create_plan(Args, Options) ->
    build_plan(maps:merge(parse_plan(Args), Options)).

-spec build_plan(map()) -> plan().
build_plan(Merged) ->
    #{
        title              := Title,
        goal               := Goal,
        duration_minutes   := Dur,
        chunk_size_minutes := Chunk,
        break_minutes      := Break,
        include_breaks     := InclBrk,
        next_queue         := NextQueue,
        source             := Source,
        created_at         := CreatedAt,
        tags               := Tags
    } = maps:merge(plan_defaults(), Merged),
    Tasks = break_down_into_tasks(Title, Goal, Dur, Chunk, Break, InclBrk),
    #{
        id                 => generate_plan_id(),
        title              => Title,
        goal               => Goal,
        duration_minutes   => Dur,
        tasks              => Tasks,
        chunk_size_minutes => Chunk,
        break_minutes      => Break,
        next_queue         => NextQueue,
        source             => Source,
        created_at         => CreatedAt,
        status             => ?STATUS_PENDING,
        tags               => Tags
    }.

-spec plan_defaults() -> map().
plan_defaults() ->
    #{
        chunk_size_minutes => ?DEFAULT_CHUNK_SIZE,
        break_minutes      => ?DEFAULT_BREAK_MINUTES,
        include_breaks     => false,
        created_at         => now_ms(),
        source             => <<"erlang-api">>,
        next_queue         => [],
        title              => <<"Untitled Plan">>,
        goal               => <<>>,
        duration_minutes   => ?DEFAULT_PLAN_DURATION,
        tags               => []
    }.

%%%===================================================================
%%% Task breakdown
%%%===================================================================

%% Backwards-compatible 6-arity wrapper. Title is unused — descriptor
%% text is derived from Goal only.
-spec break_down_into_tasks(Title, Goal, DurationMinutes, ChunkSize,
                            BreakMinutes, IncludeBreaks) -> [task()]
    when Title           :: binary(),
         Goal            :: binary(),
         DurationMinutes :: non_neg_integer(),
         ChunkSize       :: non_neg_integer(),
         BreakMinutes    :: non_neg_integer(),
         IncludeBreaks   :: boolean().
break_down_into_tasks(_Title, Goal, Duration, ChunkSize0, BreakMinutes, IncludeBreaks) ->
    ChunkSize = max(1, ChunkSize0),   %% guard against zero-division loop
    Seed      = integer_to_binary(erlang:unique_integer([positive, monotonic])),
    build_tasks(Goal, Duration, ChunkSize, BreakMinutes, IncludeBreaks, Seed, 0, []).

-spec build_tasks(Goal, Remaining, ChunkSize, BreakMinutes, IncludeBreaks,
                  Seed, Idx, Acc) -> [task()]
    when Goal          :: binary(),
         Remaining     :: non_neg_integer(),
         ChunkSize     :: pos_integer(),
         BreakMinutes  :: non_neg_integer(),
         IncludeBreaks :: boolean(),
         Seed          :: binary(),
         Idx           :: non_neg_integer(),
         Acc           :: [task()].
build_tasks(_Goal, Remaining, _ChunkSize, _Break, _Include, _Seed, _Idx, Acc)
    when Remaining =< 0 ->
    lists:reverse(Acc);
build_tasks(Goal, Remaining, ChunkSize, BreakMinutes, IncludeBreaks, Seed, Idx, Acc) ->
    ChunkDur  = min(ChunkSize, Remaining),
    FocusTask = make_focus_task(Goal, Seed, Idx, ChunkDur),
    NewRem    = Remaining - ChunkDur,
    case IncludeBreaks andalso NewRem > 0 of
        true ->
            BreakDur  = min(BreakMinutes, NewRem),
            BreakTask = make_break_task(Seed, Idx, BreakDur),
            build_tasks(Goal, NewRem - BreakDur, ChunkSize, BreakMinutes,
                        IncludeBreaks, Seed, Idx + 1, [BreakTask, FocusTask | Acc]);
        false ->
            build_tasks(Goal, NewRem, ChunkSize, BreakMinutes,
                        IncludeBreaks, Seed, Idx + 1, [FocusTask | Acc])
    end.

-spec make_focus_task(binary(), binary(), non_neg_integer(), non_neg_integer()) -> task().
make_focus_task(Goal, Seed, Idx, Duration) ->
    Descriptor = descriptor_for(Idx),
    IdxBin     = integer_to_binary(Idx),
    Title = case Goal of
        <<>> -> <<Descriptor/binary, " - Part ", IdxBin/binary>>;
        _    -> <<Descriptor/binary, ": ", Goal/binary>>
    end,
    #{
        id               => <<"task-", Seed/binary, "-", IdxBin/binary>>,
        title            => Title,
        duration_minutes => Duration,
        completed        => false,
        completed_at     => undefined,
        is_break         => false
    }.

-spec make_break_task(binary(), non_neg_integer(), non_neg_integer()) -> task().
make_break_task(Seed, Idx, Duration) ->
    IdxBin = integer_to_binary(Idx),
    #{
        id               => <<"task-", Seed/binary, "-break-", IdxBin/binary>>,
        title            => <<"Break">>,
        duration_minutes => Duration,
        completed        => false,
        completed_at     => undefined,
        is_break         => true
    }.

%% Cycles through descriptors for plans with more than 5 tasks.
-spec descriptor_for(non_neg_integer()) -> binary().
descriptor_for(Idx) ->
    element((Idx rem ?DESCRIPTOR_COUNT) + 1, ?DESCRIPTORS).

%%%===================================================================
%%% ID & timestamp helpers
%%%===================================================================

-spec generate_plan_id() -> binary().
generate_plan_id() ->
    Ts = integer_to_binary(now_ms()),
    Rn = binary:encode16(crypto:strong_rand_bytes(4)),
    <<"plan-", Ts/binary, "-", Rn/binary>>.

-spec now_ms() -> integer().
now_ms() ->
    erlang:system_time(millisecond).

%%%===================================================================
%%% Lifecycle management
%%%===================================================================

-spec start_plan(plan()) -> lifecycle_result().
start_plan(#{status := ?STATUS_PENDING} = Plan) ->
    {ok, Plan#{status => ?STATUS_IN_PROGRESS, started_at => now_ms()}};
start_plan(#{status := S}) ->
    {error, {invalid_transition, S, ?STATUS_IN_PROGRESS}}.

-spec complete_plan(plan()) -> lifecycle_result().
complete_plan(#{status := ?STATUS_IN_PROGRESS} = Plan) ->
    Now     = now_ms(),
    Updated = [complete_if_pending(T, Now) || T <- maps:get(tasks, Plan, [])],
    {ok, Plan#{status => ?STATUS_COMPLETED, completed_at => Now, tasks => Updated}};
complete_plan(#{status := S}) ->
    {error, {invalid_transition, S, ?STATUS_COMPLETED}}.

%% Only marks incomplete tasks — preserves original completed_at timestamps.
-spec complete_if_pending(task(), integer()) -> task().
complete_if_pending(#{completed := false} = Task, Now) ->
    Task#{completed => true, completed_at => Now};
complete_if_pending(Task, _Now) ->
    Task.

-spec cancel_plan(plan()) -> lifecycle_result().
cancel_plan(#{status := ?STATUS_COMPLETED}) ->
    {error, {invalid_transition, ?STATUS_COMPLETED, ?STATUS_CANCELLED}};
cancel_plan(#{status := ?STATUS_CANCELLED} = Plan) ->
    {ok, Plan};
cancel_plan(Plan) ->
    {ok, Plan#{status => ?STATUS_CANCELLED, cancelled_at => now_ms()}}.

-spec complete_task(plan(), binary()) -> {ok, plan()} | {error, not_found}.
complete_task(Plan, TaskId) ->
    Now   = now_ms(),
    Tasks = maps:get(tasks, Plan, []),
    case mark_task(Tasks, TaskId, Now, []) of
        {ok, NewTasks} -> {ok, Plan#{tasks => NewTasks}};
        not_found      -> {error, not_found}
    end.

%% Tail-recursive, short-circuits on first match.
-spec mark_task([task()], binary(), integer(), [task()]) ->
        {ok, [task()]} | not_found.
mark_task([], _TaskId, _Now, _Acc) ->
    not_found;
mark_task([#{id := TaskId} = T | Rest], TaskId, Now, Acc) ->
    {ok, lists:reverse(Acc, [mark_completed(T, Now) | Rest])};
mark_task([T | Rest], TaskId, Now, Acc) ->
    mark_task(Rest, TaskId, Now, [T | Acc]).

-spec mark_completed(task(), integer()) -> task().
mark_completed(Task, Now) ->
    Task#{completed => true, completed_at => Now}.

%%%===================================================================
%%% Session statistics (single-pass fold)
%%%===================================================================

-spec calculate_session_stats(plan()) -> map().
calculate_session_stats(Plan) ->
    Tasks = maps:get(tasks, Plan, []),
    {Total, Done, Focus, Breaks} = lists:foldl(fun stats_fold/2, {0, 0, 0, 0}, Tasks),
    Pending = Total - Done,
    Pct = case Total of
        0 -> 0;
        _ -> round((Done / Total) * 100)
    end,
    #{
        total_focus_minutes        => Focus,
        total_break_minutes        => Breaks,
        total_tasks                => Total,
        tasks_completed            => Done,
        tasks_remaining            => Pending,
        completion_percentage      => Pct,
        estimated_duration_minutes => maps:get(duration_minutes, Plan, 0)
    }.

-spec stats_fold(task(), {Total, Done, Focus, Breaks}) ->
        {Total, Done, Focus, Breaks}
    when Total  :: non_neg_integer(),
         Done   :: non_neg_integer(),
         Focus  :: non_neg_integer(),
         Breaks :: non_neg_integer().
stats_fold(#{duration_minutes := Dur, is_break := IsBreak, completed := IsDone},
           {Total, Done, Focus, Breaks}) ->
    Done1 = Done + case IsDone of true -> 1; false -> 0 end,
    case IsBreak of
        true  -> {Total + 1, Done1, Focus, Breaks + Dur};
        false -> {Total + 1, Done1, Focus + Dur, Breaks}
    end.

%%%===================================================================
%%% Export
%%%===================================================================

-spec export_plan(plan(), export_options()) -> binary().
export_plan(Plan, Options) ->
    Format          = maps:get(format,           Options, json),
    IncludeTasks    = maps:get(include_tasks,    Options, true),
    IncludeMetadata = maps:get(include_metadata, Options, true),
    case Format of
        json     -> export_json(filter_plan(Plan, IncludeTasks, IncludeMetadata));
        markdown -> export_textual(Plan, IncludeTasks, markdown);
        text     -> export_textual(Plan, IncludeTasks, text)
    end.

-spec filter_plan(plan(), boolean(), boolean()) -> map().
filter_plan(Plan, IncludeTasks, IncludeMetadata) ->
    Optional = [{tasks,       IncludeTasks},
                {created_at,  IncludeMetadata},
                {source,      IncludeMetadata},
                {next_queue,  IncludeMetadata}],
    Drops = [K || {K, false} <- Optional],
    maps:without(Drops, Plan).

-spec export_json(map()) -> binary().
export_json(Plan) ->
    jsx:encode(jsonify(Plan)).

-spec jsonify(term()) -> term().
jsonify(undefined) -> null;
jsonify(Map) when is_map(Map) ->
    maps:map(fun(_, V) -> jsonify(V) end, Map);
jsonify(List) when is_list(List) ->
    [jsonify(X) || X <- List];
jsonify(X) -> X.

-spec export_textual(plan(), boolean(), export_format()) -> binary().
export_textual(Plan, IncludeTasks, Fmt) ->
    {Title, Goal, Duration, Tasks} = export_parts(Plan),
    GoalPart  = case Goal of
        <<>> -> [];
        _    -> [fmt_goal_prefix(Fmt), Goal, fmt_goal_suffix(Fmt)]
    end,
    TasksPart = case IncludeTasks andalso Tasks =/= [] of
        true  -> [fmt_tasks_header(Fmt), [format_task(T, Fmt) || T <- Tasks]];
        false -> []
    end,
    iolist_to_binary([
        fmt_header(Fmt), Title, fmt_title_suffix(Fmt),
        GoalPart,
        fmt_duration_prefix(Fmt), integer_to_binary(Duration), fmt_duration_suffix(Fmt),
        TasksPart
    ]).

-spec export_parts(plan()) -> {binary(), binary(), non_neg_integer(), [task()]}.
export_parts(Plan) ->
    {
        maps:get(title,            Plan, <<>>),
        maps:get(goal,             Plan, <<>>),
        maps:get(duration_minutes, Plan, 0),
        maps:get(tasks,            Plan, [])
    }.

-spec fmt_header(export_format()) -> binary().
fmt_header(markdown) -> <<"# ">>;
fmt_header(text)     -> <<>>.

-spec fmt_title_suffix(export_format()) -> binary().
fmt_title_suffix(markdown) -> <<"\n\n">>;
fmt_title_suffix(text)     -> <<"\n">>.

-spec fmt_goal_prefix(export_format()) -> binary().
fmt_goal_prefix(markdown) -> <<"## Goal\n">>;
fmt_goal_prefix(text)     -> <<"\nGoal: ">>.

-spec fmt_goal_suffix(export_format()) -> binary().
fmt_goal_suffix(markdown) -> <<"\n\n">>;
fmt_goal_suffix(text)     -> <<"\n">>.

-spec fmt_duration_prefix(export_format()) -> binary().
fmt_duration_prefix(markdown) -> <<"## Duration\n">>;
fmt_duration_prefix(text)     -> <<"\nDuration: ">>.

-spec fmt_duration_suffix(export_format()) -> binary().
fmt_duration_suffix(markdown) -> <<" minutes\n\n">>;
fmt_duration_suffix(text)     -> <<" minutes\n">>.

-spec fmt_tasks_header(export_format()) -> binary().
fmt_tasks_header(markdown) -> <<"## Tasks\n\n">>;
fmt_tasks_header(text)     -> <<"\nTasks:\n">>.

-spec format_task(task(), export_format()) -> iolist().
format_task(Task, Fmt) ->
    Mark  = task_marker(maps:get(completed, Task, false), Fmt),
    Title = maps:get(title, Task, <<>>),
    Dur   = integer_to_binary(maps:get(duration_minutes, Task, 0)),
    [Mark, Title, <<" (">>, Dur, <<" min)\n">>].

-spec task_marker(boolean(), export_format()) -> binary().
task_marker(true,  markdown) -> <<"- [x] ">>;
task_marker(false, markdown) -> <<"- [ ] ">>;
task_marker(true,  _)        -> <<"[x] ">>;
task_marker(false, _)        -> <<"[ ] ">>.

%%%===================================================================
%%% Priority queue (ETS ordered_set)
%%%
%%% Keys are {-Priority, Timestamp, PlanId} so that:
%%%   • Higher priority is dequeued first (negated → sorts earlier)
%%%   • Within the same priority, oldest entry is dequeued first (FIFO)
%%%===================================================================

-spec enqueue_plan(plan(), priority()) -> ok.
enqueue_plan(Plan, Priority) ->
    Ts  = now_ms(),
    Key = {-Priority, Ts, maps:get(id, Plan)},
    true = ets:insert(?QUEUE_TABLE, {Key, Plan}),
    ok.

-spec dequeue_plan() -> {ok, plan()} | {error, empty}.
dequeue_plan() ->
    dequeue_plan(?DEQUEUE_MAX_RETRIES).

-spec dequeue_plan(non_neg_integer()) -> {ok, plan()} | {error, empty}.
dequeue_plan(0) ->
    {error, empty};
dequeue_plan(N) when N > 0 ->
    case ets:first(?QUEUE_TABLE) of
        '$end_of_table' ->
            {error, empty};
        Key ->
            case ets:take(?QUEUE_TABLE, Key) of
                [{Key, Plan}] -> {ok, Plan};
                []            -> dequeue_plan(N - 1)
            end
    end.

-spec peek_plan() -> {ok, plan()} | {error, empty}.
peek_plan() ->
    case ets:first(?QUEUE_TABLE) of
        '$end_of_table' ->
            {error, empty};
        Key ->
            [{Key, Plan}] = ets:lookup(?QUEUE_TABLE, Key),
            {ok, Plan}
    end.

-spec list_queue() -> [plan()].
list_queue() ->
    ets:select(?QUEUE_TABLE, [{{'_', '$1'}, [], ['$1']}]).

-spec queue_size() -> non_neg_integer().
queue_size() ->
    ets:info(?QUEUE_TABLE, size).

-spec clear_queue() -> ok.
clear_queue() ->
    true = ets:delete_all_objects(?QUEUE_TABLE),
    ok.

%%%===================================================================
%%% Smart recommendation (table-driven)
%%%===================================================================

-spec generate_smart_recommendation(integer(), integer(), integer()) -> map().
generate_smart_recommendation(TotalAvailableMinutes, WorkIntensity, UserEnergyLevel) ->
    Energy    = clamp(1, 100, UserEnergyLevel),
    Intensity = clamp(1, 100, WorkIntensity),
    Minutes   = max(?MIN_SESSION_MINUTES, TotalAvailableMinutes),

    {OptimalWork, Recommendation} = pick_band(Energy, Intensity),

    AdjustedWork = adjust_for_available(OptimalWork, Minutes),
    Break        = calculate_break_duration(AdjustedWork),
    Gain         = calculate_productivity_gain(Intensity, Energy),

    #{
        optimal_work_minutes        => AdjustedWork,
        optimal_break_minutes       => Break,
        estimated_productivity_gain => Gain,
        recommendation              => Recommendation
    }.

-spec pick_band(non_neg_integer(), non_neg_integer()) ->
        {non_neg_integer(), binary()}.
pick_band(Energy, Intensity) ->
    Pred = fun({MinE, MinI, _W, _M}) ->
        Energy >= MinE andalso Intensity >= MinI
    end,
    case lists:search(Pred, ?WORK_BANDS) of
        {value, {_E, _I, W, M}} -> {W, M};
        false                   -> {?FALLBACK_WORK, ?FALLBACK_MSG}
    end.

-spec adjust_for_available(non_neg_integer(), non_neg_integer()) -> non_neg_integer().
adjust_for_available(Optimal, Avail) ->
    case lists:search(fun({Threshold, _Cap}) -> Avail < Threshold end,
                      ?AVAILABILITY_BANDS) of
        {value, {_, Cap}} -> min(Optimal, Cap);
        false             -> Optimal
    end.

-spec calculate_break_duration(non_neg_integer()) -> non_neg_integer().
calculate_break_duration(WorkDuration) ->
    max(?MIN_BREAK_MINUTES, min(?MAX_BREAK_MINUTES, WorkDuration div ?BREAK_DIVISOR)).

-spec calculate_productivity_gain(non_neg_integer(), non_neg_integer()) -> non_neg_integer().
calculate_productivity_gain(Intensity, Energy) ->
    min(?MAX_PRODUCTIVITY_GAIN,
        ?BASE_PRODUCTIVITY_GAIN + (Intensity div 10) + (Energy div 20)).

-spec clamp(integer(), integer(), integer()) -> integer().
clamp(Lo, Hi, X) ->
    max(Lo, min(Hi, X)).