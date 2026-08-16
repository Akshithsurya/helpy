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
-export([init/1, handle_call/3, handle_cast/2, handle_info/2, terminate/2, code_change/3]).

%% Internal exports (for spawned HTTP worker)
-export([do_http_post/2]).

-define(SERVER, ?MODULE).
-define(SESSION_EXPIRED, session_expired).
-define(DEFAULT_NOTIFY_URL, "http://localhost:4567/api/sessions").
-define(HTTP_TIMEOUT, 5000).
-define(HTTP_CONNECT_TIMEOUT, 2000).

-define(VALID_DAYS,
    [<<"mon">>, <<"tue">>, <<"wed">>, <<"thu">>, <<"fri">>, <<"sat">>, <<"sun">>]).

-type day_name() :: <<"mon">> | <<"tue">> | <<"wed">> | <<"thu">>
                  | <<"fri">> | <<"sat">> | <<"sun">>.
-type hh_mm() :: binary().   % e.g. <<"09:30">>
-type session_status() :: active | stopped | expired | terminated.

-type rule() :: #{
    id := binary(),
    name := binary(),
    category := binary(),
    days := [day_name()],
    start_time := hh_mm(),
    end_time := hh_mm(),
    blocked_urls := [binary()],
    blocked_apps := [binary()]
}.

-type session() :: #{
    id := binary(),
    title := binary(),
    duration_minutes := pos_integer(),
    start_time := integer(),   % ms since epoch
    end_time := integer(),     % ms since epoch
    status := session_status()
}.

-type options() :: #{
    schedule => [rule()],
    notify_url => string()
}.

