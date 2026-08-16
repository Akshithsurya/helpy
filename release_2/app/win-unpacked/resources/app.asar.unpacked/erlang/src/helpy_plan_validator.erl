-module(helpy_plan_validator).

-export([
    validate_plan/1,
    validate_duration/1,
    validate_chunk_size/1,
    validate_break_minutes/1,
    validate_title/1,
    validate_goal/1,
    validate_tags/1
]).

-export_type([validation_result/0, plan_result/0, plan_map/0]).

-on_load(init/0).

%% Limits
-define(MIN_PLAN_DURATION, 5).
-define(MAX_PLAN_DURATION, 240).
-define(MIN_CHUNK_SIZE, 5).
-define(MAX_CHUNK_SIZE, 120).
-define(MIN_BREAK_MINUTES, 1).
-define(MAX_BREAK_MINUTES, 30).
-define(MAX_TITLE_LENGTH, 200).
-define(MAX_GOAL_LENGTH, 1000).
-define(MAX_TAGS, 20).
-define(MAX_TAG_LENGTH, 100).

%% Types
-type validation_result() :: ok | {error, binary()}.
-type plan_result() :: ok | {error, [binary()]}.
-type plan_map() :: #{
    title              => binary(),
    goal               => binary(),
    duration_minutes   => integer(),
    chunk_size_minutes => integer(),
    break_minutes      => integer(),
    tags               => [binary()]
}.

%%%===================================================================
%%% On-load initialisation (regex precompilation cache)
%%%===================================================================

-spec init() -> ok.
init() ->
    try
        case ets:whereis(helpy_regex_cache) of
            undefined ->
                _ = ets:new(helpy_regex_cache, [
                    named_table, public, set,
                    {read_concurrency, true}
                ]),
                ok;
            _ ->
                ok
        end,
        lists:foreach(fun({Name, Pat}) ->
            case re:compile(Pat) of
                {ok, MP} -> ets:insert(helpy_regex_cache, {Name, MP});
                _        -> ok
            end
        end, [
            {goal_re,  "^[A-Za-z0-9 ,.?!'\"-]{1,500}$"},
            {title_re, "^[A-Za-z0-9 ,.?!'\"-]{1,100}$"},
            {tag_re,   "^[A-Za-z0-9_-]{1,40}$"}
        ]),
        ok
    catch
        _C:_R -> ok
    end.

-spec cached_re_match(binary(), atom(), string()) -> match | nomatch.
cached_re_match(Str, CacheName, FallbackPat) ->
    StrList = binary_to_list(Str),
    case ets:lookup(helpy_regex_cache, CacheName) of
        [{_, MP}] ->
            case re:run(StrList, MP, [{capture, none}]) of
                match   -> match;
                nomatch -> nomatch
            end;
        [] ->
            case re:run(StrList, FallbackPat, [{capture, none}]) of
                match   -> match;
                nomatch -> nomatch
            end
    end.

-define(ERR_MAX_TAGS, <<"Cannot have more than 20 tags">>).
-define(ERR_TAG_TOO_LONG, <<"Tag cannot exceed 100 characters">>).

%%%===================================================================
%%% Public API
%%%===================================================================

-spec validate_plan(PlanMap :: plan_map() | map()) -> plan_result().
validate_plan(PlanMap) when is_map(PlanMap) ->
    Checks = [
        fun() -> validate_title(maps:get(title, PlanMap, undefined)) end,
        fun() -> validate_goal(maps:get(goal, PlanMap, undefined)) end,
        fun() -> validate_duration(maps:get(duration_minutes, PlanMap, undefined)) end,
        fun() -> validate_chunk_size(maps:get(chunk_size_minutes, PlanMap, undefined)) end,
        fun() -> validate_break_minutes(maps:get(break_minutes, PlanMap, undefined)) end,
        fun() -> validate_tags(maps:get(tags, PlanMap, [])) end,
        fun() -> validate_chunk_vs_duration(PlanMap) end,
        fun() -> validate_break_vs_chunk(PlanMap) end
    ],
    Errors = collect_errors(Checks),
    case Errors of
        [] -> ok;
        _  -> {error, Errors}
    end;
validate_plan(_) ->
    {error, [<<"Plan must be a map">>]}.

-spec validate_title(Title :: any()) -> validation_result().
validate_title(undefined) ->
    {error, <<"Title is required">>};
validate_title(Title) when is_binary(Title) ->
    case validate_text(Title, ?MAX_TITLE_LENGTH, <<"Title">>) of
        ok ->
            case cached_re_match(Title, title_re, "^[A-Za-z0-9 ,.?!'\"-]{1,100}$") of
                match   -> ok;
                nomatch -> {error, <<"Title contains invalid characters; only letters, digits, spaces and ,.?!'\"- are allowed">>}
            end;
        Error -> Error
    end;
validate_title(_) ->
    {error, <<"Title must be a binary string">>}.

-spec validate_goal(Goal :: any()) -> validation_result().
validate_goal(undefined) ->
    {error, <<"Goal is required">>};
validate_goal(Goal) when is_binary(Goal) ->
    case validate_text(Goal, ?MAX_GOAL_LENGTH, <<"Goal">>) of
        ok ->
            case cached_re_match(Goal, goal_re, "^[A-Za-z0-9 ,.?!'\"-]{1,500}$") of
                match   -> ok;
                nomatch -> {error, <<"Goal contains invalid characters; only letters, digits, spaces and ,.?!'\"- are allowed">>}
            end;
        Error -> Error
    end;
