%% @doc Helpy Session Manager
%%
%% An OTP gen_server that tracks active focus sessions per user.
%% Implements a token-bucket rate limiter in pure Erlang to prevent
%% session-spam and protect system resources.
%%
%% API:
%%   start_session/2  - begin a focus session for UserId with DurationMinutes
%%   end_session/1    - complete or cancel a running session
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
-type status()     :: active | paused | completed | cancelled.

-type session() :: #{
    id              := session_id(),
    user_id         := user_id(),
    title           := binary(),
    duration_ms     := non_neg_integer(),
    started_at      := integer(),
    paused_at       => integer(),
    resumed_at      => integer(),
    ended_at        => integer(),
    elapsed_ms      := non_neg_integer(),
    status          := status()
}.

-type bucket() :: #{
    tokens     := non_neg_integer(),
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
start_session(UserId, DurationMinutes) when is_binary(UserId), is_integer(DurationMinutes) ->
    gen_server:call(?SERVER, {start_session, UserId, DurationMinutes}).

%% @doc End (complete) a session for UserId.
-spec end_session(user_id()) -> {ok, session()} | {error, binary()}.
end_session(UserId) ->
    gen_server:call(?SERVER, {end_session, UserId, completed}).

%% @doc Pause an active session.
-spec pause_session(user_id()) -> {ok, session()} | {error, binary()}.
pause_session(UserId) ->
    gen_server:call(?SERVER, {pause_session, UserId}).

%% @doc Resume a paused session.
-spec resume_session(user_id()) -> {ok, session()} | {error, binary()}.
resume_session(UserId) ->
    gen_server:call(?SERVER, {resume_session, UserId}).