-record(state, {
    schedule = [] :: [rule()],
    active_session = undefined :: session() | undefined,
    session_timer = undefined :: timer:tref() | undefined,
    notify_url = ?DEFAULT_NOTIFY_URL :: string()
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

-spec init(options()) -> {ok, #state{}} | {stop, term()}.
init(Options) when is_map(Options) ->
    Schedule0 = maps:get(schedule, Options, [default_rule()]),
    NotifyUrl = maps:get(notify_url, Options, ?DEFAULT_NOTIFY_URL),
    case validate_schedule(Schedule0) of
        ok ->
            {ok, #state{schedule = Schedule0, notify_url = NotifyUrl}};
        {error, Reason} ->
            logger:error("[helpy_sync_server] invalid initial schedule: ~p", [Reason]),
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
            logger:warning("[helpy_sync_server] schedule rejected: ~p", [Reason]),
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
  when not is_integer(Duration); Duration =< 0 ->
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
    logger:warning("[helpy_sync_server] unknown call: ~p", [Request]),
    {reply, {error, unknown_request}, State}.

handle_cast(Msg, State) ->
    logger:warning("[helpy_sync_server] unexpected cast: ~p", [Msg]),
    {noreply, State}.

handle_info({?SESSION_EXPIRED, SessionId},
            #state{active_session = #{id := SessionId} = Session} = State) ->
    Expired = Session#{status => expired},
    notify_session_event(expired, Expired, State#state.notify_url),
    {noreply, State#state{active_session = undefined, session_timer = undefined}};

handle_info({?SESSION_EXPIRED, StaleId}, State) ->
    logger:info("[helpy_sync_server] ignoring stale session expiry: ~p", [StaleId]),
    {noreply, State};

handle_info(Info, State) ->
    logger:warning("[helpy_sync_server] unexpected info: ~p", [Info]),
    {noreply, State}.

terminate(Reason, #state{session_timer   = TimerRef,
                         active_session  = Session,
                         notify_url      = Url}) ->
    ok = cancel_timer(TimerRef),
    case Session of
        undefined -> ok;
        _         -> notify_session_event(terminated, Session#{status => terminated}, Url)
    end,
    case Reason of
        normal   -> ok;
        shutdown -> ok;
        _        -> logger:error("[helpy_sync_server] terminating: ~p", [Reason])
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
    Ts = erlang:system_time(nanosecond),
    Uniq = erlang:unique_integer([positive, monotonic]),
    <<(integer_to_binary(Ts))/binary, $-,
      (integer_to_binary(Uniq))/binary>>.

-spec schedule_session_expiry(pos_integer(), binary()) -> timer:tref().
schedule_session_expiry(DurationMinutes, SessionId) ->
    TimeoutMs = DurationMinutes * 60 * 1000,
    {ok, TimerRef} = timer:send_after(TimeoutMs, {?SESSION_EXPIRED, SessionId}),
    TimerRef.

-spec cancel_timer(timer:tref() | undefined) -> ok.
cancel_timer(undefined) -> ok;
cancel_timer(TimerRef) ->
    _ = timer:cancel(TimerRef),
    ok.

%%%===================================================================
%%% Internal functions - Schedule evaluation
%%%===================================================================

-spec current_evaluated_rules([rule()]) -> [rule()].
current_evaluated_rules(Schedule) ->
    {DayOfWeek, CurrentMins} = current_day_and_minutes(),
    lists:filter(fun(R) -> rule_active_now(R, DayOfWeek, CurrentMins) end, Schedule).

-spec rule_active_now(rule(), day_name(), non_neg_integer()) -> boolean().
rule_active_now(Rule, DayOfWeek, CurrentMins) ->
    lists:member(DayOfWeek, maps:get(days, Rule, []))
        andalso CurrentMins >= parse_time(maps:get(start_time, Rule, <<"00:00">>))
        andalso CurrentMins =< parse_time(maps:get(end_time,   Rule, <<"23:59">>)).

-spec current_day_and_minutes() -> {day_name(), non_neg_integer()}.
current_day_and_minutes() ->
    {{Year, Month, Day}, {Hour, Minute, _}} = calendar:local_time(),
    {day_name(calendar:day_of_the_week(Year, Month, Day)), Hour * 60 + Minute}.

-spec day_name(1..7) -> day_name().
day_name(1) -> <<"mon">>;
day_name(2) -> <<"tue">>;
day_name(3) -> <<"wed">>;
day_name(4) -> <<"thu">>;
day_name(5) -> <<"fri">>;
day_name(6) -> <<"sat">>;
day_name(7) -> <<"sun">>.

-spec parse_time(hh_mm()) -> non_neg_integer().
parse_time(<<H1, H2, $:, M1, M2>>)
    when H1 >= $0, H1 =< $2, H2 >= $0, H2 =< $9,
         M1 >= $0, M1 =< $5, M2 >= $0, M2 =< $9 ->
    Hours   = (H1 - $0) * 10 + (H2 - $0),
    Minutes = (M1 - $0) * 10 + (M2 - $0),
    case Hours =< 23 andalso Minutes =< 59 of
        true  -> Hours * 60 + Minutes;
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
                error    -> throw({invalid_rule, {missing_key, Key}});
                {ok, V}  -> Pred(V) orelse throw({invalid_rule, {invalid_value, Key, V}})
            end
        end, Checks),
    case parse_time(maps:get(start_time, Rule)) =< parse_time(maps:get(end_time, Rule)) of
        true  -> ok;
        false -> throw({invalid_rule, start_after_end})
    end.

-spec valid_days(term()) -> boolean().
valid_days(Days) when is_list(Days), length(Days) > 0 ->
    lists:all(fun(D) -> lists:member(D, ?VALID_DAYS) end, Days);
valid_days(_) -> false.

-spec valid_time(term()) -> boolean().
valid_time(B) when is_binary(B), byte_size(B) =:= 5 ->
    case B of
        <<H1, H2, $:, M1, M2>> ->
            (H1 >= $0 andalso H1 =< $2) andalso
            (H2 >= $0 andalso H2 =< $9) andalso
            (M1 >= $0 andalso M1 =< $5) andalso
            (M2 >= $0 andalso M2 =< $9) andalso
            ((H1 - $0) * 10 + (H2 - $0)) =< 23;
        _ -> false
    end;
valid_time(_) -> false.

-spec is_list_of_binaries(term()) -> boolean().
is_list_of_binaries(L) when is_list(L) -> lists:all(fun is_binary/1, L);
is_list_of_binaries(_) -> false.

%%%===================================================================
%%% Internal functions - Notification
%%%===================================================================

-spec notify_session_event(atom(), session(), string()) -> ok.
notify_session_event(EventType, Session, Url) ->
    Body = encode_session_event(EventType, Session),
    spawn(?MODULE, do_http_post, [Url, Body]),
    ok.

-spec do_http_post(string(), binary()) -> ok.
do_http_post(Url, Body) ->
    try
        ensure_inets_started(),
        Opts = [{timeout, ?HTTP_TIMEOUT}, {connect_timeout, ?HTTP_CONNECT_TIMEOUT}],
        case httpc:request(post, {Url, [], "application/json", Body}, Opts, []) of
            {ok, {{_, Code, _}, _Headers, _Resp}} when Code >= 200, Code < 300 ->
                ok;
            {ok, {{_, Code, _}, _Headers, _Resp}} ->
                logger:warning("[helpy_sync_server] HTTP ~p from ~s", [Code, Url]),
                ok;
            {error, Reason} ->
                logger:warning("[helpy_sync_server] HTTP error: ~p", [Reason]),
                ok
        end
    catch
        Class:Reason:Stack ->
            logger:warning("[helpy_sync_server] HTTP failure ~p:~p ~p",
                           [Class, Reason, Stack]),
            ok
    end.

-spec ensure_inets_started() -> ok.
ensure_inets_started() ->
    case inets:start(httpc, []) of
        ok                          -> ok;
        {error, {already_started,_}} -> ok;
        {error, _}                  -> ok
    end.

-spec event_to_binary(atom()) -> binary().
event_to_binary(started)    -> <<"start">>;
event_to_binary(stopped)    -> <<"stop">>;
event_to_binary(expired)    -> <<"expired">>;
event_to_binary(terminated) -> <<"terminated">>.

-spec encode_session_event(atom(), session()) -> binary().
encode_session_event(EventType, Session) ->
    Map = #{
        event             => event_to_binary(EventType),
        session_id        => maps:get(id, Session, <<"">>),
        title             => maps:get(title, Session, <<"">>),
        duration_minutes  => maps:get(duration_minutes, Session, 0),
        timestamp         => maps:get(start_time, Session, 0)
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
    Event    = escape_json_string(maps:get(event, Map, <<"">>)),
    SessId   = escape_json_string(maps:get(session_id, Map, <<"">>)),
    Title    = escape_json_string(maps:get(title, Map, <<"">>)),
    Duration = maps:get(duration_minutes, Map, 0),
    Ts       = maps:get(timestamp, Map, 0),
    iolist_to_binary(io_lib:format(
        "{\"event\":\"~s\",\"session_id\":\"~s\",\"title\":\"~s\","
        "\"duration_minutes\":~p,\"timestamp\":~p}",
        [Event, SessId, Title, Duration, Ts])).

-spec escape_json_string(binary()) -> binary().
escape_json_string(Bin) when is_binary(Bin) ->
    B1 = binary:replace(Bin, <<"\\">>, <<"\\\\">>, [global]),
    binary:replace(B1, <<"\"">>, <<"\\\"">>, [global]);
escape_json_string(_) ->
    <<"">>.