validate_goal(_) ->
    {error, <<"Goal must be a binary string">>}.

-spec validate_duration(Duration :: any()) -> validation_result().
validate_duration(undefined) ->
    {error, <<"Duration is required">>};
validate_duration(Duration) when is_integer(Duration) ->
    validate_range(Duration, ?MIN_PLAN_DURATION, ?MAX_PLAN_DURATION,
                   <<"Duration">>, <<"minutes">>);
validate_duration(_) ->
    {error, <<"Duration must be an integer">>}.

-spec validate_chunk_size(ChunkSize :: any()) -> validation_result().
validate_chunk_size(undefined) ->
    {error, <<"Chunk size is required">>};
validate_chunk_size(ChunkSize) when is_integer(ChunkSize) ->
    validate_range(ChunkSize, ?MIN_CHUNK_SIZE, ?MAX_CHUNK_SIZE,
                   <<"Chunk size">>, <<"minutes">>);
validate_chunk_size(_) ->
    {error, <<"Chunk size must be an integer">>}.

-spec validate_break_minutes(BreakMinutes :: any()) -> validation_result().
validate_break_minutes(undefined) ->
    {error, <<"Break minutes is required">>};
validate_break_minutes(BreakMinutes) when is_integer(BreakMinutes) ->
    validate_range(BreakMinutes, ?MIN_BREAK_MINUTES, ?MAX_BREAK_MINUTES,
                   <<"Break">>, <<"minutes">>);
validate_break_minutes(_) ->
    {error, <<"Break minutes must be an integer">>}.

-spec validate_tags(Tags :: any()) -> validation_result().
validate_tags(Tags) when is_list(Tags) ->
    validate_tags_list(Tags, 0);
validate_tags(_) ->
    {error, <<"Tags must be a list">>}.

%%%===================================================================
%%% Cross-field validations
%%%===================================================================

-spec validate_chunk_vs_duration(PlanMap :: map()) -> validation_result().
validate_chunk_vs_duration(#{chunk_size_minutes := Chunk, duration_minutes := Dur})
        when is_integer(Chunk), is_integer(Dur), Chunk > Dur ->
    err(<<"Chunk size (~b min) cannot exceed total duration (~b min)">>, [Chunk, Dur]);
validate_chunk_vs_duration(_) ->
    ok.

-spec validate_break_vs_chunk(PlanMap :: map()) -> validation_result().
validate_break_vs_chunk(#{break_minutes := Break, chunk_size_minutes := Chunk})
        when is_integer(Break), is_integer(Chunk), Break >= Chunk ->
    err(<<"Break (~b min) must be shorter than chunk size (~b min)">>, [Break, Chunk]);
validate_break_vs_chunk(_) ->
    ok.

%%%===================================================================
%%% Internal helpers
%%%===================================================================

-spec collect_errors([fun(() -> validation_result())]) -> [binary()].
collect_errors(Checks) ->
    lists:flatmap(
        fun(Check) ->
            case Check() of
                ok              -> [];
                {error, Binary} -> [Binary]
            end
        end,
        Checks
    ).

-spec validate_tags_list([any()], non_neg_integer()) -> validation_result().
validate_tags_list([], _Count) ->
    ok;
validate_tags_list([Tag | Rest], Count) when Count < ?MAX_TAGS ->
    case validate_tag(Tag) of
        ok    -> validate_tags_list(Rest, Count + 1);
        Error -> Error
    end;
validate_tags_list(_Tags, _Count) ->
    {error, ?ERR_MAX_TAGS}.

-spec validate_tag(any()) -> validation_result().
validate_tag(Tag) when is_binary(Tag) ->
    case string:trim(Tag) of
        <<>> ->
            {error, <<"Each tag must be a non-empty binary string">>};
        _ ->
            case byte_size(Tag) > ?MAX_TAG_LENGTH of
                true ->
                    {error, ?ERR_TAG_TOO_LONG};
                false ->
                    case cached_re_match(Tag, tag_re, "^[A-Za-z0-9_-]{1,40}$") of
                        match   -> ok;
                        nomatch -> {error, <<"Tag contains invalid characters; only letters, digits, underscores and hyphens are allowed">>}
                    end
            end
    end;
validate_tag(_) ->
    {error, <<"Each tag must be a non-empty binary string">>}.

-spec validate_text(binary(), pos_integer(), binary()) -> validation_result().
validate_text(Binary, MaxLen, Label) when is_binary(Binary) ->
    case string:trim(Binary) of
        <<>> ->
            err(<<"~ts cannot be empty">>, [Label]);
        _ ->
            case byte_size(Binary) of
                Len when Len > MaxLen ->
                    err(<<"~ts cannot exceed ~b characters">>, [Label, MaxLen]);
                _ ->
                    ok
            end
    end.

-spec validate_range(integer(), integer(), integer(), binary(), binary()) -> validation_result().
validate_range(Value, Min, Max, Label, Unit) when is_integer(Value), is_integer(Min), is_integer(Max) ->
    cond
        Value < Min -> err(<<"~ts must be at least ~b ~ts">>, [Label, Min, Unit]);
        Value > Max -> err(<<"~ts cannot exceed ~b ~ts">>, [Label, Max, Unit]);
        true        -> ok
    end.

-spec err(binary(), [term()]) -> {error, binary()}.
err(Fmt, Args) ->
    {error, iolist_to_binary(io_lib:format(Fmt, Args))}.
