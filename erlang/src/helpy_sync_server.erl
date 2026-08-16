-module(helpy_sync_server).
-behaviour(gen_server).

%% API
-export([
    start_link/0,
    start_link/1,
    get_schedule/0,
    set_schedule/1,
    get_session_state/0,
    start_session/2,
    stop_session/0,
    evaluate_rules/0
]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

%% Internal export for the spawned HTTP worker.
-export([do_http_post/3]).

-define(SERVER, ?MODULE).
-define(DEFAULT_NOTIFY_URL, "http://localhost:4567/api/sessions").
-define(HTTP_TIMEOUT, 5000).
-define(HTTP_CONNECT_TIMEOUT, 2000).
-define(MAX_SESSION_MINUTES, 24 * 60).   % 24h hard cap
-define(MINUTES_PER_DAY, 1440).

-define(DAY_NAMES,
        {<<"mon">>, <<"tue">>, <<"wed">>, <<"thu">>,
         <<"fri">>, <<"sat">>, <<"sun">>}).

-define(VALID_DAYS, element_tuple_to_list(?DAY_NAMES)).

%% ------------------------------------------------------------------
%% Types
%% ------------------------------------------------------------------

-type day_name() :: <<"mon">> | <<"tue">> | <<"wed">> | <<"thu">>
                  | <<"fri">> | <<"sat">> | <<"sun">>.
-type hh_mm()    :: binary().   % <<"HH:MM">>, 24h clock
-type session_status() :: active | stopped | expired | terminated.

-type rule() :: #{
    id           := binary(),
    name         := binary(),
    category     := binary(),
    days         := [day_name()],
    start_time   := hh_mm(),
    end_time     := hh_mm(),
    blocked_urls := [binary()],
    blocked_apps := [binary()]
}.

-type session() :: #{
    id               := binary(),
    title            := binary(),
    duration_minutes := pos_integer(),
    start_time       := integer(),
    end_time         := integer(),
    status           := session_status()
}.

-type options() :: #{
    schedule   => [rule()],
    notify_url => string()
}.

-type state() :: #state{
    schedule       :: [rule()],
    active_session :: session() | undefined,
    session_timer  :: reference() | undefined,
    notify_url     :: string()
}.

-record(state, {
    schedule       = []              :: [rule()],
    active_session = undefined       :: session() | undefined,
    session_timer  = undefined       :: reference() | undefined,
    notify_url     = ?DEFAULT_NOTIFY_URL :: string()
}).

%%%===================================================================
%%% API
%%%===================================================================

-spec start_link() -> gen_server:start_ret().
start_link() ->
    start_link(#{}).

-spec start_link(options()) -> gen_server:start_ret().
start_link(Options) when is_map(Options) ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, Options, []).

-spec get_schedule() -> {ok, [rule()]}.
get_schedule() ->
    gen_server:call(?SERVER, get_schedule).

-spec set_schedule([rule()]) -> ok | {error, term()}.
set_schedule(Schedule) ->
    gen_server:call(?SERVER, {set_schedule, Schedule}).

-spec get_session_state() -> {ok, map()}.
get_session_state() ->
    gen_server:call(?SERVER, get_session_state).

-spec start_session(binary(), pos_integer()) -> {ok, session()} | {error, term()}.
start_session(Title, DurationMinutes) ->
    gen_server:call(?SERVER, {start_session, Title, DurationMinutes}).

-spec stop_session() -> {ok, session()} | {error, no_active_session}.
stop_session() ->
    gen_server:call(?SERVER, stop_session).

-spec evaluate_rules() -> {ok, [rule()]}.
evaluate_rules() ->
    gen_server:call(?SERVER, evaluate_rules).

%%%===================================================================
%%% gen_server callbacks
%%%===================================================================

