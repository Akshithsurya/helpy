-module(helpy_bot_server).
-behaviour(gen_server).

%% API
-export([start_link/0, log_action/2, get_memory/0, get_fact/0,
         get_motivation/0, get_erlang_status/0]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3, format_status/2]).

-define(SERVER, ?MODULE).

%% Limits (override via app env: helpy_bot_server, {max_actions, _} etc.)
-default(max_actions,      50).
-default(recent_actions,   10).
-default(low_threshold,     3).
-default(medium_threshold, 10).

-type action_type()    :: atom().
-type action_detail()  :: binary().
-type activity_level() :: low | medium | high.

-type action() :: #{
    id        := binary(),
    type      := action_type(),
    detail    := action_detail(),
    timestamp := binary()
}.

-record(state, {
    total_actions  = 0              :: non_neg_integer(),
    actions        = []             :: [action()],
    action_counts  = #{}            :: #{action_type() => non_neg_integer()},
    facts          = []             :: [binary()],
    motivations    = #{}            :: #{activity_level() => [binary()]},
    started_at     = erlang:monotonic_time(millisecond) :: integer()
}).

%% Compile-time content
-define(FACTS, [
    <<"Erlang was designed at Ericsson in 1986 by Joe Armstrong, Robert Virding, and Mike Williams for ultra-reliable telecom systems.">>,
    <<"BEAM (Bogdan/Björn's Erlang Abstract Machine) runs millions of lightweight processes with pre-emptive scheduling.">>,
    <<"Erlang processes have no shared memory — they communicate exclusively via message passing, eliminating entire classes of concurrency bugs.">>,
    <<"OTP (Open Telecom Platform) provides battle-tested patterns: gen_server, gen_statem, supervisor trees, and hot code upgrades.">>,
    <<"The Erlang supervisor tree lets you build fault-tolerant systems: a crashed child process is automatically restarted by its supervisor.">>,
    <<"Erlang supports hot code swapping — you can upgrade a running system without any downtime, a feature used in telecom switches.">>,
    <<"WhatsApp served 2 million connections per server using Erlang — demonstrating its extraordinary concurrency capabilities.">>,
    <<"ETS (Erlang Term Storage) provides in-memory key-value tables with O(1) lookup — all without leaving the BEAM ecosystem.">>,
    <<"Erlang's 'let it crash' philosophy means processes handle normal logic while supervisors handle fault recovery — a clean separation of concerns.">>,
    <<"Pattern matching in Erlang is pervasive: function heads, case expressions, and receive blocks all use the same declarative mechanism.">>,
    <<"The BEAM scheduler runs one OS thread per CPU core, and each Erlang process gets a small, configurable number of reductions before yielding.">>,
    <<"Erlang's binary syntax (`<<>>`  notation) makes network protocol parsing expressive and safe without external parsing libraries.">>,
    <<"Mnesia is Erlang's distributed, real-time database — it supports transactions, replication, and fragmentation across nodes.">>,
    <<"The Pomodoro Technique was invented by Francesco Cirillo in 1987 using a tomato-shaped kitchen timer.">>,
    <<"Writing down goals increases task completion rates by over 40% — use the Tasks tab to externalise your working memory.">>,
    <<"The Zeigarnik effect shows your brain holds unfinished tasks in active memory — completing them reduces cognitive load.">>,
    <<"Multitasking reduces effective IQ by up to 10 points due to cognitive switching overhead.">>,
    <<"A 5-minute break every 25 minutes (Pomodoro) measurably restores attention and prevents decision fatigue.">>,
    <<"The BEAM can handle hundreds of thousands of concurrent processes on commodity hardware — each with its own garbage-collected heap.">>,
    <<"1% daily improvement compounds to 37x better performance over a year — small consistent focus sessions add up fast.">>
]).

-define(MOTIVATIONS, #{
    high   => [
        <<"Sensational work! Your focus and output are unmatched right now!">>,
        <<"Incredible momentum! You're crushing every goal in front of you.">>
    ],
    medium => [
        <<"Great job! Step by step, consistent effort leads to major breakthroughs.">>,
        <<"Solid focus today! Keep pushing forward!">>
    ],
    low    => [
        <<"Start small! Finishing just one task now builds powerful momentum.">>,
        <<"Focus on progress over perfection. You've got this!">>
    ]
}).

%%%===================================================================
%%% API
%%%===================================================================

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, [], []).

-spec log_action(action_type(), action_detail()) -> #{success := boolean()}.
log_action(Type, Detail) ->
    gen_server:call(?SERVER, {log_action, Type, Detail}).

-spec get_memory() -> map().
get_memory() ->
    gen_server:call(?SERVER, get_memory).

-spec get_fact() -> map().
get_fact() ->
    gen_server:call(?SERVER, get_fact).

-spec get_motivation() -> map().
get_motivation() ->
    gen_server:call(?SERVER, get_motivation).

-spec get_erlang_status() -> map().
get_erlang_status() ->
    gen_server:call(?SERVER, get_erlang_status).

%%%===================================================================
%%% gen_server callbacks
%%%===================================================================

-spec init(term()) -> {ok, #state{}}.
init([]) ->
    {ok, #state{
        facts        = ?FACTS,
        motivations  = ?MOTIVATIONS,
        started_at   = erlang:monotonic_time(millisecond)
    }}.

