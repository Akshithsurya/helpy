-module(helpy_plan_parser).

-export([parse/1, default_plan/0]).

%% Presets define named session templates with default title, duration, and goal.
-define(DEFAULT_PRESETS, #{
    <<"work">>          => #{title => <<"Work Session">>,       duration_minutes => 60, goal => <<"Focus on work tasks">>},
    <<"study">>         => #{title => <<"Study Session">>,      duration_minutes => 45, goal => <<"Focus on studying">>},
    <<"focus">>         => #{title => <<"Deep Focus">>,         duration_minutes => 25, goal => <<"Deep focus session">>},
    <<"focus session">> => #{title => <<"Deep Focus">>,         duration_minutes => 25, goal => <<"Deep focus session">>},
    <<"code">>          => #{title => <<"Coding Session">>,     duration_minutes => 90, goal => <<"Write code and solve problems">>},
    <<"design">>        => #{title => <<"Design Session">>,     duration_minutes => 60, goal => <<"Create and refine designs">>},
    <<"write">>         => #{title => <<"Writing Session">>,    duration_minutes => 45, goal => <<"Write articles, docs, or content">>},
    <<"read">>          => #{title => <<"Reading Session">>,    duration_minutes => 30, goal => <<"Read and learn new things">>},
    <<"exercise">>      => #{title => <<"Exercise Session">>,   duration_minutes => 45, goal => <<"Physical activity or workout">>},
    <<"meditate">>      => #{title => <<"Meditation Session">>, duration_minutes => 15, goal => <<"Practice mindfulness and meditation">>},
    <<"clean">>         => #{title => <<"Cleaning Session">>,   duration_minutes => 30, goal => <<"Clean and organize space">>},
    <<"review">>        => #{title => <<"Review Session">>,     duration_minutes => 45, goal => <<"Review work or materials">>},
    <<"plan">>          => #{title => <<"Planning Session">>,   duration_minutes => 30, goal => <<"Plan and organize tasks">>},
    <<"sprint">>        => #{title => <<"Quick Focus Sprint">>, duration_minutes => 25, goal => <<"Short, focused burst of work">>},
    <<"blitz">>         => #{title => <<"Task Blitz">>,         duration_minutes => 15, goal => <<"Knock out small tasks quickly">>},
    <<"micro">>         => #{title => <<"Micro Focus">>,        duration_minutes => 10, goal => <<"Ultra-short focus session">>},
    <<"deep">>          => #{title => <<"Deep Dive">>,          duration_minutes => 45, goal => <<"Extended focused work">>},
    <<"quick task">>    => #{title => <<"Quick Task Blitz">>,   duration_minutes => 10, goal => <<"Tackle one small task">>}
}).

%% Index from a preset's first word to candidate preset names (longest first
%% so multi-word presets win over their single-word prefixes).
-define(PRESET_INDEX, #{
    <<"work">>     => [<<"work">>],
    <<"study">>    => [<<"study">>],
    <<"focus">>    => [<<"focus session">>, <<"focus">>],
    <<"code">>     => [<<"code">>],
    <<"design">>   => [<<"design">>],
    <<"write">>    => [<<"write">>],
    <<"read">>     => [<<"read">>],
    <<"exercise">> => [<<"exercise">>],
    <<"meditate">> => [<<"meditate">>],
    <<"clean">>    => [<<"clean">>],
    <<"review">>   => [<<"review">>],
    <<"plan">>     => [<<"plan">>],
    <<"sprint">>   => [<<"sprint">>],
    <<"blitz">>    => [<<"blitz">>],
    <<"micro">>    => [<<"micro">>],
    <<"deep">>     => [<<"deep">>],
    <<"quick">>    => [<<"quick task">>]
}).

-define(DEFAULT_PLAN_DURATION, 30).
-define(DEFAULT_CHUNK_SIZE,    15).
-define(DEFAULT_BREAK_MINUTES, 5).
-define(MIN_PLAN_DURATION,  5).
-define(MAX_PLAN_DURATION,  240).
-define(MIN_CHUNK_MINUTES,  1).
-define(MAX_CHUNK_MINUTES,  120).
-define(MIN_BREAK_MINUTES,  0).
-define(MAX_BREAK_MINUTES,  60).

%% Matches `--flag value` pairs where value is a quoted string or a single
%% whitespace-delimited token. Used by parse_flags/1.
-define(FLAG_RE, <<"--(goal|chunk|break|tags)\\s+(\"[^\"]+\"|'[^']+'|\\S+)">>).

%% Duration patterns mapped to their respective decoder functions.
-define(DURATION_PATTERNS, [
    {<<"(\\d+):([0-5]\\d)(?::([0-5]\\d))?">>, decode_hhmmss},
    {<<"(\\d+\\.\\d+)\\s*h(?:ours?)?">>, decode_decimal_hours},
    {<<"(\\d+)\\s*h(?:ours?)?\\s*(\\d*)\\s*(?:m(?:in(?:utes?)?)?)?">>, decode_hm},
    {<<"(\\d+)\\s*m(?:in(?:(?:ute)?s?)?)?">>, decode_minutes},
    {<<"^(\\d+)\\s*$">>, decode_bare_integer}
]).

