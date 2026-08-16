-module(helpy_plan_history).
-behaviour(gen_server).

%% API
-export([start_link/0, stop/0,
         save_plan/1, get_plan/1, take_plan/1,
         list_plans/0, list_ids/0, list_entries/0,
         plan_exists/1, count/0,
         delete_plan/1, clear/0, child_spec/0]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-define(TABLE, ?MODULE).

-type plan()    :: helpy_plan_service:plan().
-type plan_id() :: binary().
-type state()   :: #{}.

%% Record name occupies tuple position 1, so {keypos, #entry.id} is
%% mandatory — the default keypos=1 would key on the record-name atom.
-record(entry, {id :: plan_id(), plan :: plan()}).

%%%===================================================================
%%% API
%%%===================================================================

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

-spec stop() -> ok.
stop() ->
    gen_server:stop(?MODULE).

-spec child_spec() -> supervisor:child_spec().
child_spec() ->
    #{id       => ?MODULE,
      start    => {?MODULE, start_link, []},
      restart  => permanent,
      shutdown => 5000,
      type     => worker,
      modules  => [?MODULE]}.

%% Reads directly from ETS — no gen_server round-trip.
-spec get_plan(plan_id()) -> {ok, plan()} | {error, not_found}.
get_plan(PlanId) ->
    case ets:lookup(?TABLE, PlanId) of
        [#entry{plan = Plan}] -> {ok, Plan};
        []                    -> {error, not_found}
    end.

%% Atomically retrieve and delete a plan.
%% Must go through the gen_server because the table is protected.
-spec take_plan(plan_id()) -> {ok, plan()} | {error, not_found}.
take_plan(PlanId) ->
    gen_server:call(?MODULE, {take, PlanId}).

%% O(1) existence check — no data transferred.
-spec plan_exists(plan_id()) -> boolean().
plan_exists(PlanId) ->
    ets:member(?TABLE, PlanId).

%% Projection happens inside ETS via match spec.
-spec list_plans() -> [plan()].
list_plans() ->
    ets:select(?TABLE, [{#entry{id = '_', plan = '$1'}, [], ['$1']}]).

-spec list_ids() -> [plan_id()].
list_ids() ->
    ets:select(?TABLE, [{#entry{id = '$1', plan = '_'}, [], ['$1']}]).

-spec list_entries() -> [{plan_id(), plan()}].
list_entries() ->
    ets:select(?TABLE, [{#entry{id = '$1', plan = '$2'}, [], [{{'$1', '$2'}}]}]).

%% O(1) size lookup.
-spec count() -> non_neg_integer().
count() ->
    ets:info(?TABLE, size).

-spec save_plan(plan()) -> ok | {error, term()}.
save_plan(Plan) ->
    gen_server:call(?MODULE, {save, Plan}).

-spec delete_plan(plan_id()) -> ok.
delete_plan(PlanId) ->
    gen_server:call(?MODULE, {delete, PlanId}).

-spec clear() -> ok.
clear() ->
    gen_server:call(?MODULE, clear).

%%%===================================================================
%%% gen_server callbacks
%%%===================================================================

-spec init([]) -> {ok, state()}.
init([]) ->
    ensure_table(),
    {ok, #{}}.

-spec handle_call(term(), {pid(), reference()}, state()) ->
    {reply, term(), state()}.
handle_call({save, Plan}, _From, State) ->
    Reply = case validate_plan(Plan) of
        {ok, PlanId} ->
            ets:insert(?TABLE, #entry{id = PlanId, plan = Plan}),
            ok;
        {error, Reason} ->
            {error, Reason}
    end,
    {reply, Reply, State};
handle_call({take, PlanId}, _From, State) ->
    Reply = case ets:take(?TABLE, PlanId) of
        [#entry{plan = Plan}] -> {ok, Plan};
        []                    -> {error, not_found}
    end,
    {reply, Reply, State};
handle_call({delete, PlanId}, _From, State) ->
    ets:delete(?TABLE, PlanId),
    {reply, ok, State};
handle_call(clear, _From, State) ->
    ets:delete_all_objects(?TABLE),
    {reply, ok, State};
handle_call(_Request, _From, State) ->
    {reply, {error, unknown_call}, State}.

-spec handle_cast(term(), state()) -> {noreply, state()}.
handle_cast(_Msg, State) ->
    {noreply, State}.

-spec handle_info(term(), state()) -> {noreply, state()}.
handle_info(_Info, State) ->
    {noreply, State}.

-spec terminate(term(), state()) -> ok.
terminate(_Reason, _State) ->
    ok.

-spec code_change(term(), state(), term()) -> {ok, state()}.
code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

%%%===================================================================
%%% Internal functions
%%%===================================================================

%% Uses ets:whereis/1 to check for a stale table explicitly, rather than
%% relying on try/catch for control flow. Handles the supervisor-restart
%% race where ETS cleanup hasn't completed before init runs.
-spec ensure_table() -> ets:tid().
ensure_table() ->
    Opts = [named_table, set, protected,
            {read_concurrency, true},
            {keypos, #entry.id}],
    case ets:whereis(?TABLE) of
        undefined ->
            ets:new(?TABLE, Opts);
        _Existing ->
            ets:delete(?TABLE),
            ets:new(?TABLE, Opts)
    end.

-spec validate_plan(term()) -> {ok, plan_id()} | {error, term()}.
validate_plan(Plan) when is_map(Plan) ->
    case maps:find(id, Plan) of
        {ok, PlanId} when is_binary(PlanId), PlanId /= <<>> ->
            {ok, PlanId};
        {ok, _BadId} ->
            {error, invalid_id};
        error ->
            {error, missing_id}
    end;
validate_plan(_) ->
    {error, not_a_map}.