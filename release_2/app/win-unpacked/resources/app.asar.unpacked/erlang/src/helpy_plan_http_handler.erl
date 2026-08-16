-module(helpy_plan_http_handler).
-behaviour(cowboy_handler).

-export([init/2]).
-export_type([handler_fun/0]).

-include_lib("kernel/include/logger.hrl").

%% ---------------------------------------------------------------------------
%% Constants
%% ---------------------------------------------------------------------------

-define(MAX_BODY_SIZE, 1_000_000).
-define(BODY_READ_PERIOD, 5000).
-define(JSON_CONTENT_TYPE, <<"application/json; charset=utf-8">>).
-define(ALLOWED_ORIGINS, [
    <<"http://localhost:3000">>,
    <<"https://helpy.example.com">>
]).

%% HTTP status codes
-define(HTTP_OK, 200).
-define(HTTP_CREATED, 201).
-define(HTTP_NO_CONTENT, 204).
-define(HTTP_BAD_REQUEST, 400).
-define(HTTP_UNAUTHORIZED, 401).
-define(HTTP_FORBIDDEN, 403).
-define(HTTP_NOT_FOUND, 404).
-define(HTTP_PAYLOAD_TOO_LARGE, 413).
-define(HTTP_TOO_MANY_REQUESTS, 429).
-define(HTTP_INTERNAL_ERROR, 500).

%% Plan parameter defaults & bounds
-define(DEFAULT_ARGS, <<>>).
-define(DEFAULT_OPTIONS, #{}).
-define(DEFAULT_TOTAL_MINUTES, 60).
-define(DEFAULT_INTENSITY, 50).
-define(DEFAULT_ENERGY, 50).
-define(DEFAULT_SESSION_TITLE, <<"Focus Session">>).
-define(DEFAULT_SESSION_DURATION, 25).
-define(DEFAULT_PRIORITY, 0).
-define(MIN_SESSION_DURATION, 1).
-define(MAX_SESSION_DURATION, 480).
-define(MIN_DURATION_MINUTES, 5).
-define(MAX_DURATION_MINUTES, 1440).
-define(MIN_INTENSITY, 0).
-define(MAX_INTENSITY, 100).
-define(MIN_ENERGY, 0).
-define(MAX_ENERGY, 100).
-define(MAX_TOTAL_MINUTES, 10080).
-define(MAX_TITLE_LEN, 200).
-define(MAX_DETAIL_LEN, 1000).

%% Authentication
-define(AUTH_HEADER, <<"authorization">>).
-define(BEARER_PREFIX, <<"Bearer ">>).

%% Public endpoints (skip authentication)
-define(PUBLIC_ENDPOINTS, [
    <<"/api/auth/login">>,
    <<"/api/auth/register">>,
    <<"/api/health">>
]).

%% Allowed bot action types
-define(ALLOWED_BOT_TYPES, [
    <<"general">>, <<"focus">>, <<"break">>, <<"social">>, <<"reminder">>
]).

%% ---------------------------------------------------------------------------
%% Types
%% ---------------------------------------------------------------------------

-type handler_result() :: {ok, cowboy_req:req(), term()}.
-type handler_fun() :: fun((map(), cowboy_req:req()) -> cowboy_req:req()).
-type user_id() :: binary() | undefined.
-type status_code() :: 100..599.

%% ---------------------------------------------------------------------------
%% Entry point
%% ---------------------------------------------------------------------------

-spec init(cowboy_req:req(), term()) -> handler_result().
init(Req0, State) ->
    Req1 = handle_cors(Req0),
    case cowboy_req:method(Req1) of
        <<"OPTIONS">> ->
            %% Preflight — reply 204 with CORS headers already set on Req1
            Req2 = cowboy_req:reply(?HTTP_NO_CONTENT, #{}, <<>>, Req1),
            {ok, Req2, State};
        _ ->
            process_request(Req1, State)
    end.

%% ---------------------------------------------------------------------------
%% Request processing
%% ---------------------------------------------------------------------------

-spec process_request(cowboy_req:req(), term()) -> handler_result().
process_request(Req0, State) ->
    Method = cowboy_req:method(Req0),
    Path   = cowboy_req:path(Req0),
    Peer   = cowboy_req:peer(Req0),
    ?LOG_DEBUG(#{event => request_received, method => Method,
                 path => Path, peer => Peer}),
    try
        {UserId, Req1} = authorize(Req0),
        Req2 = route(Method, split_path(Path), UserId, Req1),
        {ok, Req2, State}
    catch
        throw:{http_error, Status, Message} ->
            ?LOG_WARNING(#{event => http_error, status => Status,
                           message => Message, path => Path, method => Method}),
            {ok, error_json(Status, Message, Req0), State};
        Class:Reason:Stacktrace ->
            ?LOG_ERROR(#{event => request_failed, class => Class,
                         reason => Reason, stacktrace => Stacktrace,
                         path => Path, method => Method}),
            {ok, error_json(?HTTP_INTERNAL_ERROR,
                            <<"Internal server error">>, Req0), State}
    end.

