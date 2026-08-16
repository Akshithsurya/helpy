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

%% Regex patterns stored as constants for maintainability
-define(TITLE_REGEX, "^[\\p{L}0-9 ,.?!'\"-]{1,200}$").
-define(GOAL_REGEX, "^[\\p{L}0-9 ,.?!'\"-]{1,1000}$").
-define(TAG_REGEX, "^[\\p{L}0-9_-]{1,100}$").

%% Error constants - centralized for consistency
-define(ERR_PLAN_NOT_MAP, <<"Plan must be a map">>).
-define(ERR_TITLE_REQUIRED, <<"Title is required">>).
-define(ERR_TITLE_BINARY, <<"Title must be a binary string">>).
-define(ERR_TITLE_EMPTY, <<"Title cannot be empty">>).
-define(ERR_TITLE_TOO_LONG, <<"Title cannot exceed 200 characters">>).
-define(ERR_TITLE_INVALID_CHARS, <<"Title contains invalid characters; only letters, digits, spaces and ,.?!'\"- are allowed">>).

-define(ERR_GOAL_REQUIRED, <<"Goal is required">>).
-define(ERR_GOAL_BINARY, <<"Goal must be a binary string">>).
-define(ERR_GOAL_EMPTY, <<"Goal cannot be empty">>).
-define(ERR_GOAL_TOO_LONG, <<"Goal cannot exceed 1000 characters">>).
-define(ERR_GOAL_INVALID_CHARS, <<"Goal contains invalid characters; only letters, digits, spaces and ,.?!'\"- are allowed">>).

-define(ERR_DURATION_REQUIRED, <<"Duration is required">>).
-define(ERR_DURATION_INTEGER, <<"Duration must be an integer">>).
-define(ERR_DURATION_MIN, <<"Duration must be at least 5 minutes">>).
-define(ERR_DURATION_MAX, <<"Duration cannot exceed 240 minutes">>).

-define(ERR_CHUNK_REQUIRED, <<"Chunk size is required">>).
-define(ERR_CHUNK_INTEGER, <<"Chunk size must be an integer">>).
-define(ERR_CHUNK_MIN, <<"Chunk size must be at least 5 minutes">>).
-define(ERR_CHUNK_MAX, <<"Chunk size cannot exceed 120 minutes">>).
-define(ERR_CHUNK_EXCEEDS_DURATION, <<"Chunk size cannot exceed total plan duration">>).

-define(ERR_BREAK_REQUIRED, <<"Break minutes is required">>).
-define(ERR_BREAK_INTEGER, <<"Break minutes must be an integer">>).
-define(ERR_BREAK_MIN, <<"Break must be at least 1 minute">>).
-define(ERR_BREAK_MAX, <<"Break cannot exceed 30 minutes">>).
-define(ERR_BREAK_EXCEEDS_CHUNK, <<"Break must be shorter than chunk size">>).

-define(ERR_TAGS_LIST, <<"Tags must be a list">>).
-define(ERR_MAX_TAGS, <<"Cannot have more than 20 tags">>).
-define(ERR_TAG_NON_EMPTY, <<"Each tag must be a non-empty binary string">>).
-define(ERR_TAG_TOO_LONG, <<"Tag cannot exceed 100 characters">>).
-define(ERR_TAG_INVALID_CHARS, <<"Tag contains invalid characters; only letters, digits, underscores and hyphens are allowed">>).

-define(ERR_ETS_INIT_FAILED, <<"Failed to initialize validator cache">>).

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
        ensure_regex_cache_exists(),
        precompile_regex_patterns(),
        ok
    catch
        Type:Reason:Stacktrace ->
            logger:error("Validator init failed: ~p:~p~nStacktrace: ~p", [Type, Reason, Stacktrace]),
            ok
    end.

%% Ensure ETS cache table exists with proper protections
-spec ensure_regex_cache_exists() -> ok.
ensure_regex_cache_exists() ->
    case ets:whereis(helpy_regex_cache) of
        undefined ->
            _ = ets:new(helpy_regex_cache, [
                named_table, public, set,
                {read_concurrency, true},
                {protect, true}
            ]),
            ok;
        _ ->
            ok
    end.

