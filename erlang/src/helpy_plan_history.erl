-module(helpy_plan_history).
-behaviour(gen_server).

%% API
-export([start_link/0, stop/0, child_spec/0,
         save_plan/1, save_plan_async/1,
         get_plan/1, take_plan/1,
         list_plans/0, list_ids/0, list_entries/0,
         plan_exists/1, count/0,
         delete_plan/1, delete_plan_async/1,
         clear/0]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-define(TABLE, ?MODULE).
-define(CALL_TIMEOUT, 5000).

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
-spec get_plan(plan_id()) -> {ok, plan()} | {error, not_found | unavailable}.
get_plan(PlanId) ->
    with_table(
      fun() ->
              case ets:lookup(?TABLE, PlanId) of
                  [#entry{plan = Plan}] -> {ok, Plan};
                  []                    -> {error, not_found}
              end
      end).

%% Atomically retrieve and delete a plan.
%% Must go through the gen_server because the table is protected.
-spec take_plan(plan_id()) -> {ok, plan()} | {error, not_found | unavailable}.
take_plan(PlanId) ->
    call({take, PlanId}).

%% O(1) existence check — no data transferred.
-spec plan_exists(plan_id()) -> boolean().
plan_exists(PlanId) ->
    case ets:whereis(?TABLE) of
        undefined -> false;
        _Tid      -> ets:member(?TABLE, PlanId)
    end.

%% Projections pushed down into ETS via match spec.
-spec list_plans() -> [plan()].
list_plans() ->
    select([{#entry{id = '_', plan = '$1'}, [], ['$1']}]).

-spec list_ids() -> [plan_id()].
list_ids() ->
    select([{#entry{id = '$1', plan = '_'}, [], ['$1']}]).

-spec list_entries() -> [{plan_id(), plan()}].
list_entries() ->
    select([{#entry{id = '$1', plan = '$2'}, [], [{{'$1', '$2'}}]}]).

%% O(1) size lookup.
-spec count() -> non_neg_integer().
count() ->
    case ets:info(?TABLE, size) of
        undefined -> 0;
        N         -> N
    end.

-spec save_plan(plan()) -> ok | {error, term()}.
save_plan(Plan) ->
    call({save, Plan}).

-spec save_plan_async(plan()) -> ok.
save_plan_async(Plan) ->
    cast({save, Plan}).

-spec delete_plan(plan_id()) -> ok.
delete_plan(PlanId) ->
    call({delete, PlanId}).

-spec delete_plan_async(plan_id()) -> ok.
delete_plan_async(PlanId) ->
    cast({delete, PlanId}).

-spec clear() -> ok.
clear() ->
    call(clear).

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
handle_cast({save, Plan}, State) ->
    case validate_plan(Plan) of
        {ok, PlanId} -> ets:insert(?TABLE, #entry{id = PlanId, plan = Plan});
        {error, _}   -> ok
    end,
    {noreply, State};
handle_cast({delete, PlanId}, State) ->
    ets:delete(?TABLE, PlanId),
    {noreply, State};
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

%% Wraps gen_server:call/3 so callers get a graceful error if the
%% server isn't running or the call doesn't return in time.
-spec call(term()) -> term().
call(Request) ->
    try
        gen_server:call(?MODULE, Request, ?CALL_TIMEOUT)
    catch
        exit:{noproc, _} -> {error, unavailable};
        exit:{normal, _} -> {error, unavailable};
        exit:{timeout, _} -> {error, timeout}
    end.

-spec cast(term()) -> ok.
cast(Msg) ->
    gen_server:cast(?MODULE, Msg).

%% Runs a read against the ETS table only if it currently exists.
-spec with_table(fun(() -> T)) -> T | {error, unavailable} when T :: term().
with_table(Fun) ->
    case ets:whereis(?TABLE) of
        undefined -> {error, unavailable};
        _Tid      -> Fun()
    end.

-spec select(ets:match_spec()) -> [term()].
select(Spec) ->
    case ets:whereis(?TABLE) of
        undefined -> [];
        _Tid      -> ets:select(?TABLE, Spec)
    end.

%% Uses ets:whereis/1 to check for a stale table explicitly, rather
%% than relying on try/catch for control flow. Handles the rare
%% supervisor-restart race where ETS cleanup hasn't completed before
%% init runs.
-spec ensure_table() -> ets:tid().
ensure_table() ->
    Opts = [named_table, set, protected,
            {read_concurrency, true},
            {keypos, #entry.id}],
    case ets:whereis(?TABLE) of
        undefined ->
            ets:new(?TABLE, Opts);
        _Tid ->
            ets:delete(?TABLE),
            ets:new(?TABLE, Opts)
    end.

-spec validate_plan(term()) -> {ok, plan_id()} | {error, term()}.
validate_plan(#{id := PlanId}) when is_binary(PlanId), PlanId =/= <<>> ->
    {ok, PlanId};
validate_plan(#{id := _BadId}) ->
    {error, invalid_id};
validate_plan(#{}) ->
    {error, missing_id};
validate_plan(_) ->
    {error, not_a_map}.