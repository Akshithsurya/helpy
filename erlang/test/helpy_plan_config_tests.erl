-module(helpy_plan_config_tests).
-include_lib("eunit/include/eunit.hrl").

%% Main test suite with setup/cleanup lifecycle
basic_config_test_() ->
    {setup,
     fun setup/0,
     fun cleanup/1,
     [fun test_get_set/0,
      fun test_get_default/0,
      fun test_get_all/0]}.

%% Initialize config state before each test run
setup() ->
    ok = helpy_plan_config:load(),
    %% Capture initial state to restore after tests
    InitialState = helpy_plan_config:get_all(),
    InitialState.

%% Clean up test modifications and restore initial state
cleanup(InitialState) ->
    %% Clear all keys added during tests
    CurrentKeys = proplists:get_keys(helpy_plan_config:get_all()),
    InitialKeys = proplists:get_keys(InitialState),
    lists:foreach(fun(K) -> helpy_plan_config:unset(K) end, CurrentKeys -- InitialKeys),
    %% Restore original initial key values
    lists:foreach(fun({K, V}) -> helpy_plan_config:set(K, V) end, InitialState),
    ok.

%% Test core get/set functionality works as expected
test_get_set() ->
    TestKey = test_key,
    TestValue = test_value,
    helpy_plan_config:set(TestKey, TestValue),
    ?assertEqual(TestValue, helpy_plan_config:get(TestKey)).

%% Test default value fallback for non-existent keys
test_get_default() ->
    NonExistentKey = nonexistent_key,
    DefaultValue = default_value,
    ?assertEqual(DefaultValue, helpy_plan_config:get(NonExistentKey, DefaultValue)).

%% Test retrieving all stored configuration values
test_get_all() ->
    Key1 = key1,
    Value1 = value1,
    Key2 = key2,
    Value2 = value2,
    
    helpy_plan_config:set(Key1, Value1),
    helpy_plan_config:set(Key2, Value2),
    
    AllConfigs = helpy_plan_config:get_all(),
    ?assert(lists:keymember(Key1, 1, AllConfigs), "key1 should exist in config store"),
    ?assert(lists:keymember(Key2, 1, AllConfigs), "key2 should exist in config store"),
    ?assertEqual(Value1, proplists:get_value(Key1, AllConfigs)),
    ?assertEqual(Value2, proplists:get_value(Key2, AllConfigs)).
