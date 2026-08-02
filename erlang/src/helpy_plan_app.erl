%% @doc Application callback module for the Helpy Plan service.
%%
%% On start the application:
%% <ol>
%%   <li>Loads configuration via {@link helpy_plan_config}.</li>
%%   <li>Initialises metric collectors via {@link helpy_plan_metrics}.</li>
%%   <li>Starts a Cowboy HTTP listener exposing the plan REST API and a
%%       metrics endpoint.</li>
%%   <li>Starts the top-level supervisor {@link helpy_plan_sup}.</li>
%% </ol>
%%
%% Configuration keys (read through {@link helpy_plan_config}):
%% <ul>
%%   <li><code>http_port</code>      – TCP port (default 8080).</li>
%%   <li><code>http_acceptors</code> – number of ranch acceptors
%%       (default 100).</li>
%%   <li><code>http_ip</code>        – bind address, or <code>all</code>
%%       (default <code>all</code>).</li>
%% </ul>
-module(helpy_plan_app).
-behaviour(application).

-export([start/2, stop/1]).

%% Exposed for testing / introspection.
-export([dispatch/0, routes/0]).

-define(DEFAULT_PORT,      8080).
-define(DEFAULT_ACCEPTORS, 100).
-define(LISTENER,          helpy_plan_listener).

-type route() :: {Path :: binary(), Handler :: module(), Opts :: term()}.

%% @private
-spec start(application:start_type(), term()) -> {ok, pid()} | {error, term()}.
start(_StartType, _StartArgs) ->
    ok = helpy_plan_config:load(),
    ok = helpy_plan_metrics:init(),
    case start_http_listener() of
        {ok, _} ->
            case helpy_plan_sup:start_link() of
                {ok, SupPid} ->
                    {ok, SupPid};
                {error, Reason} ->
                    cleanup_listener(),
                    {error, Reason}
            end;
        {error, Reason} ->
            {error, Reason}
    end.

%% @private
-spec stop(term()) -> ok.
stop(_State) ->
    cleanup_listener(),
    ok.

%% @doc Starts the Cowboy HTTP listener using values from
%% {@link helpy_plan_config}.
-spec start_http_listener() -> {ok, pid()} | {error, term()}.
start_http_listener() ->
    Port          = helpy_plan_config:get(http_port,      ?DEFAULT_PORT),
    Acceptors     = helpy_plan_config:get(http_acceptors, ?DEFAULT_ACCEPTORS),
    TransportOpts = transport_opts(Port, Acceptors),
    ProtocolOpts  = #{env => #{dispatch => dispatch()}},
    cowboy:start_clear(?LISTENER, TransportOpts, ProtocolOpts).

-spec transport_opts(inet:port_number(), pos_integer()) -> [{atom(), term()}].
transport_opts(Port, Acceptors) ->
    Base = [{port, Port}, {num_acceptors, Acceptors}],
    case helpy_plan_config:get(http_ip, all) of
        all -> Base;
        Ip  -> [{ip, parse_ip(Ip)} | Base]
    end.

%% @doc Parses an IP address from config into an {@link inet:ip_address()}.
%%
%% Accepts an already-parsed tuple, or a string/binary representation.
%% Crashes with a descriptive error on invalid input.
-spec parse_ip(inet:ip_address() | string() | binary()) -> inet:ip_address().
parse_ip(Ip) when is_tuple(Ip) ->
    Ip;
parse_ip(Ip) when is_list(Ip); is_binary(Ip) ->
    case inet:parse_address(Ip) of
        {ok, Parsed}  -> Parsed;
        {error, einval} -> erlang:error({invalid_ip_address, Ip})
    end.

%% @doc Compiles the Cowboy route dispatch table from {@link routes/0}.
-spec dispatch() -> cowboy_router:dispatch_rules().
dispatch() ->
    cowboy_router:compile([{'_', routes()}]).

%% @doc Returns the list of routes served by this application.
%%
%% <ul>
%%   <li><code>/api/plans</code>     – collection operations.</li>
%%   <li><code>/api/plans/:id</code> – item operations.</li>
%%   <li><code>/metrics</code>       – Prometheus exposition.</li>
%% </ul>
-spec routes() -> [route()].
routes() ->
    HttpHandler    = helpy_plan_http_handler,
    MetricsHandler = helpy_plan_metrics_handler,
    [
        {<<"/api/plans">>,                                HttpHandler, []},
        {<<"/api/plans/:id">>,                            HttpHandler, []},
        {<<"/api/erlang/status">>,                        HttpHandler, []},
        {<<"/api/sessions">>,                             HttpHandler, []},
        {<<"/api/sessions/start">>,                       HttpHandler, []},
        {<<"/api/sessions/end">>,                         HttpHandler, []},
        {<<"/api/sessions/pause">>,                       HttpHandler, []},
        {<<"/api/sessions/resume">>,                      HttpHandler, []},
        {<<"/api/sessions/:user_id/status">>,             HttpHandler, []},
        {<<"/api/analytics/daily">>,                      HttpHandler, []},
        {<<"/api/analytics/weekly">>,                     HttpHandler, []},
        {<<"/api/analytics/streaks">>,                    HttpHandler, []},
        {<<"/api/analytics/user/:user_id">>,              HttpHandler, []},
        {<<"/metrics">>,                                  MetricsHandler, []}
    ].

%% @private
-spec cleanup_listener() -> ok.
cleanup_listener() ->
    _ = cowboy:stop_listener(?LISTENER),
    ok.
