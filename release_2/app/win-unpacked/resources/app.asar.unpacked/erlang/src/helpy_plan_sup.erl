-module(helpy_plan_sup).
-behaviour(supervisor).

-export([start_link/0]).
-export([init/1]).

-spec start_link() -> supervisor:startlink_ret().
start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

-spec init(term()) -> {ok, {supervisor:sup_flags(), [supervisor:child_spec()]}}.
init([]) ->
    SupFlags = #{
        strategy => one_for_one,
        intensity => 5,
        period => 10
    },
    ChildSpecs = [child_spec(Mod) || Mod <- child_modules()],
    {ok, {SupFlags, ChildSpecs}}.

%%%===================================================================
%%% Internal functions
%%%===================================================================

-spec child_spec(module()) -> supervisor:child_spec().
child_spec(Mod) ->
    #{
        id       => Mod,
        start    => {Mod, start_link, []},
        restart  => permanent,
        shutdown => 5000,
        type     => worker,
        modules  => [Mod]
    }.

-spec child_modules() -> [module()].
child_modules() ->
    [
        helpy_plan_history,
        helpy_sync_server,
        helpy_bot_server,
        helpy_focus_analytics,
        helpy_session_manager
    ].