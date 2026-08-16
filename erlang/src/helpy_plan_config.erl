%% @doc Configuration cache for the helpy_plan application.
%%
%% Provides fast access to application environment configuration by caching
%% values in an ETS table. Values are lazily loaded from the application
%% environment on first access, or can be bulk-loaded via {@link load/0}
%% or {@link reload/0}.
-module(helpy_plan_config).

-export([
    get/1, get/2,
    set/2,
    delete/1,
    load/0,
    reload/0,
    get_all/0,
    get_application/0,
    get_table_name/0
]).

-define(CONFIG_TABLE, helpy_plan_config_table).
-define(APP_NAME, helpy_plan).

-type key() :: atom().
-type value() :: term().
-type config_list() :: [{key(), value()}].

-export_type([key/0, value/0, config_list/0]).

%%%===================================================================
%%% Public API
%%%===================================================================

%% @doc Returns the name of the application this module manages.
-spec get_application() -> atom().
get_application() ->
    ?APP_NAME.

%% @doc Returns the name of the ETS table used for caching.
-spec get_table_name() -> atom().
get_table_name() ->
    ?CONFIG_TABLE.

%% @doc Equivalent to {@link get/2} with `undefined' as the default.
-spec get(key()) -> value().
get(Key) ->
    get(Key, undefined).

%% @doc Returns the configuration value for `Key'.
%%
%% Looks up `Key' in the ETS cache first. On a miss (or if the table does
%% not yet exist), falls back to the application environment and caches the
%% result for future lookups. Returns `Default' if the key is not found.
-spec get(key(), value()) -> value().
get(Key, Default) ->
    try
        ets:lookup_element(?CONFIG_TABLE, Key, 2)
    catch
        error:badarg ->
            get_from_env(Key, Default)
    end.

%% @doc Sets a configuration value.
%%
%% Updates the application environment (source of truth) first, then the
%% ETS cache. The ETS table is created on demand if it doesn't exist.
-spec set(key(), value()) -> ok | {error, term()}.
set(Key, Value) when is_atom(Key) ->
    try
        ok = application:set_env(?APP_NAME, Key, Value),
        ensure_table(),
        true = ets:insert(?CONFIG_TABLE, {Key, Value}),
        ok
    catch
        error:Reason ->
            {error, Reason}
    end.

%% @doc Removes a configuration key from both the application environment
%% and the ETS cache.
-spec delete(key()) -> ok.
delete(Key) when is_atom(Key) ->
    ok = application:unset_env(?APP_NAME, Key),
    try ets:delete(?CONFIG_TABLE, Key)
    catch error:badarg -> ok
    end,
    ok.

%% @doc Creates the ETS table (if needed) and loads all values from the
%% application environment into the cache.
-spec load() -> ok | {error, term()}.
load() ->
    try
        ensure_table(),
        sync_from_env()
    catch
        error:Reason ->
            {error, Reason}
    end.

%% @doc Reloads all configuration from the application environment.
%%
%% Clears the ETS cache and repopulates it from the application environment.
-spec reload() -> ok | {error, term()}.
reload() ->
    try
        ensure_table(),
        Env = application:get_all_env(?APP_NAME),
        true = ets:delete_all_objects(?CONFIG_TABLE),
        true = ets:insert(?CONFIG_TABLE, Env),
        ok
    catch
        error:Reason ->
            {error, Reason}
    end.

%% @doc Returns all cached configuration key-value pairs.
%%
%% Falls back to the application environment if the ETS table has not been
%% initialized.
-spec get_all() -> config_list().
get_all() ->
    try
        ets:tab2list(?CONFIG_TABLE)
    catch
        error:badarg ->
            application:get_all_env(?APP_NAME)
    end.

%%%===================================================================
%%% Internal functions
%%%===================================================================

%% @private Creates the ETS table if it doesn't already exist.
-spec ensure_table() -> ok.
ensure_table() ->
    case ets:whereis(?CONFIG_TABLE) of
        undefined ->
            try
                ets:new(?CONFIG_TABLE, [
                    named_table, public, set,
                    {read_concurrency, true},
                    {write_concurrency, true}
                ]),
                ok
            catch
                error:badarg ->
                    case ets:whereis(?CONFIG_TABLE) of
                        undefined -> {error, failed_to_create_table};
                        _ -> ok
                    end
            end;
        _Pid ->
            ok
    end.

%% @private Looks up a key from the application environment and caches it.
-spec get_from_env(key(), value()) -> value().
get_from_env(Key, Default) ->
    case application:get_env(?APP_NAME, Key) of
        {ok, Value} ->
            try
                ensure_table(),
                ets:insert(?CONFIG_TABLE, {Key, Value})
            catch
                error:badarg ->
                    ok
            end,
            Value;
        undefined ->
            Default
    end.

%% @private Bulk-inserts all application environment entries into the cache.
-spec sync_from_env() -> ok.
sync_from_env() ->
    Env = application:get_all_env(?APP_NAME),
    true = ets:insert(?CONFIG_TABLE, Env),
    ok.