-module(helpy_plan_metrics).

-export([
    init/0,
    is_initialized/0,
    increment/1, increment/2,
    decrement/1, decrement/2,
    set/2,
    observe/2,
    get/1,
    get_all/0,
    delete/1,
    reset/0,
    to_prometheus/0
]).

%% Tuple layouts:
%%   counter:    {Key, counter, Value}
%%   gauge:      {Key, gauge, Value}
%%   histogram:  {Key, histogram, Sum, Count, Min, Max}
%%
%% Note: histograms currently track only sum/count/min/max without
%% bucketed distributions.  The Prometheus output exposes a single
%% +Inf bucket, making this effectively a summary with min/max extras.

-define(METRICS_TABLE, helpy_plan_metrics_table).
-define(TABLE_OPTS, [named_table, public, set,
                     {read_concurrency, true},
                     {write_concurrency, true}]).

-type metric_type() :: counter | gauge | histogram.
-type metric_value() :: integer() | float().
-type metric_data() :: metric_value() | map() | undefined.

%%%===================================================================
%%% Public API
%%%===================================================================

-spec init() -> ok.
init() ->
    try
        _ = ets:new(?METRICS_TABLE, ?TABLE_OPTS)
    catch
        error:badarg -> ok
    end,
    ok.

-spec is_initialized() -> boolean().
is_initialized() ->
    ets:info(?METRICS_TABLE, name) =/= undefined.

-spec increment(atom()) -> ok.
increment(Key) ->
    increment(Key, 1).

-spec increment(atom(), integer()) -> ok.
increment(Key, Amount) when is_integer(Amount) ->
    safe_call(fun() -> bump_counter(Key, Amount) end, ok).

-spec decrement(atom()) -> ok.
decrement(Key) ->
    decrement(Key, 1).

-spec decrement(atom(), integer()) -> ok.
decrement(Key, Amount) when is_integer(Amount) ->
    safe_call(fun() -> bump_counter(Key, -Amount) end, ok).

-spec set(atom(), metric_value()) -> ok.
set(Key, Value) when is_number(Value) ->
    %% Replacement semantics: set always overwrites regardless of prior type.
    safe_call(fun() -> ets:insert(?METRICS_TABLE, {Key, gauge, Value}) end, ok).

-spec observe(atom(), number()) -> ok.
observe(Key, Value) when is_number(Value) ->
    safe_call(fun() -> observe_histogram(Key, Value) end, ok).

-spec get(atom()) -> metric_data().
get(Key) ->
    case safe_call(fun() -> ets:lookup(?METRICS_TABLE, Key) end, []) of
        [{Key, counter, Value}] -> Value;
        [{Key, gauge, Value}]   -> Value;
        [{Key, histogram, Sum, Count, Min, Max}] ->
            #{sum => Sum, count => Count, min => Min, max => Max,
              avg => safe_avg(Sum, Count)};
        _ -> undefined
    end.

-spec get_all() -> [{atom(), map()}].
get_all() ->
    Entries = safe_call(fun() -> ets:tab2list(?METRICS_TABLE) end, []),
    [format_entry(Entry) || Entry <- Entries].

-spec delete(atom()) -> ok.
delete(Key) ->
    safe_call(fun() -> ets:delete(?METRICS_TABLE, Key) end, ok).

-spec reset() -> ok.
reset() ->
    safe_call(fun() -> ets:delete_all_objects(?METRICS_TABLE) end, ok).

-spec to_prometheus() -> binary().
to_prometheus() ->
    Entries = safe_call(fun() -> lists:keysort(1, ets:tab2list(?METRICS_TABLE)) end, []),
    iolist_to_binary([prom_line(Entry) || Entry <- Entries]).

%%%===================================================================
%%% Internal helpers
%%%===================================================================

%% ------------------------------------------------------------------
%% Safe call wrapper — ensures metrics never crash the calling process
%% when the table is missing or transiently unavailable.
%% ------------------------------------------------------------------

-spec safe_call(fun(), term()) -> term().
safe_call(Fun, Default) ->
    try
        Fun()
    catch
        error:badarg -> Default
    end.

%% ------------------------------------------------------------------
%% Counter bump — uses insert_new to avoid select_replace on first
%% observation. Atomically adds Amount only to an existing counter.
%% ------------------------------------------------------------------

