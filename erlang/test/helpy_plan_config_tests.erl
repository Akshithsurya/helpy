-module(helpy_plan_config_tests).
-include_lib("eunit/include/eunit.hrl").

basic_config_test_() ->
    {setup,
     fun setup/0,
     fun cleanup/1,
     [fun test_get_set/0,
      fun test_get_default/0,
      fun test_get_all/0]}.

setup() ->
    helpy_plan_config:load().

cleanup(_) ->
    ok.

test_get_set() ->
    helpy_plan_config:set(test_key, test_value),
    ?assertEqual(test_value, helpy_plan_config:get(test_key)).

test_get_default() ->
    ?assertEqual(default_value, helpy_plan_config:get(nonexistent_key, default_value)).

test_get_all() ->
    helpy_plan_config:set(key1, value1),
    helpy_plan_config:set(key2, value2),
    All = helpy_plan_config:get_all(),
    ?assert(lists:keymember(key1, 1, All)),
    ?assert(lists:keymember(key2, 1, All)).