%% Precompile all regex patterns upfront
-spec precompile_regex_patterns() -> ok.
precompile_regex_patterns() ->
    Patterns = [
        {title_re, ?TITLE_REGEX, [unicode]},
        {goal_re, ?GOAL_REGEX, [unicode]},
        {tag_re, ?TAG_REGEX, [unicode]}
    ],
    lists:foreach(fun compile_and_store_regex/1, Patterns).

%% Compile a single regex and store it in the cache if successful
-spec compile_and_store_regex({atom(), string(), list()}) -> ok.
compile_and_store_regex({Name, Pattern, Options}) ->
    case re:compile(Pattern, Options) of
        {ok, MP} -> 
            ets:insert(helpy_regex_cache, {Name, MP});
        {error, Err} ->
            logger:warning("Failed to compile regex ~p: ~p", [Name, Err]),
            ok
    end.

%% Unified regex matching with Unicode support
-spec cached_re_match(binary(), atom(), string(), list()) -> match | nomatch.
cached_re_match(Str, CacheName, FallbackPat, FallbackOpts) ->
    case ets:lookup(helpy_regex_cache, CacheName) of
        [{_, MP}] ->
            case re:run(Str, MP, [{capture, none}]) of
                match   -> match;
                nomatch -> nomatch
            end;
        [] ->
            case re:run(Str, FallbackPat, FallbackOpts ++ [{capture, none}]) of
                match   -> match;
                nomatch -> nomatch
            end
    end.

%%%===================================================================
%%% Public API
%%%===================================================================

-spec validate_plan(PlanMap :: plan_map() | map()) -> plan_result().
validate_plan(PlanMap) when is_map(PlanMap) ->
    Validations = [
        fun() -> validate_title(maps:get(title, PlanMap, undefined)) end,
        fun() -> validate_goal(maps:get(goal, PlanMap, undefined)) end,
        fun() -> validate_duration(maps:get(duration_minutes, PlanMap, undefined)) end,
        fun() -> validate_chunk_size(maps:get(chunk_size_minutes, PlanMap, undefined)) end,
        fun() -> validate_break_minutes(maps:get(break_minutes, PlanMap, undefined)) end,
        fun() -> validate_tags(maps:get(tags, PlanMap, [])) end,
        fun() -> validate_cross_field_constraints(PlanMap) end
    ],
    case collect_errors(Validations) of
        [] -> ok;
        Errors -> {error, Errors}
    end;
validate_plan(_) ->
    {error, [?ERR_PLAN_NOT_MAP]}.

-spec validate_title(Title :: any()) -> validation_result().
validate_title(undefined) -> {error, ?ERR_TITLE_REQUIRED};
validate_title(Title) when not is_binary(Title) -> {error, ?ERR_TITLE_BINARY};
validate_title(Title) ->
    case validate_binary_content(Title, ?MAX_TITLE_LENGTH, <<"Title">>) of
        ok ->
            case cached_re_match(Title, title_re, ?TITLE_REGEX, [unicode]) of
                match -> ok;
                nomatch -> {error, ?ERR_TITLE_INVALID_CHARS}
            end;
        Error -> Error
    end.

-spec validate_goal(Goal :: any()) -> validation_result().
validate_goal(undefined) -> {error, ?ERR_GOAL_REQUIRED};
validate_goal(Goal) when not is_binary(Goal) -> {error, ?ERR_GOAL_BINARY};
validate_goal(Goal) ->
    case validate_binary_content(Goal, ?MAX_GOAL_LENGTH, <<"Goal">>) of
        ok ->
            case cached_re_match(Goal, goal_re, ?GOAL_REGEX, [unicode]) of
                match -> ok;
                nomatch -> {error, ?ERR_GOAL_INVALID_CHARS}
            end;
        Error -> Error
    end.

-spec validate_duration(Duration :: any()) -> validation_result().
validate_duration(undefined) -> {error, ?ERR_DURATION_REQUIRED};
validate_duration(Duration) when not is_integer(Duration) -> {error, ?ERR_DURATION_INTEGER};
validate_duration(Duration) ->
    validate_numeric_range(Duration, ?MIN_PLAN_DURATION, ?MAX_PLAN_DURATION, 
                         ?ERR_DURATION_MIN, ?ERR_DURATION_MAX).