-spec bump_counter(atom(), integer()) -> ok.
bump_counter(Key, Amount) ->
    T = ?METRICS_TABLE,
    case ets:insert_new(T, {Key, counter, Amount}) of
        true ->
            ok;
        false ->
            %% Atomically add Amount only to an existing counter tuple.
            %% If the key exists as a gauge or histogram, it won't match
            %% and will be safely ignored.
            _ = ets:select_replace(T, [
                {{Key, counter, '$1'}, [],
                 [{{const, Key}, counter, {'+', '$1', {const, Amount}}}]}
            ]),
            ok
    end.

%% ------------------------------------------------------------------
%% Histogram observation — skips select_replace on first observation.
%% Atomically updates sum/count and conditionally tightens min/max.
%% ------------------------------------------------------------------

-spec observe_histogram(atom(), number()) -> ok.
observe_histogram(Key, Value) ->
    T = ?METRICS_TABLE,
    case ets:insert_new(T, {Key, histogram, Value, 1, Value, Value}) of
        true ->
            ok;
        false ->
            %% Guards re-check bounds at replacement time, so concurrent
            %% observes never lose a true extremum.
            _ = ets:select_replace(T, [
                %% Value is new min
                {{Key, histogram, '$1', '$2', '$3', '$4'},
                 [{'<', {const, Value}, '$3'}],
                 [{{const, Key}, histogram,
                   {'+', '$1', {const, Value}},
                   {'+', '$2', 1},
                   {const, Value},
                   '$4'}]},
                %% Value is new max
                {{Key, histogram, '$1', '$2', '$3', '$4'},
                 [{'>', {const, Value}, '$4'}],
                 [{{const, Key}, histogram,
                   {'+', '$1', {const, Value}},
                   {'+', '$2', 1},
                   '$3',
                   {const, Value}}]},
                %% No extremum update — just bump sum and count
                {{Key, histogram, '$1', '$2', '$3', '$4'},
                 [],
                 [{{const, Key}, histogram,
                   {'+', '$1', {const, Value}},
                   {'+', '$2', 1},
                   '$3',
                   '$4'}]}
            ]),
            ok
    end.

%% ------------------------------------------------------------------
%% Formatting
%% ------------------------------------------------------------------

-spec format_entry(tuple()) -> {atom(), map()}.
format_entry({Key, counter, Value}) ->
    {Key, #{type => counter, value => Value}};
format_entry({Key, gauge, Value}) ->
    {Key, #{type => gauge, value => Value}};
format_entry({Key, histogram, Sum, Count, Min, Max}) ->
    {Key, #{type => histogram, sum => Sum, count => Count,
            min => Min, max => Max, avg => safe_avg(Sum, Count)}}.

-spec safe_avg(number(), non_neg_integer()) -> float().
safe_avg(_Sum, 0) -> 0.0;
safe_avg(Sum, Count) -> Sum / Count.

-spec prom_line(tuple()) -> iolist().
prom_line({Key, counter, Value}) ->
    Name = sanitize_name(atom_to_list(Key)),
    ["# TYPE ", Name, " counter\n",
     Name, " ", format_number(Value), "\n"];
prom_line({Key, gauge, Value}) ->
    Name = sanitize_name(atom_to_list(Key)),
    ["# TYPE ", Name, " gauge\n",
     Name, " ", format_number(Value), "\n"];
prom_line({Key, histogram, Sum, Count, _Min, _Max}) ->
    Name = sanitize_name(atom_to_list(Key)),
    ["# TYPE ", Name, " histogram\n",
     Name, "_bucket{le=\"+Inf\"} ", format_number(Count), "\n",
     Name, "_sum ",   format_number(Sum),   "\n",
     Name, "_count ", format_number(Count), "\n"].

-spec format_number(term()) -> iolist().
format_number(N) when is_integer(N) -> integer_to_list(N);
format_number(N) when is_float(N)   -> io_lib:format("~w", [N]);
format_number(inf)                  -> "+Inf";
format_number('-inf')               -> "-Inf";
format_number(nan)                  -> "NaN";
format_number(_)                    -> "0".

%% Prometheus metric names must match [a-zA-Z_:][a-zA-Z0-9_:]*.
-spec sanitize_name(string()) -> string().
sanitize_name([]) ->
    "_";
sanitize_name([First | Rest]) ->
    [sanitize_first(First) | [sanitize_char(C) || C <- Rest]].

%% First character: must be [a-zA-Z_:].
sanitize_first(C) when C >= $a, C =< $z; C >= $A, C =< $Z; C =:= $:; C =:= $_ -> C;
sanitize_first(_) -> $_.

%% Subsequent characters: must be [a-zA-Z0-9_:].
sanitize_char(C) when C >= $a, C =< $z; C >= $A, C =< $Z; C >= $0, C =< $9; C =:= $:; C =:= $_ -> C;
sanitize_char(_) -> $_.