-type preset_map()  :: #{title => binary(), duration_minutes => integer(), goal => binary()}.
-type parsed_plan() :: #{
    title              => binary(),
    goal               => binary(),
    duration_minutes   => integer(),
    used_preset        => binary() | undefined,
    chunk_size_minutes => integer(),
    break_minutes      => integer(),
    tags               => [binary()]
}.

%%%=============================================================================
%%% Public API
%%%=============================================================================

-spec parse(string() | binary()) -> parsed_plan().
parse(Args) when is_list(Args) ->
    parse(unicode:characters_to_binary(Args));
parse(Args) when is_binary(Args) ->
    {Remaining, Flags} = parse_flags(string:trim(Args)),
    {Duration, TitleStr} = parse_duration_binary(Remaining),
    Parts = binary:split(string:trim(TitleStr), <<" ">>, [global, trim_all]),
    {Preset, Rest} = find_matching_preset(Parts),
    Plan0 = apply_preset(Preset, default_plan()),
    Plan1 = apply_duration(Duration, Plan0),
    Plan2 = apply_title(Rest, Plan1),
    apply_flags(Plan2, Flags).

-spec default_plan() -> parsed_plan().
default_plan() ->
    #{
        title              => <<"Planned session">>,
        goal               => <<>>,
        duration_minutes   => ?DEFAULT_PLAN_DURATION,
        used_preset        => undefined,
        chunk_size_minutes => ?DEFAULT_CHUNK_SIZE,
        break_minutes      => ?DEFAULT_BREAK_MINUTES,
        tags               => []
    }.

%%%=============================================================================
%%% Flag parsing
%%%=============================================================================

