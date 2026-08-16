-module(helpy_plan_nif).

-moduledoc """
NIF bindings for plan parsing, statistics, and recommendation generation.

Falls back to pure Erlang implementations when the native library is
unavailable. Use `nif_loaded/0` to check at runtime.
""".

-export([
    init/0,
    nif_loaded/0,
    parse_plan/1,
    calculate_stats/1,
    generate_recommendation/3
]).

-export_type([plan/0, stats/0, recommendation/0, intensity/0]).

-on_load(init/0).

-nifs([
    parse_plan/1,
    calculate_stats/1,
    generate_recommendation/3
]).

-define(APP, helpy_plan).
-define(NIF_LIB, "helpy_plan_nif").
-define(LOADED_KEY, ?MODULE).

%% Field names
-define(F_TITLE,           <<"title">>).
-define(F_DURATION,        <<"duration_minutes">>).
-define(F_STATUS,          <<"status">>).
-define(F_TOTAL,           <<"total_plans">>).
-define(F_COMPLETED,       <<"completed_plans">>).
-define(F_COMPLETION_RATE, <<"completion_rate">>).
-define(F_AVG_DURATION,    <<"avg_duration_minutes">>).
-define(F_OPTIMAL_WORK,    <<"optimal_work_minutes">>).
-define(F_OPTIMAL_BREAK,   <<"optimal_break_minutes">>).
-define(F_RECOMMENDATION,  <<"recommendation">>).

%% Default / sentinel values
-define(DEFAULT_TITLE,    <<"Fallback Parsed Plan">>).
-define(DEFAULT_DURATION, 30).
-define(DEFAULT_STATUS,   <<"pending">>).
-define(STATUS_COMPLETED, <<"completed">>).

%%------------------------------------------------------------------------------
%% Types
%%------------------------------------------------------------------------------

-type intensity() :: low | medium | high.

-type plan() :: #{
    ?F_TITLE    := binary(),
    ?F_DURATION := integer(),
    ?F_STATUS   := binary()
}.

-type stats() :: #{
    ?F_TOTAL           := non_neg_integer(),
    ?F_COMPLETED       := non_neg_integer(),
    ?F_COMPLETION_RATE := float(),
    ?F_AVG_DURATION    := float()
}.

-type recommendation() :: #{
    ?F_OPTIMAL_WORK   := non_neg_integer(),
    ?F_OPTIMAL_BREAK  := non_neg_integer(),
    ?F_RECOMMENDATION := binary()
}.

%%------------------------------------------------------------------------------
%% Initialization
%%------------------------------------------------------------------------------

-doc """
Loads the NIF library.

Invoked automatically via `-on_load`. Always returns `ok`; callers should
use `nif_loaded/0` to determine whether the NIF is active.
""".
-spec init() -> ok.
init() ->
    Loaded = case erlang:load_nif(nif_library_path(), 0) of
        ok                    -> true;
        {error, {reload, _}}  -> true;
        {error, {upgrade, _}} -> true;
        {error, not_present} ->
            logger:warning("NIF ~s not found; using Erlang fallbacks", [?NIF_LIB]),
            false;
        {error, {load_failed, Reason}} ->
            logger:error("NIF ~s load failed: ~0p", [?NIF_LIB, Reason]),
            false;
        {error, Reason} ->
            logger:error("NIF ~s unexpected load error: ~0p", [?NIF_LIB, Reason]),
            false
    end,
    persistent_term:put(?LOADED_KEY, Loaded),
    ok.

-spec nif_library_path() -> file:filename().
nif_library_path() ->
    PrivDir = case code:priv_dir(?APP) of
        {error, _} -> "priv";
        Priv       -> Priv
    end,
    filename:join(PrivDir, ?NIF_LIB).

-doc "Returns `true` if the NIF library loaded successfully.".
-spec nif_loaded() -> boolean().
nif_loaded() ->
    persistent_term:get(?LOADED_KEY, false).

%%------------------------------------------------------------------------------
%% NIF functions (Erlang fallbacks; replaced on NIF load)
%%------------------------------------------------------------------------------

-doc """
Parses raw input into a JSON-encoded plan object.

Accepts either a JSON binary or a map. Missing fields are filled with
sensible defaults.
""".
-spec parse_plan(Input :: binary() | map()) -> binary().
parse_plan(Input) ->
    jsx:encode(parse_plan_fallback(Input)).

-spec parse_plan_fallback(binary() | map()) -> plan().
parse_plan_fallback(Input) when is_map(Input) ->
    #{
        ?F_TITLE    => maps:get(?F_TITLE, Input, ?DEFAULT_TITLE),
        ?F_DURATION => maps:get(?F_DURATION, Input, ?DEFAULT_DURATION),
        ?F_STATUS   => maps:get(?F_STATUS, Input, ?DEFAULT_STATUS)
    };