-spec validate_chunk_size(ChunkSize :: any()) -> validation_result().
validate_chunk_size(undefined) -> {error, ?ERR_CHUNK_REQUIRED};
validate_chunk_size(ChunkSize) when not is_integer(ChunkSize) -> {error, ?ERR_CHUNK_INTEGER};
validate_chunk_size(ChunkSize) ->
    validate_numeric_range(ChunkSize, ?MIN_CHUNK_SIZE, ?MAX_CHUNK_SIZE,
                         ?ERR_CHUNK_MIN, ?ERR_CHUNK_MAX).

-spec validate_break_minutes(BreakMinutes :: any()) -> validation_result().
validate_break_minutes(undefined) -> {error, ?ERR_BREAK_REQUIRED};
validate_break_minutes(BreakMinutes) when not is_integer(BreakMinutes) -> {error, ?ERR_BREAK_INTEGER};
validate_break_minutes(BreakMinutes) ->
    validate_numeric_range(BreakMinutes, ?MIN_BREAK_MINUTES, ?MAX_BREAK_MINUTES,
                          ?ERR_BREAK_MIN, ?ERR_BREAK_MAX).

-spec validate_tags(Tags :: any()) -> validation_result().
validate_tags(Tags) when not is_list(Tags) -> {error, ?ERR_TAGS_LIST};
validate_tags(Tags) -> validate_tag_list(Tags, 0).

%%%===================================================================
%%% Cross-field validations
%%%===================================================================

-spec validate_cross_field_constraints(map()) -> validation_result().
validate_cross_field_constraints(#{chunk_size_minutes := Chunk, duration_minutes := Dur}) 
  when is_integer(Chunk), is_integer(Dur), Chunk > Dur ->
    {error, ?ERR_CHUNK_EXCEEDS_DURATION};
validate_cross_field_constraints(#{break_minutes := Break, chunk_size_minutes := Chunk})
  when is_integer(Break), is_integer(Chunk), Break >= Chunk ->
    {error, ?ERR_BREAK_EXCEEDS_CHUNK};
validate_cross_field_constraints(_) ->
    ok.

%%%===================================================================
%%% Internal helpers
%%%===================================================================

-spec collect_errors([fun(() -> validation_result())]) -> [binary()].
collect_errors(Validations) ->
    lists:filtermap(
        fun(Validation) ->
            case Validation() of
                ok -> false;
                {error, Err} -> {true, Err}
            end
        end, Validations).

-spec validate_tag_list([any()], non_neg_integer()) -> validation_result().
validate_tag_list([], _) -> ok;
validate_tag_list(_Tags, Count) when Count >= ?MAX_TAGS -> {error, ?ERR_MAX_TAGS};
validate_tag_list([Tag | Rest], Count) ->
    case validate_single_tag(Tag) of
        ok -> validate_tag_list(Rest, Count + 1);
        Error -> Error
    end.

-spec validate_single_tag(any()) -> validation_result().
validate_single_tag(Tag) when not is_binary(Tag) -> {error, ?ERR_TAG_NON_EMPTY};
validate_single_tag(Tag) ->
    case string:trim(Tag) of
        <<>> -> {error, ?ERR_TAG_NON_EMPTY};
        _ ->
            if
                byte_size(Tag) > ?MAX_TAG_LENGTH -> {error, ?ERR_TAG_TOO_LONG};
                true ->
                    case cached_re_match(Tag, tag_re, ?TAG_REGEX, [unicode]) of
                        match -> ok;
                        nomatch -> {error, ?ERR_TAG_INVALID_CHARS}
                    end
            end
    end.

-spec validate_binary_content(binary(), pos_integer(), binary()) -> validation_result().
validate_binary_content(Bin, MaxLen, _Label) when is_binary(Bin) ->
    case string:trim(Bin) of
        <<>> -> {error, <<"Title cannot be empty">>};
        _ ->
            case byte_size(Bin) > MaxLen of
                true -> format_length_error(MaxLen);
                false -> ok
            end
    end.

-spec format_length_error(pos_integer()) -> {error, binary()}.
format_length_error(200) -> {error, ?ERR_TITLE_TOO_LONG};
format_length_error(1000) -> {error, ?ERR_GOAL_TOO_LONG}.

-spec validate_numeric_range(integer(), integer(), integer(), binary(), binary()) -> validation_result().
validate_numeric_range(Value, Min, _Max, MinErr, _MaxErr) when Value < Min -> {error, MinErr};
validate_numeric_range(Value, _Min, Max, _MinErr, MaxErr) when Value > Max -> {error, MaxErr};
validate_numeric_range(_, _, _, _, _) -> ok.