-spec parse_flags(binary()) -> {binary(), map()}.
parse_flags(Args) ->
    case re:run(Args, ?FLAG_RE, [global, {capture, all, binary}]) of
        {match, Matches} ->
            Flags = lists:foldl(
                fun([_, Flag, Raw], Acc) ->
                    store_flag(Flag, strip_quotes(Raw), Acc)
                end, #{}, Matches),
            Stripped = re:replace(Args, ?FLAG_RE, <<" ">>, [global, {return, binary}]),
            {string:trim(Stripped), Flags};
        nomatch ->
            {Args, #{}}
    end.

-spec strip_quotes(binary()) -> binary().
strip_quotes(<<Q, Rest/binary>>) when Q =:= $"; Q =:= $' ->
    case Rest of
        <<>> -> <<Q>>;
        _ ->
            Sz = byte_size(Rest),
            case binary:last(Rest) of
                Q -> binary:part(Rest, 0, Sz - 1);
                _ -> <<Q, Rest/binary>>
            end
    end;
strip_quotes(Value) ->
    Value.

-spec store_flag(binary(), binary(), map()) -> map().
store_flag(<<"goal">>,  V, Acc) -> Acc#{goal => V};
store_flag(<<"tags">>,  V, Acc) ->
    Tags = [T || T <- binary:split(V, <<",">>, [global, trim_all]), T =/= <<>>],
    Acc#{tags => Tags};
store_flag(<<"chunk">>, V, Acc) -> put_int(V, chunk, Acc);
store_flag(<<"break">>, V, Acc) -> put_int(V, break, Acc).

-spec put_int(binary(), atom(), map()) -> map().
put_int(V, Key, Acc) ->
    %% Extract leading digits to gracefully handle inputs like "15m"
    case re:run(V, <<"^(\\d+)">>, [{capture, all, binary}]) of
        {match, [_, IntBin]} ->
            Acc#{Key => binary_to_integer(IntBin)};
        nomatch ->
            Acc
    end.

%%%=============================================================================
%%% Apply parsed flags to plan
%%%=============================================================================

-spec apply_flags(parsed_plan(), map()) -> parsed_plan().
apply_flags(Parsed, Flags) ->
    P1 = maybe_copy(goal,  goal, Flags, Parsed),
    P2 = maybe_clamp(chunk, chunk_size_minutes, ?MIN_CHUNK_MINUTES, ?MAX_CHUNK_MINUTES, Flags, P1),
    P3 = maybe_clamp(break, break_minutes,      ?MIN_BREAK_MINUTES, ?MAX_BREAK_MINUTES, Flags, P2),
    maybe_copy(tags, tags, Flags, P3).

-spec maybe_copy(atom(), atom(), map(), map()) -> map().
maybe_copy(SrcKey, DstKey, Source, Target) ->
    case maps:find(SrcKey, Source) of
        {ok, V} -> Target#{DstKey => V};
        error   -> Target
    end.

-spec maybe_clamp(atom(), atom(), integer(), integer(), map(), map()) -> map().
maybe_clamp(SrcKey, DstKey, Min, Max, Source, Target) ->
    case maps:find(SrcKey, Source) of
        {ok, V} when is_integer(V) -> Target#{DstKey => clamp(V, Min, Max)};
        _                          -> Target
    end.

%%%=============================================================================
%%% Preset, duration, and title application
%%%=============================================================================

-spec apply_preset(undefined | {binary(), preset_map()}, parsed_plan()) -> parsed_plan().
apply_preset(undefined, Acc) ->
    Acc;
apply_preset({Name, Preset}, Acc) ->
    Acc#{title            => maps:get(title, Preset),
         duration_minutes => maps:get(duration_minutes, Preset),
         goal             => maps:get(goal, Preset),
         used_preset      => Name}.

-spec apply_duration(integer() | undefined, parsed_plan()) -> parsed_plan().
apply_duration(undefined, Plan) -> Plan;
apply_duration(Minutes,    Plan) -> Plan#{duration_minutes => normalize_duration(Minutes)}.

-spec apply_title([binary()], parsed_plan()) -> parsed_plan().
apply_title([], Plan) -> Plan;
apply_title(Words, Plan) ->
    CurrentTitle = maps:get(title, Plan),
    Extra = join_binary(Words, <<" ">>),
    %% Append trailing words to the base title rather than overriding it
    NewTitle = <<CurrentTitle/binary, " ", Extra/binary>>,
    Plan#{title => string:trim(NewTitle)}.

%%%=============================================================================
%%% Preset matching
%%%=============================================================================

-spec find_matching_preset([binary()]) -> {undefined | {binary(), preset_map()}, [binary()]}.
find_matching_preset([]) ->
    {undefined, []};
find_matching_preset([First | _] = Parts) ->
    Candidates = maps:get(First, ?PRESET_INDEX, []),
    match_candidates(Parts, Candidates).

-spec match_candidates([binary()], [binary()]) ->
    {undefined | {binary(), preset_map()}, [binary()]}.
match_candidates(Parts, []) ->
    {undefined, Parts};
match_candidates(Parts, [Name | Rest]) ->
    NameWords = binary:split(Name, <<" ">>, [global]),
    case take_prefix(NameWords, Parts) of
        {ok, Tail} -> {{Name, maps:get(Name, ?DEFAULT_PRESETS)}, Tail};
        error      -> match_candidates(Parts, Rest)
    end.

-spec take_prefix([binary()], [binary()]) -> {ok, [binary()]} | error.
take_prefix([], Parts) -> {ok, Parts};
take_prefix([W | Ws], [P | Ps]) when W =:= P -> take_prefix(Ws, Ps);
take_prefix(_, _) -> error.

%%%=============================================================================
%%% Duration extraction
%%%=============================================================================

-spec parse_duration_binary(binary()) -> {integer() | undefined, binary()}.
parse_duration_binary(Str) ->
    case try_duration_patterns(Str) of
        {ok, Minutes, Stripped} -> {Minutes, Stripped};
        error                   -> {undefined, Str}
    end.

-spec try_duration_patterns(binary()) -> {ok, integer(), binary()} | error.
try_duration_patterns(Str) ->
    try_patterns(Str, ?DURATION_PATTERNS).

-spec try_patterns(binary(), [{binary(), atom()}]) -> {ok, integer(), binary()} | error.
try_patterns(_Str, []) ->
    error;
try_patterns(Str, [{Pattern, Decoder} | Rest]) ->
    case re:run(Str, Pattern, [{capture, all, binary}]) of
        {match, [_Full | Groups]} ->
            Minutes  = ?MODULE:Decoder(Groups),
            Stripped = re:replace(Str, Pattern, <<" ">>, [{return, binary}]),
            {ok, Minutes, string:trim(Stripped)};
        nomatch ->
            try_patterns(Str, Rest)
    end.

%%% Duration Decoders

decode_hhmmss([H, M | MaybeS]) ->
    Total = binary_to_integer(H) * 60 + binary_to_integer(M),
    case MaybeS of
        [S] when S =/= <<>> ->
            Secs = binary_to_integer(S),
            if Secs >= 30 -> Total + 1;
               true -> Total
            end;
        _ -> Total
    end.

decode_decimal_hours([H]) ->
    round(binary_to_float(H) * 60).

decode_hm([H, M]) ->
    Hours   = binary_to_integer(H),
    Minutes = case M of <<>> -> 0; _ -> binary_to_integer(M) end,
    Hours * 60 + Minutes.

decode_minutes([M | _]) -> binary_to_integer(M).
decode_bare_integer([M | _]) -> binary_to_integer(M).

%%%=============================================================================
%%% Helpers
%%%=============================================================================

-spec join_binary([binary()], binary()) -> binary().
join_binary([], _Sep) -> <<>>;
join_binary(List, Sep) ->
    binary:join(List, Sep).

-spec normalize_duration(number()) -> pos_integer().
normalize_duration(Minutes) ->
    clamp(Minutes, ?MIN_PLAN_DURATION, ?MAX_PLAN_DURATION).

-spec clamp(number(), integer(), integer()) -> integer().
clamp(V, Min, Max) when is_number(V) ->
    max(Min, min(Max, erlang:round(V))).