parse_plan_fallback(Input) when is_binary(Input) ->
    case decode_json(Input) of
        M when is_map(M) -> parse_plan_fallback(M);
        _                -> default_plan()
    end;
parse_plan_fallback(_) ->
    default_plan().

-spec default_plan() -> plan().
default_plan() ->
    #{
        ?F_TITLE    => ?DEFAULT_TITLE,
        ?F_DURATION => ?DEFAULT_DURATION,
        ?F_STATUS   => ?DEFAULT_STATUS
    }.

%%------------------------------------------------------------------------------

-doc """
Calculates aggregate statistics across a list of plans.

Accepts a list of JSON-encoded plan binaries or maps.
""".
-spec calculate_stats(Plans :: [binary() | map()]) -> binary().
calculate_stats(Plans) ->
    jsx:encode(calculate_stats_fallback(Plans)).

-spec calculate_stats_fallback([binary() | map()]) -> stats().
calculate_stats_fallback([]) ->
    #{
        ?F_TOTAL           => 0,
        ?F_COMPLETED       => 0,
        ?F_COMPLETION_RATE => 0.0,
        ?F_AVG_DURATION    => 0.0
    };
calculate_stats_fallback(Plans) when is_list(Plans) ->
    Decoded   = [decode_plan(P) || P <- Plans],
    Total     = length(Decoded),
    Durations = [get_duration(P) || P <- Decoded],
    Completed = length([P || P <- Decoded, is_completed(P)]),
    #{
        ?F_TOTAL           => Total,
        ?F_COMPLETED       => Completed,
        ?F_COMPLETION_RATE => Completed / Total,
        ?F_AVG_DURATION    => lists:sum(Durations) / Total
    }.

-spec decode_plan(binary() | map()) -> map().
decode_plan(P) when is_map(P) -> P;
decode_plan(B) when is_binary(B) ->
    case decode_json(B) of
        M when is_map(M) -> M;
        _                -> #{}
    end.

-spec decode_json(binary()) -> term().
decode_json(B) ->
    try jsx:decode(B, [return_maps])
    catch error:_ -> #{}
    end.

-spec is_completed(map()) -> boolean().
is_completed(P) ->
    maps:get(?F_STATUS, P, ?DEFAULT_STATUS) =:= ?STATUS_COMPLETED.

-spec get_duration(map()) -> number().
get_duration(P) ->
    maps:get(?F_DURATION, P, 0).

%%------------------------------------------------------------------------------

-doc """
Generates a personalized work/break recommendation.

== Parameters ==

- `TotalAvailable` — total minutes available for the session
- `WorkIntensity` — `low`, `medium`, or `high`
- `UserEnergy` — energy level from 0 to 100
""".
-spec generate_recommendation(
    TotalAvailable :: non_neg_integer(),
    WorkIntensity :: intensity(),
    UserEnergy :: 0..100
) -> binary().
generate_recommendation(TotalAvailable, WorkIntensity, UserEnergy) ->
    jsx:encode(generate_recommendation_fallback(TotalAvailable, WorkIntensity, UserEnergy)).

-spec generate_recommendation_fallback(non_neg_integer(), intensity(), 0..100) -> recommendation().
generate_recommendation_fallback(TotalAvailable, WorkIntensity, UserEnergy) ->
    {Work, Break} = pomodoro_intervals(WorkIntensity, UserEnergy),
    #{
        ?F_OPTIMAL_WORK   => Work,
        ?F_OPTIMAL_BREAK  => Break,
        ?F_RECOMMENDATION => recommendation_text(Work, Break, TotalAvailable)
    }.

-spec pomodoro_intervals(intensity(), 0..100) -> {non_neg_integer(), non_neg_integer()}.
pomodoro_intervals(low, Energy)  when Energy < 50 -> {15, 10};
pomodoro_intervals(low, _)                        -> {20, 10};
pomodoro_intervals(medium, _)                     -> {25, 5};
pomodoro_intervals(high, Energy) when Energy < 70 -> {30, 5};
pomodoro_intervals(high, _)                       -> {45, 10}.

-spec recommendation_text(non_neg_integer(), non_neg_integer(), non_neg_integer()) -> binary().
recommendation_text(Work, Break, TotalAvailable) ->
    CycleLen = Work + Break,
    Sessions = case CycleLen of
        0 -> 0;
        _ -> TotalAvailable div CycleLen
    end,
    SessionText = case Sessions of
        1 -> <<"1 full session fits">>;
        N -> <<(integer_to_binary(N))/binary, " full sessions fit">>
    end,
    WorkBin        = integer_to_binary(Work),
    BreakBin       = integer_to_binary(Break),
    TotalAvailBin  = integer_to_binary(TotalAvailable),
    <<WorkBin/binary, " min work / ", BreakBin/binary, " min break — ",
      SessionText/binary, " in ", TotalAvailBin/binary, " min.">>.