-spec handle_call(term(), {pid(), term()}, #state{}) ->
        {reply, term(), #state{}}.
handle_call({log_action, Type, Detail}, _From, State) ->
    {Reply, NewState} = do_log_action(Type, Detail, State),
    {reply, Reply, NewState};

handle_call(get_memory, _From, State) ->
    Reply = make_memory_reply(State),
    {reply, Reply, State};

handle_call(get_fact, _From, #state{facts = Facts} = State) ->
    Reply = #{success => true,
              fact    => pick_random(Facts),
              source  => <<"Erlang Bot Server">>},
    {reply, Reply, State};

handle_call(get_motivation, _From, State) ->
    Reply = make_motivation_reply(State),
    {reply, Reply, State};

handle_call(get_erlang_status, _From, State) ->
    Reply = make_status_reply(State),
    {reply, Reply, State};

handle_call(_Request, _From, State) ->
    {reply, {error, unknown_request}, State}.

-spec handle_cast(term(), #state{}) -> {noreply, #state{}}.
handle_cast(_Msg, State) ->
    {noreply, State}.

-spec handle_info(term(), #state{}) -> {noreply, #state{}}.
handle_info(Info, State) ->
    logger:warning(#{module => ?MODULE, msg => "Unhandled info", info => Info}),
    {noreply, State}.

-spec terminate(term(), #state{}) -> ok.
terminate(Reason, #state{total_actions = Total}) ->
    logger:info(#{module => ?MODULE,
                  msg    => "Helpy Bot server shutting down",
                  reason => Reason, total_actions => Total}),
    ok.

-spec code_change(term(), #state{}, term()) -> {ok, #state{}}.
code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

-spec format_status(normal | terminate, list()) -> proplists:proplist().
format_status(normal, [_PDict, #state{total_actions = T, actions = A}]) ->
    [{state, #{total_actions => T, buffered_actions => length(A)}}];
format_status(terminate, [_PDict, State]) ->
    [{state, State}].

%%%===================================================================
%%% Internal helpers
%%%===================================================================

-spec do_log_action(action_type(), action_detail(), #state{}) ->
        {map(), #state{}}.
do_log_action(Type, Detail,
              #state{total_actions = Total,
                     actions       = Actions,
                     action_counts = Counts} = State) ->
    NewTotal  = Total + 1,
    NewCounts = maps:update_with(Type, fun(C) -> C + 1 end, 1, Counts),
    Entry = #{
        id        => <<"act_", (integer_to_binary(NewTotal, 10))/binary>>,
        type      => Type,
        detail    => Detail,
        timestamp => timestamp_ms()
    },
    NewActions = lists:sublist([Entry | Actions], config(max_actions)),
    NewState = State#state{
        total_actions = NewTotal,
        actions       = NewActions,
        action_counts = NewCounts
    },
    Reply = #{success       => true,
              action        => Entry,
              total_actions => NewTotal},
    {Reply, NewState}.

-spec make_memory_reply(#state{}) -> map().
make_memory_reply(#state{total_actions = Total,
                         action_counts = Counts,
                         actions       = Actions}) ->
    #{
        success        => true,
        total_actions  => Total,
        action_counts  => Counts,
        recent_actions => lists:sublist(Actions, config(recent_actions)),
        summary        => iolist_to_binary([
            <<"Erlang Helpy Bot has logged ">>,
            integer_to_binary(Total, 10),
            <<" actions.">>
        ])
    }.

-spec make_motivation_reply(#state{}) -> map().
make_motivation_reply(#state{total_actions = Total,
                             motivations   = Motivations}) ->
    Level = activity_level(Total),
    Pool  = maps:get(Level, Motivations, [<<"Keep going!">>]),
    #{
        success        => true,
        motivation     => pick_random(Pool),
        activity_level => Level,
        total_actions  => Total
    }.

-spec make_status_reply(#state{}) -> map().
make_status_reply(#state{total_actions = Total, started_at = StartedAt}) ->
    #{
        success        => true,
        node           => atom_to_binary(node(), utf8),
        otp_release    => list_to_binary(erlang:system_info(otp_release)),
        process_count  => erlang:system_info(process_count),
        schedulers     => erlang:system_info(schedulers_online),
        uptime_seconds => (erlang:monotonic_time(millisecond) - StartedAt) div 1000,
        total_actions  => Total,
        source         => <<"helpy_bot_server">>
    }.

%% RFC3339 timestamp with millisecond precision (UTC).
-spec timestamp_ms() -> binary().
timestamp_ms() ->
    list_to_binary(
        calendar:system_time_to_rfc3339(
            erlang:system_time(millisecond),
            [{unit, millisecond}])).

%% Random element from a non-empty list.
%% NOTE: do NOT re-seed here — the default RNG is already auto-seeded
%% per process; re-seeding on every call destroys statistical quality.
-spec pick_random(nonempty_list(T)) -> T.
pick_random(List) ->
    lists:nth(rand:uniform(length(List)), List).

%% Categorize activity level from cumulative actions.
-spec activity_level(non_neg_integer()) -> activity_level().
activity_level(Total) when Total >= config(medium_threshold) -> high;
activity_level(Total) when Total >= config(low_threshold)    -> medium;
activity_level(_)                                            -> low.

%% Read a configuration value, falling back to the module default.
-spec config(max_actions | recent_actions | low_threshold | medium_threshold) -> pos_integer().
config(Key) ->
    case application:get_env(?MODULE, Key) of
        {ok, V} when is_integer(V), V > 0 -> V;
        _                                 -> default(Key)
    end.

-spec default(max_actions | recent_actions | low_threshold | medium_threshold) -> pos_integer().
default(max_actions)     -> 50;
default(recent_actions)  -> 10;
default(low_threshold)   -> 3;
default(medium_threshold) -> 10.