%% @doc Retrieve status of a session keyed by UserId.
-spec session_status(user_id()) -> {ok, session()} | {error, binary()}.
session_status(UserId) ->
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
    %% Schedule periodic token refill
    erlang:send_after(?REFILL_PERIOD, self(), refill_tokens),
    {ok, #state{}}.

-spec handle_call(term(), {pid(), term()}, #state{}) ->
    {reply, term(), #state{}}.

handle_call({start_session, UserId, DurationMinutes}, _From, State) ->
    Now = erlang:system_time(millisecond),
    Bucket = get_bucket(UserId, State#state.buckets, Now),
    case Bucket of
        #{tokens := 0} ->
            {reply, {error, <<"Rate limit exceeded. Please wait before starting another session.">>}, State};
        #{tokens := T} = B ->
            NewBucket = B#{tokens => T - 1},
            SessionId = make_session_id(UserId, Now),
            Session = #{
                id           => SessionId,
                user_id      => UserId,
                title        => <<"Focus Session">>,
                duration_ms  => DurationMinutes * 60_000,
                started_at   => Now,
                elapsed_ms   => 0,
                status       => active
            },
            NewSessions = maps:put(UserId, Session, State#state.sessions),
            NewBuckets  = maps:put(UserId, NewBucket, State#state.buckets),
            {reply, {ok, Session},
             State#state{sessions = NewSessions, buckets = NewBuckets}}
    end;

handle_call({end_session, UserId, EndStatus}, _From, State) ->
    Now = erlang:system_time(millisecond),
    case maps:find(UserId, State#state.sessions) of
        error ->
            {reply, {error, <<"No active session found.">>}, State};
        {ok, Session} ->
            StartedAt = maps:get(started_at, Session),
            Elapsed   = maps:get(elapsed_ms, Session, 0) + (Now - StartedAt),
            Updated   = Session#{
                status    => EndStatus,
                ended_at  => Now,
                elapsed_ms => Elapsed
            },
            NewSessions = maps:remove(UserId, State#state.sessions),
            %% Archive completed session in analytics
            helpy_focus_analytics:record_session(
                UserId,
                maps:get(title, Session),
                Elapsed div 60_000),
            {reply, {ok, Updated}, State#state{sessions = NewSessions}}
    end;

handle_call({pause_session, UserId}, _From, State) ->
    Now = erlang:system_time(millisecond),
    case maps:find(UserId, State#state.sessions) of
        error ->
            {reply, {error, <<"No active session found.">>}, State};
        {ok, #{status := active} = Session} ->
            StartedAt = maps:get(started_at, Session),
            Elapsed   = maps:get(elapsed_ms, Session, 0) + (Now - StartedAt),
            Updated   = Session#{status => paused, paused_at => Now, elapsed_ms => Elapsed},
            NewSessions = maps:put(UserId, Updated, State#state.sessions),
            {reply, {ok, Updated}, State#state{sessions = NewSessions}};
        {ok, Session} ->
            {reply, {error, <<"Session is not active.">>}, State#state{sessions =
                maps:put(UserId, Session, State#state.sessions)}}
    end;

handle_call({resume_session, UserId}, _From, State) ->
    Now = erlang:system_time(millisecond),
    case maps:find(UserId, State#state.sessions) of
        error ->
            {reply, {error, <<"No session found.">>}, State};
        {ok, #{status := paused} = Session} ->
            Updated = Session#{
                status      => active,
                started_at  => Now,
                resumed_at  => Now
            },
            NewSessions = maps:put(UserId, Updated, State#state.sessions),
            {reply, {ok, Updated}, State#state{sessions = NewSessions}};
        {ok, Session} ->
            {reply, {error, <<"Session is not paused.">>}, State#state{sessions =
                maps:put(UserId, Session, State#state.sessions)}}
    end;

handle_call({session_status, UserId}, _From, State) ->
    case maps:find(UserId, State#state.sessions) of
        {ok, Session} -> {reply, {ok, Session}, State};
        error         -> {reply, {error, <<"No session found.">>}, State}
    end;

handle_call(list_sessions, _From, State) ->
    Active = maps:values(State#state.sessions),
    {reply, Active, State};

handle_call(node_info, _From, State) ->
    {TotalMem, AllocatedMem, _} = memsup:get_memory_data(),
    Info = #{
        node          => atom_to_binary(node(), utf8),
        otp_release   => list_to_binary(erlang:system_info(otp_release)),
        process_count => erlang:system_info(process_count),
        scheduler_count => erlang:system_info(schedulers_online),
        total_memory_mb  => TotalMem div (1024 * 1024),
        allocated_memory_mb => AllocatedMem div (1024 * 1024),
        uptime_seconds   => element(1, erlang:statistics(wall_clock)) div 1000,
        active_sessions  => maps:size(State#state.sessions)
    },
    {reply, Info, State};

handle_call(_Request, _From, State) ->
    {reply, {error, <<"Unknown request">>}, State}.

-spec handle_cast(term(), #state{}) -> {noreply, #state{}}.
handle_cast(_Msg, State) ->
    {noreply, State}.

-spec handle_info(term(), #state{}) -> {noreply, #state{}}.
handle_info(refill_tokens, State) ->
    Now     = erlang:system_time(millisecond),
    Buckets = maps:map(fun(_UserId, Bucket) ->
        refill_bucket(Bucket, Now)
    end, State#state.buckets),
    erlang:send_after(?REFILL_PERIOD, self(), refill_tokens),
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

-spec get_bucket(user_id(), map(), integer()) -> bucket().
get_bucket(UserId, Buckets, Now) ->
    Default = #{tokens => ?BUCKET_CAPACITY, last_refill => Now},
    Bucket  = maps:get(UserId, Buckets, Default),
    refill_bucket(Bucket, Now).

-spec refill_bucket(bucket(), integer()) -> bucket().
refill_bucket(#{tokens := T, last_refill := Last} = B, Now) ->
    Elapsed  = Now - Last,
    NewT     = min(?BUCKET_CAPACITY, T + (Elapsed div ?REFILL_PERIOD) * ?REFILL_RATE),
    B#{tokens => NewT, last_refill => Now}.

-spec make_session_id(user_id(), integer()) -> session_id().
make_session_id(UserId, Now) ->
    Hash = integer_to_binary(erlang:phash2({UserId, Now}), 16),
    <<"sess_", Hash/binary>>.