%% ---------------------------------------------------------------------------
%% CORS
%% ---------------------------------------------------------------------------

-spec handle_cors(cowboy_req:req()) -> cowboy_req:req().
handle_cors(Req) ->
    Origin = cowboy_req:header(<<"origin">>, Req, <<>>),
    Headers0 = #{
        <<"access-control-allow-methods">> => <<"GET, POST, PUT, DELETE, OPTIONS">>,
        <<"access-control-allow-headers">> => <<"content-type, authorization">>,
        <<"access-control-max-age">>       => <<"86400">>,
        <<"vary">>                         => <<"origin">>
    },
    Headers = case maybe_allowed_origin(Origin) of
        undefined -> Headers0;
        Allowed   -> Headers0#{<<"access-control-allow-origin">> => Allowed}
    end,
    cowboy_req:set_resp_headers(Headers, Req).

-spec maybe_allowed_origin(binary()) -> binary() | undefined.
maybe_allowed_origin(<<>>) ->
    undefined;
maybe_allowed_origin(Origin) ->
    case lists:member(Origin, ?ALLOWED_ORIGINS) of
        true  -> Origin;
        false -> undefined
    end.

%% ---------------------------------------------------------------------------
%% Authentication
%% ---------------------------------------------------------------------------

-spec authorize(cowboy_req:req()) -> {user_id(), cowboy_req:req()}.
authorize(Req) ->
    case lists:member(cowboy_req:path(Req), ?PUBLIC_ENDPOINTS) of
        true  -> {undefined, Req};
        false -> authenticate(Req)
    end.

-spec authenticate(cowboy_req:req()) -> {user_id(), cowboy_req:req()}.
authenticate(Req) ->
    case cowboy_req:header(?AUTH_HEADER, Req) of
        undefined ->
            throw({http_error, ?HTTP_UNAUTHORIZED,
                   <<"Missing authorization token">>});
        AuthHeader ->
            case parse_bearer_token(AuthHeader) of
                {ok, Token} ->
                    case helpy_auth_service:verify_token(Token) of
                        {true, UserId} -> {UserId, Req};
                        false          -> throw({http_error, ?HTTP_UNAUTHORIZED,
                                                 <<"Invalid authorization token">>})
                    end;
                error ->
                    throw({http_error, ?HTTP_UNAUTHORIZED,
                           <<"Malformed authorization header">>})
            end
    end.

-spec parse_bearer_token(binary()) -> {ok, binary()} | error.
parse_bearer_token(<<?BEARER_PREFIX/binary, Token/binary>>) when Token =/= <<>> ->
    {ok, Token};
parse_bearer_token(_) ->
    error.

%% ---------------------------------------------------------------------------
%% Routing
%%
%% Path is split into segments and matched against literal route clauses.
%% Parameterised routes (e.g. [<<"api">>, <<"plans">>, PlanId]) MUST appear
%% AFTER all literal routes with the same segment count under that prefix.
%% ---------------------------------------------------------------------------