-spec init(options()) -> {ok, state()} | {stop, term()}.
init(Options) when is_map(Options) ->
    Schedule0 = maps:get(schedule, Options, [default_rule()]),
    NotifyUrl = maps:get(notify_url, Options, ?DEFAULT_NOTIFY_URL),
    ok = ensure_inets_started(),
    case validate_schedule(Schedule0) of
        ok ->
            {ok, #state{schedule = Schedule0, notify_url = NotifyUrl}};
        {error, Reason} ->
            logger:error(#{what => invalid_initial_schedule, reason => Reason}),
            {stop, {invalid_schedule, Reason}}
    end;
init(Options) ->
    {stop, {badarg, Options}}.

handle_call(get_schedule, _From, State) ->
    {reply, {ok, State#state.schedule}, State};

handle_call({set_schedule, NewSchedule}, _From, State) ->
    case validate_schedule(NewSchedule) of
        ok ->
            {reply, ok, State#state{schedule = NewSchedule}};
        {error, Reason} = Err ->
            logger:warning(#{what => schedule_rejected, reason => Reason}),
            {reply, Err, State}
    end;

handle_call(get_session_state, _From, State) ->
    ActiveRules = current_evaluated_rules(State#state.schedule),
    Resp = #{
        active_session     => State#state.active_session,
        active_rules       => ActiveRules,
        is_blocking_active => State#state.active_session =/= undefined
                              orelse ActiveRules =/= []
    },
    {reply, {ok, Resp}, State};

handle_call({start_session, _Title, _Duration}, _From,
            #state{active_session = S} = State) when S =/= undefined ->
    {reply, {error, session_already_active}, State};

handle_call({start_session, _Title, Duration}, _From,
            #state{active_session = undefined} = State)
  when not is_integer(Duration); Duration =< 0; Duration > ?MAX_SESSION_MINUTES ->
    {reply, {error, invalid_duration}, State};

handle_call({start_session, Title, DurationMinutes}, _From,
            #state{active_session = undefined} = State) ->
    Session = create_session(Title, DurationMinutes),
    TimerRef = schedule_session_expiry(DurationMinutes, maps:get(id, Session)),
    notify_session_event(started, Session, State#state.notify_url),
    {reply, {ok, Session},
     State#state{active_session = Session, session_timer = TimerRef}};

handle_call(stop_session, _From, #state{active_session = undefined} = State) ->
    {reply, {error, no_active_session}, State};

handle_call(stop_session, _From,
            #state{active_session = Session, session_timer = TimerRef} = State) ->
    ok = cancel_timer(TimerRef),
    Stopped = Session#{status => stopped},
    notify_session_event(stopped, Stopped, State#state.notify_url),
    {reply, {ok, Stopped},
     State#state{active_session = undefined, session_timer = undefined}};

handle_call(evaluate_rules, _From, State) ->
    {reply, {ok, current_evaluated_rules(State#state.schedule)}, State};

handle_call(Request, _From, State) ->
    logger:warning(#{what => unknown_call, request => Request}),
    {reply, {error, unknown_request}, State}.

handle_cast(Msg, State) ->
    logger:warning(#{what => unexpected_cast, msg => Msg}),
    {noreply, State}.

handle_info({session_expired, SessionId},
            #state{active_session = #{id := SessionId} = Session} = State) ->
    Expired = Session#{status => expired},
    notify_session_event(expired, Expired, State#state.notify_url),
    {noreply, State#state{active_session = undefined,
                          session_timer   = undefined}};

handle_info({session_expired, StaleId}, State) ->
    logger:info(#{what => stale_session_expiry, session_id => StaleId}),
    {noreply, State};

handle_info(Info, State) ->
    logger:warning(#{what => unexpected_info, info => Info}),
    {noreply, State}.

-spec terminate(term(), state()) -> ok.
terminate(Reason, #state{session_timer  = TimerRef,
                         active_session = Session,
                         notify_url     = Url}) ->
    ok = cancel_timer(TimerRef),
    case Session of
        undefined ->
            ok;
        _ ->
            %% Fire-and-forget so terminate isn't blocked.
            notify_session_event(terminated,
                                 Session#{status => terminated}, Url)
    end,
    case Reason of
        normal   -> ok;
        shutdown -> ok;
        _        -> logger:error(#{what => terminating, reason => Reason})
    end,
    ok.

code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

%%%===================================================================
%%% Internal functions - Session
%%%===================================================================

-spec default_rule() -> rule().
default_rule() ->
    #{
        id           => <<"rule_default_1">>,
        name         => <<"Block Social Media 9-5 Weekdays">>,
        category     => <<"social_media">>,
        days         => [<<"mon">>, <<"tue">>, <<"wed">>, <<"thu">>, <<"fri">>],
        start_time   => <<"09:00">>,
        end_time     => <<"17:00">>,
        blocked_urls => [<<"facebook.com">>, <<"twitter.com">>, <<"x.com">>,
                         <<"instagram.com">>, <<"reddit.com">>, <<"tiktok.com">>],
        blocked_apps => [<<"chrome">>, <<"firefox">>, <<"msedge">>]
    }.

-spec create_session(binary(), pos_integer()) -> session().
create_session(Title, DurationMinutes) ->
    NowMs = erlang:system_time(millisecond),
    #{
        id               => generate_session_id(),
        title            => Title,
        duration_minutes => DurationMinutes,
        start_time       => NowMs,
        end_time         => NowMs + DurationMinutes * 60 * 1000,
        status           => active
    }.

-spec generate_session_id() -> binary().
generate_session_id() ->
    Ts   = erlang:system_time(nanosecond),
    Uniq = erlang:unique_integer([positive, monotonic]),
    Rand = crypto:strong_rand_bytes(4),
    <<(integer_to_binary(Ts))/binary, $-,
      (integer_to_binary(Uniq))/binary, $-,
      (base64:encode(Rand, #{mode => urlsafe, padding => false}))/binary>>.

-spec schedule_session_expiry(pos_integer(), binary()) -> reference().
schedule_session_expiry(DurationMinutes, SessionId) ->
    TimeoutMs = DurationMinutes * 60 * 1000,
    erlang:send_after(TimeoutMs, self(), {session_expired, SessionId}).

-spec cancel_timer(reference() | undefined) -> ok.
cancel_timer(undefined) -> ok;
cancel_timer(TimerRef) ->
    _ = erlang:cancel_timer(TimerRef),
    ok.

%%%===================================================================
%%% Internal functions - Schedule evaluation
%%%===================================================================

-spec current_evaluated_rules([rule()]) -> [rule()].
current_evaluated_rules(Schedule) ->
    {DayOfWeek, CurrentMins} = current_day_and_minutes(),
    [R || R <- Schedule, rule_active_now(R, DayOfWeek, CurrentMins)].

-spec rule_active_now(rule(), day_name(), non_neg_integer()) -> boolean().
rule_active_now(Rule, DayOfWeek, CurrentMins) ->
    lists:member(DayOfWeek, maps:get(days, Rule, []))
        andalso CurrentMins >= parse_time(maps:get(start_time, Rule, <<"00:00">>))
        andalso CurrentMins =< parse_time(maps:get(end_time,   Rule, <<"23:59">>)).

-spec current_day_and_minutes() -> {day_name(), non_neg_integer()}.
current_day_and_minutes() ->
    {{Year, Month, Day}, {Hour, Minute, _}} = calendar:local_time(),
    Dow = calendar:day_of_the_week(Year, Month, Day),
    {element(Dow, ?DAY_NAMES), Hour * 60 + Minute}.

-spec parse_time(hh_mm()) -> non_neg_integer().
parse_time(<<H1, H2, $:, M1, M2>>) ->
    case valid_time_chars(H1, H2, M1, M2) of
        true  -> ((H1 - $0) * 10 + (H2 - $0)) * 60 + (M1 - $0) * 10 + (M2 - $0);
        false -> 0
    end;
parse_time(_) ->
    0.

%%%===================================================================
%%% Internal functions - Validation
%%%===================================================================

-spec validate_schedule(term()) -> ok | {error, term()}.
validate_schedule(Schedule) when is_list(Schedule) ->
    try
        lists:foreach(fun validate_rule/1, Schedule),
        ok
    catch
        throw:{invalid_rule, Reason} -> {error, Reason}
    end;
validate_schedule(_) ->
    {error, invalid_schedule_type}.

-spec validate_rule(term()) -> ok.
validate_rule(Rule) when not is_map(Rule) ->
    throw({invalid_rule, not_a_map});
validate_rule(Rule) ->
    Checks = [
        {id,           fun is_binary/1},
        {name,         fun is_binary/1},
        {category,     fun is_binary/1},
        {days,         fun valid_days/1},
        {start_time,   fun valid_time/1},
        {end_time,     fun valid_time/1},
        {blocked_urls, fun is_list_of_binaries/1},
        {blocked_apps, fun is_list_of_binaries/1}
    ],
    lists:foreach(
      fun({Key, Pred}) ->
              case maps:find(Key, Rule) of
                  error   -> throw({invalid_rule, {missing_key, Key}});
                  {ok, V} -> Pred(V) orelse throw({invalid_rule, {invalid_value, Key, V}})
              end
      end, Checks),
    Start = parse_time(maps:get(start_time, Rule)),
    End   = parse_time(maps:get(end_time,   Rule)),
    case Start =< End of
        true  -> ok;
        false -> throw({invalid_rule, start_after_end})
    end.

-spec valid_days(term()) -> boolean().
valid_days([]) -> false;
valid_days([H | _] = Days) when is_list(Days) ->
    lists:all(fun(D) -> lists:member(D, ?VALID_DAYS) end, Days);
valid_days(_) -> false.

-spec valid_time(term()) -> boolean().
valid_time(<<H1, H2, $:, M1, M2>>) -> valid_time_chars(H1, H2, M1, M2);
valid_time(_)                     -> false.

-spec valid_time_chars(byte(), byte(), byte(), byte()) -> boolean().
valid_time_chars(H1, H2, M1, M2) ->
    H1 >= $0 andalso H1 =< $2 andalso
    H2 >= $0 andalso H2 =< $9 andalso
    M1 >= $0 andalso M1 =< $5 andalso
    M2 >= $0 andalso M2 =< $9 andalso
    ((H1 - $0) * 10 + (H2 - $0)) =< 23.

-spec is_list_of_binaries(term()) -> boolean().
is_list_of_binaries([])              -> true;
is_list_of_binaries([H | _] = L) when is_list(L) ->
    lists:all(fun is_binary/1, L);
is_list_of_binaries(_) -> false.

%%%===================================================================
%%% Internal functions - Notification
%%%===================================================================

-spec notify_session_event(atom(), session(), string()) -> ok.
notify_session_event(EventType, Session, Url) ->
    Body = encode_session_event(EventType, Session),
    _ = spawn(?MODULE, do_http_post, [Url, Body, EventType]),
    ok.

-spec do_http_post(string(), binary(), atom()) -> ok.
do_http_post(Url, Body, EventType) ->
    try
        Opts = [{timeout,         ?HTTP_TIMEOUT},
                {connect_timeout, ?HTTP_CONNECT_TIMEOUT},
                {autoredirect,    true}],
        Req  = {Url, [{"content-type", "application/json"}], "application/json", Body},
        case httpc:request(post, Req, Opts, [{body_format, binary}]) of
            {ok, {{_, Code, _}, _Headers, _Resp}} when Code >= 200, Code < 300 ->
                logger:debug(#{what => http_post_ok, event => EventType, code => Code});
            {ok, {{_, Code, _}, _Headers, _Resp}} ->
                logger:warning(#{what => http_post_non_2xx, event => EventType,
                                 code => Code, url => Url});
            {error, Reason} ->
                logger:warning(#{what => http_post_error, event => EventType, reason => Reason})
        end
    catch
        Class:Reason:Stack ->
            logger:warning(#{what => http_post_failure, event => EventType,
                             class => Class, reason => Reason, stack => Stack})
    end,
    ok.

-spec ensure_inets_started() -> ok.
ensure_inets_started() ->
    case inets:start(httpc, []) of
        ok                           -> ok;
        {error, {already_started, _}} -> ok;
        {error, _}                   -> ok
    end.

-spec event_to_binary(atom()) -> binary().
event_to_binary(started)    -> <<"start">>;
event_to_binary(stopped)    -> <<"stop">>;
event_to_binary(expired)    -> <<"expired">>;
event_to_binary(terminated) -> <<"terminated">>.

-spec encode_session_event(atom(), session()) -> binary().
encode_session_event(EventType, Session) ->
    Map = #{
        event            => event_to_binary(EventType),
        session_id       => maps:get(id, Session, <<"">>),
        title            => maps:get(title, Session, <<"">>),
        duration_minutes => maps:get(duration_minutes, Session, 0),
        timestamp        => maps:get(start_time, Session, 0)
    },
    json_encode(Map).

-spec json_encode(map()) -> binary().
json_encode(Map) ->
    case code:ensure_loaded(jsone) of
        {module, jsone} -> jsone:encode(Map);
        _               -> fallback_json_encode(Map)
    end.

-spec fallback_json_encode(map()) -> binary().
fallback_json_encode(Map) ->
    Fields = [
        {<<"event">>,            escape_json_string(maps:get(event,            Map, <<"">>))},
        {<<"session_id">>,       escape_json_string(maps:get(session_id,       Map, <<"">>))},
        {<<"title">>,            escape_json_string(maps:get(title,            Map, <<"">>))},
        {<<"duration_minutes">>, integer_to_binary(maps:get(duration_minutes, Map, 0))},
        {<<"timestamp">>,        integer_to_binary(maps:get(timestamp,        Map, 0))}
    ],
    Inner = [[Key, $:, Value]
             || {Key, Value} <- Fields],
    iolist_to_binary([${, lists:join($,, Inner), $}]).

-spec escape_json_string(binary()) -> binary().
escape_json_string(Bin) when is_binary(Bin) ->
    B1 = binary:replace(Bin, <<"\\">>, <<"\\\\">>, [global]),
    B2 = binary:replace(B1, <<"\"">>, <<"\\\"">>, [global]),
    <<$", B2/binary, $">>;
escape_json_string(_) ->
    <<"\"\"">>.

%%%===================================================================
%%% Helpers
%%%===================================================================

%% Build the VALID_DAYS list at compile time from the tuple so they
%% can never drift out of sync.
-compile({inline, [element_tuple_to_list/1]}).
-spec element_tuple_to_list(tuple()) -> [term()].
element_tuple_to_list(T) ->
    [element(I, T) || I <- lists:seq(1, tuple_size(T))].