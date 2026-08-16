-module(helpy_plan_sup).
-behaviour(supervisor).

-export([start_link/0]).
-export([init/1]).

%% Supervisor configuration constants
-define(SUPERVISOR_STRATEGY, one_for_one).
-define(MAX_RESTARTS, 5).
-define(RESTART_PERIOD, 10).
-define(CHILD_SHUTDOWN_TIMEOUT, 5000).
-define(CHILD_RESTART_POLICY, permanent).
-define(CHILD_TYPE, worker).

%%%===================================================================
%%% API functions
%%%===================================================================

-spec start_link() -> supervisor:startlink_ret().
start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

%%%===================================================================
%%% Supervisor callback
%%%===================================================================

-spec init(term()) -> {ok, {supervisor:sup_flags(), [supervisor:child_spec()]}}.
init([]) ->
    SupFlags = #{
        strategy => ?SUPERVISOR_STRATEGY,
        intensity => ?MAX_RESTARTS,
        period => ?RESTART_PERIOD
    },
    ChildSpecs = lists:map(fun build_child_spec/1, child_modules()),
    {ok, {SupFlags, ChildSpecs}}.

%%%===================================================================
%%% Internal functions
%%%===================================================================

%% Constructs a standardized child specification for worker modules
-spec build_child_spec(module()) -> supervisor:child_spec().
build_child_spec(Mod) ->
    #{
        id       => Mod,
        start    => {Mod, start_link, []},
        restart  => ?CHILD_RESTART_POLICY,
        shutdown => ?CHILD_SHUTDOWN_TIMEOUT,
        type     => ?CHILD_TYPE,
        modules  => [Mod]
    }.

%% List of managed child worker modules
-spec child_modules() -> [module()].
child_modules() ->
    [
        helpy_plan_history,
        helpy_sync_server,
        helpy_bot_server,
        helpy_focus_analytics,
        helpy_session_manager
    ].