-spec split_path(binary()) -> [binary()].
split_path(Path) ->
    [S || S <- binary:split(Path, <<"/">>, [global]), S =/= <<>>].

-spec route(binary(), [binary()], user_id(), cowboy_req:req()) -> cowboy_req:req().

%% --- Health check ----------------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"health">>], _UserId, Req) ->
    ok_json(?HTTP_OK, #{status => <<"healthy">>,
                        timestamp => erlang:system_time(second)}, Req);

%% --- Plans collection ------------------------------------------------------
route(<<"POST">>, [<<"api">>, <<"plans">>], UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        {Args, Options} = extract_plan_params(Data),
        create_and_reply(Args, Options, UserId, Req1)
    end);

route(<<"GET">>, [<<"api">>, <<"plans">>], UserId, Req) ->
    Plans = helpy_plan_history:list_plans(UserId),
    ok_json(?HTTP_OK, #{plans => Plans}, Req);

%% --- Queue -----------------------------------------------------------------
route(<<"POST">>, [<<"api">>, <<"plans">>, <<"queue">>], UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        {Args, Options} = extract_plan_params(Data),
        Priority = clamp(expect_integer(Data, <<"priority">>, ?DEFAULT_PRIORITY), 0, 100),
        case helpy_plan_service:create_plan_safe(Args, Options) of
            {ok, Plan} ->
                helpy_plan_service:enqueue_plan(Plan, Priority, UserId),
                ok_json(?HTTP_OK, #{plan => Plan, queued => true}, Req1);
            {error, Message} ->
                error_json(?HTTP_BAD_REQUEST, Message, Req1)
        end
    end);

route(<<"POST">>, [<<"api">>, <<"plans">>, <<"queue">>, <<"dequeue">>], UserId, Req) ->
    case helpy_plan_service:dequeue_plan(UserId) of
        {ok, Plan} ->
            ok_json(?HTTP_OK, #{plan => Plan}, Req);
        {error, empty} ->
            ok_json(?HTTP_OK, #{plan => null,
                                message => <<"Queue is empty">>}, Req)
    end);

route(<<"GET">>, [<<"api">>, <<"plans">>, <<"queue">>], UserId, Req) ->
    Queue = helpy_plan_service:list_queue(UserId),
    ok_json(?HTTP_OK, #{queue => Queue}, Req);

route(<<"DELETE">>, [<<"api">>, <<"plans">>, <<"queue">>], UserId, Req) ->
    helpy_plan_service:clear_queue(UserId),
    no_content(Req);

%% --- Single plan (parameterised — MUST follow literal /plans/* routes) -----
route(<<"GET">>, [<<"api">>, <<"plans">>, PlanId], UserId, Req) ->
    case helpy_plan_history:get_plan(PlanId, UserId) of
        {ok, Plan}         -> ok_json(?HTTP_OK, #{plan => Plan}, Req);
        {error, not_found} -> throw_not_found(<<"Plan not found">>)
    end;

route(<<"DELETE">>, [<<"api">>, <<"plans">>, PlanId], UserId, Req) ->
    case helpy_plan_history:delete_plan(PlanId, UserId) of
        ok                 -> no_content(Req);
        {error, not_found} -> throw_not_found(<<"Plan not found">>)
    end;

%% --- Recommendations -------------------------------------------------------
route(<<"POST">>, [<<"api">>, <<"recommendations">>, <<"smart">>], _UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        TotalMinutes = clamp(expect_number(Data, <<"totalAvailableMinutes">>,
                                           ?DEFAULT_TOTAL_MINUTES),
                             1, ?MAX_TOTAL_MINUTES),
        Intensity    = clamp(expect_number(Data, <<"workIntensity">>,
                                           ?DEFAULT_INTENSITY),
                             ?MIN_INTENSITY, ?MAX_INTENSITY),
        Energy       = clamp(expect_number(Data, <<"userEnergyLevel">>,
                                           ?DEFAULT_ENERGY),
                             ?MIN_ENERGY, ?MAX_ENERGY),
        Recommendation = helpy_plan_service:generate_smart_recommendation(
                           TotalMinutes, Intensity, Energy),
        ok_json(?HTTP_OK, #{recommendation => Recommendation}, Req1)
    end);

%% --- Schedule --------------------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"schedule">>], UserId, Req) ->
    {ok, Schedule} = helpy_sync_server:get_schedule(UserId),
    ok_json(?HTTP_OK, #{schedule => Schedule}, Req);

route(<<"POST">>, [<<"api">>, <<"schedule">>], UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        Schedule = maps:get(<<"schedule">>, Data, []),
        case validate_schedule(Schedule) of
            ok ->
                helpy_sync_server:set_schedule(Schedule, UserId),
                ok_json(?HTTP_OK, #{schedule => Schedule}, Req1);
            {error, Reason} ->
                throw({http_error, ?HTTP_BAD_REQUEST, Reason})
        end
    end);

%% --- Sync & Session --------------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"sync">>, <<"state">>], UserId, Req) ->
    session_state(UserId, Req);

route(<<"GET">>, [<<"api">>, <<"session">>, <<"state">>], UserId, Req) ->
    session_state(UserId, Req);

route(<<"POST">>, [<<"api">>, <<"session">>, <<"start">>], UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        Title    = validate_title(maps:get(<<"title">>, Data, ?DEFAULT_SESSION_TITLE)),
        Duration = clamp(expect_integer(Data, <<"durationMinutes">>,
                                        ?DEFAULT_SESSION_DURATION),
                         ?MIN_SESSION_DURATION, ?MAX_SESSION_DURATION),
        {ok, Session} = helpy_sync_server:start_session(Title, Duration, UserId),
        created_json(#{session => Session}, Req1)
    end);

route(<<"POST">>, [<<"api">>, <<"session">>, <<"stop">>], UserId, Req) ->
    case helpy_sync_server:stop_session(UserId) of
        {ok, Session}   -> ok_json(?HTTP_OK, #{session => Session}, Req);
        {error, Reason} -> throw({http_error, ?HTTP_BAD_REQUEST, Reason})
    end);

%% --- Bot -------------------------------------------------------------------
route(<<"POST">>, [<<"api">>, <<"bot">>, <<"action">>], UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        Type   = validate_bot_type(maps:get(<<"type">>, Data, <<"general">>)),
        Detail = validate_detail(maps:get(<<"detail">>, Data, <<"No details">>)),
        Res = helpy_bot_server:log_action(Type, Detail, UserId),
        ok_json(?HTTP_OK, Res, Req1)
    end);

route(<<"GET">>, [<<"api">>, <<"bot">>, <<"memory">>], UserId, Req) ->
    ok_json(?HTTP_OK, helpy_bot_server:get_memory(UserId), Req);

route(<<"GET">>, [<<"api">>, <<"bot">>, <<"fact">>], _UserId, Req) ->
    ok_json(?HTTP_OK, helpy_bot_server:get_fact(), Req);

route(<<"GET">>, [<<"api">>, <<"bot">>, <<"motivation">>], _UserId, Req) ->
    ok_json(?HTTP_OK, helpy_bot_server:get_motivation(), Req);

%% --- Rules -----------------------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"rules">>, <<"active">>], UserId, Req) ->
    {ok, Rules} = helpy_sync_server:evaluate_rules(UserId),
    ok_json(?HTTP_OK, #{active_rules => Rules}, Req);

%% --- Erlang node status ----------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"erlang">>, <<"status">>], _UserId, Req) ->
    NodeInfo = helpy_session_manager:node_info(),
    ok_json(?HTTP_OK, NodeInfo#{source => <<"helpy_session_manager">>}, Req);

%% --- Session manager -------------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"sessions">>], UserId, Req) ->
    Sessions = helpy_session_manager:list_sessions(UserId),
    ok_json(?HTTP_OK, #{sessions => Sessions}, Req);

route(<<"POST">>, [<<"api">>, <<"sessions">>, <<"start">>], UserId, Req) ->
    with_json_body(Req, fun(Data, Req1) ->
        Duration = clamp(expect_integer(Data, <<"duration_minutes">>,
                                        ?DEFAULT_SESSION_DURATION),
                         ?MIN_DURATION_MINUTES, ?MAX_DURATION_MINUTES),
        case helpy_session_manager:start_session(UserId, Duration) of
            {ok, Session}   -> created_json(#{session => Session}, Req1);
            {error, Reason} -> throw({http_error, ?HTTP_TOO_MANY_REQUESTS, Reason})
        end
    end);

route(<<"POST">>, [<<"api">>, <<"sessions">>, <<"end">>], UserId, Req) ->
    case helpy_session_manager:end_session(UserId) of
        {ok, Session}   -> ok_json(?HTTP_OK, #{session => Session}, Req);
        {error, Reason} -> throw({http_error, ?HTTP_NOT_FOUND, Reason})
    end);

route(<<"POST">>, [<<"api">>, <<"sessions">>, <<"pause">>], UserId, Req) ->
    case helpy_session_manager:pause_session(UserId) of
        {ok, Session}   -> ok_json(?HTTP_OK, #{session => Session}, Req);
        {error, Reason} -> throw({http_error, ?HTTP_BAD_REQUEST, Reason})
    end);

route(<<"POST">>, [<<"api">>, <<"sessions">>, <<"resume">>], UserId, Req) ->
    case helpy_session_manager:resume_session(UserId) of
        {ok, Session}   -> ok_json(?HTTP_OK, #{session => Session}, Req);
        {error, Reason} -> throw({http_error, ?HTTP_BAD_REQUEST, Reason})
    end);

route(<<"GET">>, [<<"api">>, <<"sessions">>, UserIdParam, <<"status">>],
      RequesterId, Req) ->
    ensure_authorized(UserIdParam, RequesterId, fun() ->
        case helpy_session_manager:session_status(UserIdParam) of
            {ok, Session}   -> ok_json(?HTTP_OK, #{session => Session}, Req);
            {error, Reason} -> throw({http_error, ?HTTP_NOT_FOUND, Reason})
        end
    end);

%% --- Analytics -------------------------------------------------------------
route(<<"GET">>, [<<"api">>, <<"analytics">>, <<"daily">>], UserId, Req) ->
    ok_json(?HTTP_OK, helpy_focus_analytics:get_daily_stats(UserId), Req);

route(<<"GET">>, [<<"api">>, <<"analytics">>, <<"weekly">>], UserId, Req) ->
    Summary = helpy_focus_analytics:get_weekly_summary(UserId),
    ok_json(?HTTP_OK, #{weekly => Summary}, Req);

route(<<"GET">>, [<<"api">>, <<"analytics">>, <<"streaks">>], UserId, Req) ->
    Streaks = helpy_focus_analytics:top_focus_streaks(UserId, 10),
    ok_json(?HTTP_OK, #{streaks => Streaks}, Req);

route(<<"GET">>, [<<"api">>, <<"analytics">>, <<"user">>, UserIdParam],
      RequesterId, Req) ->
    ensure_authorized(UserIdParam, RequesterId, fun() ->
        ok_json(?HTTP_OK, helpy_focus_analytics:user_stats(UserIdParam), Req)
    end);

%% --- Fallback --------------------------------------------------------------
route(_Method, _Segments, _UserId, Req) ->
    throw_not_found(<<"Not found">>).

%% ---------------------------------------------------------------------------
%% Helpers — Authorization
%% ---------------------------------------------------------------------------

-spec ensure_authorized(user_id(), user_id(),
                        fun(() -> cowboy_req:req())) -> cowboy_req:req().
ensure_authorized(TargetId, RequesterId, Fun) ->
    case TargetId =:= RequesterId orelse is_admin(RequesterId) of
        true  -> Fun();
        false -> throw({http_error, ?HTTP_FORBIDDEN,
                        <<"Insufficient permissions">>})
    end.

-spec is_admin(user_id()) -> boolean().
is_admin(undefined) -> false;
is_admin(UserId)    -> helpy_auth_service:is_admin(UserId).

%% ---------------------------------------------------------------------------
%% Helpers — Validation
%% ---------------------------------------------------------------------------

-spec clamp(number(), number(), number()) -> number().
clamp(Value, Min, Max) when is_number(Value) ->
    max(Min, min(Value, Max)).

-spec validate_title(term()) -> binary().
validate_title(Title) when is_binary(Title) ->
    truncate_binary(Title, ?MAX_TITLE_LEN);
validate_title(_) ->
    ?DEFAULT_SESSION_TITLE.

-spec validate_bot_type(term()) -> binary().
validate_bot_type(Type) when is_binary(Type) ->
    case lists:member(Type, ?ALLOWED_BOT_TYPES) of
        true  -> Type;
        false -> <<"general">>
    end;
validate_bot_type(_) ->
    <<"general">>.

-spec validate_detail(term()) -> binary().
validate_detail(Detail) when is_binary(Detail) ->
    truncate_binary(Detail, ?MAX_DETAIL_LEN);
validate_detail(_) ->
    <<"No details">>.

-spec truncate_binary(binary(), non_neg_integer()) -> binary().
truncate_binary(Bin, MaxLen) ->
    case byte_size(Bin) > MaxLen of
        true  -> binary:part(Bin, 0, MaxLen);
        false -> Bin
    end.

-spec validate_schedule(term()) -> ok | {error, binary()}.
validate_schedule(Schedule) when is_list(Schedule) ->
    ok;
validate_schedule(_) ->
    {error, <<"Invalid schedule format">>}.

%% ---------------------------------------------------------------------------
%% Helpers — Body parsing
%% ---------------------------------------------------------------------------

-spec with_json_body(cowboy_req:req(), handler_fun()) -> cowboy_req:req().
with_json_body(Req, Fun) ->
    case read_json_body(Req) of
        {ok, Data, Req1} when is_map(Data) ->
            Fun(Data, Req1);
        {ok, _NotMap, Req1} ->
            throw({http_error, ?HTTP_BAD_REQUEST,
                   <<"Request body must be a JSON object">>});
        {error, Status, Reason, Req1} ->
            throw({http_error, Status, Reason})
    end.

-spec read_json_body(cowboy_req:req()) ->
    {ok, term(), cowboy_req:req()} |
    {error, status_code(), binary(), cowboy_req:req()}.
read_json_body(Req) ->
    case cowboy_req:read_body(Req, #{length => ?MAX_BODY_SIZE,
                                     period => ?BODY_READ_PERIOD}) of
        {ok, Body, Req1} ->
            decode_json_body(Body, Req1);
        {more, _Partial, Req1} ->
            {error, ?HTTP_PAYLOAD_TOO_LARGE,
             <<"Request body too large">>, Req1}
    end.

-spec decode_json_body(binary(), cowboy_req:req()) ->
    {ok, term(), cowboy_req:req()} |
    {error, 400, binary(), cowboy_req:req()}.
decode_json_body(<<>>, Req) ->
    {ok, #{}, Req};
decode_json_body(Body, Req) ->
    try jsx:decode(Body, [return_maps]) of
        Data -> {ok, Data, Req}
    catch
        _:_ -> {error, ?HTTP_BAD_REQUEST, <<"Invalid JSON">>, Req}
    end.

%% ---------------------------------------------------------------------------
%% Helpers — Plan params & field extraction
%% ---------------------------------------------------------------------------

-spec extract_plan_params(map()) -> {binary(), map()}.
extract_plan_params(Data) ->
    Args    = maps:get(<<"args">>, Data, ?DEFAULT_ARGS),
    Options = decode_options(maps:get(<<"options">>, Data, ?DEFAULT_OPTIONS)),
    {Args, Options}.

-spec expect_number(map(), binary(), number()) -> number().
expect_number(Map, Key, Default) ->
    case maps:find(Key, Map) of
        {ok, V} when is_number(V) -> V;
        _                         -> Default
    end.

-spec expect_integer(map(), binary(), integer()) -> integer().
expect_integer(Map, Key, Default) ->
    case maps:find(Key, Map) of
        {ok, V} when is_integer(V) -> V;
        {ok, V} when is_float(V)   -> round(V);
        _                          -> Default
    end.

-spec create_and_reply(term(), map(), user_id(), cowboy_req:req()) ->
    cowboy_req:req().
create_and_reply(Args, Options, UserId, Req) ->
    case helpy_plan_service:create_plan_safe(Args, Options) of
        {ok, Plan} ->
            helpy_plan_history:save_plan(Plan, UserId),
            created_json(#{plan => Plan}, Req);
        {error, Message} ->
            throw({http_error, ?HTTP_BAD_REQUEST, Message})
    end.

-spec decode_options(term()) -> map().
decode_options(Map) when is_map(Map) ->
    maps:fold(fun decode_option/3, #{}, Map);
decode_options(_) ->
    #{}.

-spec decode_option(binary() | atom(), term(), map()) -> map().
decode_option(K, V, Acc) when is_binary(K) ->
    try
        Acc#{binary_to_existing_atom(K, utf8) => V}
    catch
        error:badarg ->
            ?LOG_WARNING(#{event => unknown_option, option => K}),
            Acc#{K => V}
    end;
decode_option(K, V, Acc) ->
    Acc#{K => V}.

-spec session_state(user_id(), cowboy_req:req()) -> cowboy_req:req().
session_state(UserId, Req) ->
    {ok, State} = helpy_sync_server:get_session_state(UserId),
    ok_json(?HTTP_OK, #{state => State}, Req).

%% ---------------------------------------------------------------------------
%% Response helpers
%% ---------------------------------------------------------------------------

-spec ok_json(status_code(), term(), cowboy_req:req()) -> cowboy_req:req().
ok_json(Status, Data, Req) when is_map(Data) ->
    reply_json(Status, Data#{success => true}, Req);
ok_json(Status, Data, Req) ->
    reply_json(Status, #{success => true, data => Data}, Req).

-spec created_json(term(), cowboy_req:req()) -> cowboy_req:req().
created_json(Data, Req) when is_map(Data) ->
    reply_json(?HTTP_CREATED, Data#{success => true}, Req);
created_json(Data, Req) ->
    reply_json(?HTTP_CREATED, #{success => true, data => Data}, Req).

-spec error_json(status_code(), term(), cowboy_req:req()) -> cowboy_req:req().
error_json(Status, Reason, Req) ->
    reply_json(Status, #{success => false,
                         error => to_error_binary(Reason)}, Req).

-spec no_content(cowboy_req:req()) -> cowboy_req:req().
no_content(Req) ->
    cowboy_req:reply(?HTTP_NO_CONTENT, #{}, <<>>, Req).

-spec reply_json(status_code(), map(), cowboy_req:req()) -> cowboy_req:req().
reply_json(Status, Data, Req) ->
    Body =
        try jsx:encode(Data) of
            B when is_binary(B) -> B
        catch
            _:_ ->
                ?LOG_ERROR(#{event => jsx_encode_failed, data => Data}),
                jsx:encode(#{success => false,
                             error  => <<"Failed to serialize response">>})
        end,
    cowboy_req:reply(Status,
                     #{<<"content-type">> => ?JSON_CONTENT_TYPE},
                     Body, Req).

-spec throw_not_found(binary()) -> no_return().
throw_not_found(Message) ->
    throw({http_error, ?HTTP_NOT_FOUND, Message}).

-spec to_error_binary(term()) -> binary().
to_error_binary(B) when is_binary(B) -> B;
to_error_binary(A) when is_atom(A)   -> atom_to_binary(A, utf8);
to_error_binary(L) when is_list(L)   -> unicode:characters_to_binary(L);
to_error_binary(T)                   -> iolist_to_binary(io_lib:format("~p", [T])).