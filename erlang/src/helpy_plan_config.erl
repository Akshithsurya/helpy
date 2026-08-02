-module(helpy_plan_config).

-export([
    get/1, get/2,
    set/2,
    delete/1,
    load/0,
    reload/0,
    get_all/0
]).

-define(CONFIG_TABLE, helpy_plan_config_table).
-define(APP_NAME, helpy_plan).

-type key() :: atom().
-type value() :: term().

%%%===================================================================
%%% Public API
%%%===================================================================

-spec get(key()) -> value().
get(Key) ->
    get(Key, undefined).

-spec get(key(), value()) -> value().
get(Key, Default) ->
    try ets:lookup(?CONFIG_TABLE, Key) of
        [{_, Value}] ->
            Value;
        [] ->
            case application:get_env(?APP_NAME, Key) of
                {ok, Value} ->
                    %% Cache the value for future lookups
                    ets:insert(?CONFIG_TABLE, {Key, Value}),
                    Value;
                undefined ->
                    Default
            end
    catch
        error:badarg ->
            %% Graceful fallback if the table hasn't been initialized yet
            case application:get_env(?APP_NAME, Key) of
                {ok, Value} -> Value;
                undefined -> Default
            end
    end.

-spec set(key(), value()) -> ok.
set(Key, Value) ->
    try ets:insert(?CONFIG_TABLE, {Key, Value})
    catch error:badarg -> ok end,
    application:set_env(?APP_NAME, Key, Value),
    ok.

-spec delete(key()) -> ok.
delete(Key) ->
    try ets:delete(?CONFIG_TABLE, Key)
    catch error:badarg -> ok end,
    application:unset_env(?APP_NAME, Key),
    ok.

-spec load() -> ok.
load() ->
    ensure_table(),
    load_from_env(),
    ok.

-spec reload() -> ok.
reload() ->
    ensure_table(),
    try ets:delete_all_objects(?CONFIG_TABLE)
    catch error:badarg -> ok end,
    load_from_env(),
    ok.

-spec get_all() -> [{key(), value()}].
get_all() ->
    try ets:tab2list(?CONFIG_TABLE)
    catch error:badarg -> application:get_all_env(?APP_NAME) end.

%%%===================================================================
%%% Internal functions
%%%===================================================================

-spec ensure_table() -> ok.
ensure_table() ->
    %% Atomically create the table if it doesn't exist, handling race conditions cleanly
    case ets:info(?CONFIG_TABLE) of
        undefined ->
            try
                ets:new(?CONFIG_TABLE, [
                    named_table, public, set,
                    {read_concurrency, true},
                    {write_concurrency, true}
                ])
            catch
                %% Race condition: another process created the table between our info check and ets:new call
                error:badarg -> ok
            end;
        _ ->
            ok
    end.

-spec load_from_env() -> ok.
load_from_env() ->
    Env = application:get_all_env(?APP_NAME),
    try ets:insert(?CONFIG_TABLE, Env)
    catch error:badarg -> ok end,
    ok.