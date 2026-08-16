%% @doc Helpy Session Manager
%%
%% An OTP gen_server that tracks active focus sessions per user.
%% Implements a token-bucket rate limiter in pure Erlang to prevent
%% session-spam and protect system resources.
%%
%% API:
%%   start_session/2  - begin a focus session for UserId with DurationMinutes
%%   end_session/1    - complete a running session
%%   cancel_session/1 - cancel a running session
%%   pause_session/1  - mark a session as paused
%%   resume_session/1 - resume a paused session
%%   session_status/1 - retrieve status for a UserId
%%   list_sessions/0  - list all active/paused sessions
%%   node_info/0      - return BEAM node diagnostic info

-module(helpy_session_manager).
-behaviour(gen_server).

%% Public API
-export([
    start_link/0,
    start_session/2,
    end_session/1,
    cancel_session/1,
    pause_session/1,
    resume_session/1,
    session_status/1,
    list_sessions/0,
    node_info/0
]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-define(SERVER, ?MODULE).

%% Token bucket: each user gets ?BUCKET_CAPACITY tokens.
%% One token is consumed per session start. Tokens refill at
%% ?REFILL_RATE tokens per ?REFILL_PERIOD milliseconds.
-define(BUCKET_CAPACITY, 5).
-define(REFILL_RATE,     1).
-define(REFILL_PERIOD,   60_000).   %% 1 minute

-type user_id()    :: binary().
-type session_id() :: binary().
-type title()      :: binary().
-type end_status() :: completed | cancelled.
-type status()     :: active | paused | end_status().

-type session() :: #{
    id              := session_id(),
    user_id         := user_id(),
    title           := title(),
    duration_ms     := non_neg_integer(),
    started_at      := integer(),
    paused_at       => integer(),
    resumed_at      => integer(),
    ended_at        => integer(),
    elapsed_ms      := non_neg_integer(),
    status          := status()
}.

-type bucket() :: #{
    tokens      := non_neg_integer(),
    last_refill := integer()
}.

-record(state, {
    sessions = #{} :: #{user_id() => session()},
    buckets  = #{} :: #{user_id() => bucket()}
}).

%%%==========================================================================
%%% Public API
%%%==========================================================================

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, [], []).

%% @doc Start a new focus session. Returns {error, rate_limited} when
%% the user's token bucket is empty.
-spec start_session(user_id(), non_neg_integer()) ->
    {ok, session()} | {error, binary()}.
start_session(UserId, DurationMinutes)
    when is_binary(UserId), is_integer(DurationMinutes), DurationMinutes >= 0 ->
    gen_server:call(?SERVER, {start_session, UserId, DurationMinutes}).

%% @doc End (complete) a session for UserId.
-spec end_session(user_id()) -> {ok, session()} | {error, binary()}.
end_session(UserId) when is_binary(UserId) ->
    gen_server:call(?SERVER, {end_session, UserId, completed}).

%% @doc Cancel a running session for UserId.
-spec cancel_session(user_id()) -> {ok, session()} | {error, binary()}.
cancel_session(UserId) when is_binary(UserId) ->
    gen_server:call(?SERVER, {end_session, UserId, cancelled}).

%% @doc Pause an active session.
-spec pause_session(user_id()) -> {ok, session()} | {error, binary()}.
pause_session(UserId) when is_binary(UserId) ->
    gen_server:call(?SERVER, {pause_session, UserId}).

%% @doc Resume a paused session.
-spec resume_session(user_id()) -> {ok, session()} | {error, binary()}.
resume_session(UserId) when is_binary(UserId) ->
    gen_server:call(?SERVER, {resume_session, UserId}).

%% @doc Retrieve status of a session keyed by UserId.
-spec session_status(user_id()) -> {ok, session()} | {error, binary()}.
session_status(UserId) when is_binary(UserId) ->
    gen_server:call(?SERVER, {session_status, UserId}).

%% @doc List all sessions currently in active or paused state.
-spec list_sessions() -> [session()].
list_sessions() ->
    gen_server:call(?SERVER, list_sessions).

%% @doc Returns a diagnostic snapshot of the BEAM node.
-spec node_info() -> map().
node_info() ->
    gen_server:call(?SERVER, node_info).

%%%==========================================================================
%%% gen_server callbacks
%%%==========================================================================

-spec init(term()) -> {ok, #state{}}.
init([]) ->
    schedule_refill(),
    {ok, #state{}}.

-spec handle_call(term(), {pid(), term()}, #state{}) ->
    {reply, term(), #state{}}.
handle_call({start_session, UserId, DurationMinutes}, _From, State0) ->
    Now = erlang:system_time(millisecond),
    case take_token(UserId, State0, Now) of
        {error, _} = Err ->
            {reply, Err, State0};
        {ok, State1} ->
            Session  = new_session(UserId, DurationMinutes, Now),
            Sessions = maps:put(UserId, Session, State1#state.sessions),
            {reply, {ok, Session}, State1#state{sessions = Sessions}}
    end;

handle_call({end_session, UserId, EndStatus}, _From, State)
    when EndStatus =:= completed; EndStatus =:= cancelled ->
    Now = erlang:system_time(millisecond),
    case maps:take(UserId, State#state.sessions) of
        {Session, Sessions} ->
            Elapsed = compute_elapsed(Session, Now),
            Updated = Session#{
                status     => EndStatus,
                ended_at   => Now,
                elapsed_ms => Elapsed
            },
            ok = record_analytics(Session, Elapsed),
            {reply, {ok, Updated}, State#state{sessions = Sessions}};
        error ->
            {reply, {error, <<"No active session found.">>}, State}
    end;

handle_call({pause_session, UserId}, _From, State) ->
    Now = erlang:system_time(millisecond),
    case maps:find(UserId, State#state.sessions) of
        {ok, #{status := active} = Session} ->
            Elapsed = compute_elapsed(Session, Now),
            Updated = Session#{
                status     => paused,
                paused_at  => Now,
                elapsed_ms => Elapsed
            },
            Sessions = maps:put(UserId, Updated, State#state.sessions),
            {reply, {ok, Updated}, State#state{sessions = Sessions}};
        {ok, #{status := _Other}} ->
            {reply, {error, <<"Session is not active.">>}, State};
        error ->
            {reply, {error, <<"No active session found.">>}, State}
    end;

handle_call({resume_session, UserId}, _From, State) ->
    Now = erlang:system_time(millisecond),
    case maps:find(UserId, State#state.sessions) of
        {ok, #{status := paused} = Session} ->
            Updated = Session#{
                status     => active,
                started_at => Now,
                resumed_at => Now
            },
            Sessions = maps:put(UserId, Updated, State#state.sessions),
            {reply, {ok, Updated}, State#state{sessions = Sessions}};
        {ok, #{status := _Other}} ->
            {reply, {error, <<"Session is not paused.">>}, State};
        error ->
            {reply, {error, <<"No session found.">>}, State}
    end;

handle_call({session_status, UserId}, _From, State) ->
    case maps:find(UserId, State#state.sessions) of
        {ok, Session} -> {reply, {ok, Session}, State};
        error         -> {reply, {error, <<"No session found.">>}, State}
    end;

handle_call(list_sessions, _From, State) ->
    {reply, maps:values(State#state.sessions), State};

handle_call(node_info, _From, State) ->
    {reply, build_node_info(State), State};

handle_call(_Request, _From, State) ->
    {reply, {error, unknown_request}, State}.

-spec handle_cast(term(), #state{}) -> {noreply, #state{}}.
handle_cast(_Msg, State) ->
    {noreply, State}.

-spec handle_info(term(), #state{}) -> {noreply, #state{}}.
handle_info(refill_tokens, State) ->
    Now = erlang:system_time(millisecond),
    Buckets = maps:map(
        fun(_UserId, Bucket) -> refill_bucket(Bucket, Now) end,
        State#state.buckets),
    schedule_refill(),
    {noreply, State#state{buckets = Buckets}};

handle_info(_Info, State) ->
    {noreply, State}.

-spec terminate(term(), #state{}) -> ok.
terminate(Reason, #state{sessions = S}) ->
    error_logger:info_msg(
        "~p shutting down. Reason: ~p. Open sessions: ~p~n",
        [?MODULE, Reason, maps:size(S)]),
    ok.

-spec code_change(term(), #state{}, term()) -> {ok, #state{}}.
code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

%%%==========================================================================
%%% Internal helpers
%%%==========================================================================

-spec schedule_refill() -> reference().
schedule_refill() ->
    erlang:send_after(?REFILL_PERIOD, self(), refill_tokens).

-spec take_token(user_id(), #state{}, integer()) ->
    {ok, #state{}} | {error, binary()}.
take_token(UserId, State, Now) ->
    Default = #{tokens => ?BUCKET_CAPACITY, last_refill => Now},
    Bucket0 = maps:get(UserId, State#state.buckets, Default),
    Bucket1 = refill_bucket(Bucket0, Now),
    case Bucket1 of
        #{tokens := 0} ->
            {error, <<"Rate limit exceeded. Please wait before starting another session.">>};
        #{tokens := T} when T > 0 ->
            Buckets = maps:put(UserId, Bucket1#{tokens => T - 1}, State#state.buckets),
            {ok, State#state{buckets = Buckets}}
    end.

-spec refill_bucket(bucket(), integer()) -> bucket().
refill_bucket(#{tokens := T, last_refill := Last} = B, Now) ->
    Elapsed     = Now - Last,
    FullPeriods = Elapsed div ?REFILL_PERIOD,
    case FullPeriods of
        0 ->
            B;
        _ ->
            Added     = FullPeriods * ?REFILL_RATE,
            NewTokens = erlang:min(?BUCKET_CAPACITY, T + Added),
            %% Advance last_refill by whole periods only, preserving
            %% any sub-period elapsed time for the next refill.
            NewLast   = Last + FullPeriods * ?REFILL_PERIOD,
            B#{tokens => NewTokens, last_refill => NewLast}
    end.

-spec new_session(user_id(), non_neg_integer(), integer()) -> session().
new_session(UserId, DurationMinutes, Now) ->
    #{
        id          => make_session_id(UserId, Now),
        user_id     => UserId,
        title       => <<"Focus Session">>,
        duration_ms => DurationMinutes * 60_000,
        started_at  => Now,
        elapsed_ms  => 0,
        status      => active
    }.

%% @doc Compute total active elapsed milliseconds for a session at `Now'.
%% Only counts time since `started_at' when the session is currently
%% active; paused sessions already have their elapsed_ms frozen.
-spec compute_elapsed(session(), integer()) -> non_neg_integer().
compute_elapsed(#{status := active, started_at := StartedAt, elapsed_ms := Elapsed}, Now) ->
    Elapsed + max(0, Now - StartedAt);
compute_elapsed(#{elapsed_ms := Elapsed}, _Now) ->
    Elapsed.

-spec make_session_id(user_id(), integer()) -> session_id().
make_session_id(UserId, Now) ->
    Context = <<UserId/binary, Now:64, (crypto:strong_rand_bytes(8))/binary>>,
    Hash    = crypto:hash(sha, Context),
    <<"sess_", (base64:encode(Hash))/binary>>.

-spec record_analytics(session(), non_neg_integer()) -> ok.
record_analytics(#{user_id := UserId, title := Title}, ElapsedMs) ->
    Minutes = ElapsedMs div 60_000,
    try
        helpy_focus_analytics:record_session(UserId, Title, Minutes)
    catch
        Class:Reason ->
            error_logger:warning_msg(
                "~p: analytics record_session failed: ~p:~p~n",
                [?MODULE, Class, Reason]),
            ok
    end.

-spec build_node_info(#state{}) -> map().
build_node_info(State) ->
    MemInfo =
        try
            {Total, Allocated, _} = memsup:get_memory_data(),
            #{
                total_memory_mb     => Total div (1024 * 1024),
                allocated_memory_mb => Allocated div (1024 * 1024)
            }
        catch
            _:_ ->
                #{
                    total_memory_mb     => null,
                    allocated_memory_mb => null
                }
        end,
    MemInfo#{
        node            => atom_to_binary(node(), utf8),
        otp_release     => list_to_binary(erlang:system_info(otp_release)),
        process_count   => erlang:system_info(process_count),
        scheduler_count => erlang:system_info(schedulers_online),
        uptime_seconds  => element(1, erlang:statistics(wall_clock)) div 1000,
        active_sessions => maps:size(State#state.sessions)
    }.