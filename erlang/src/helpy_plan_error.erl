-module(helpy_plan_error).

%%
%% Centralised error representation for the helpy_plan subsystem.
%%
%% An error_info is an opaque map carrying:
%%   * code      – a typed atom (see error_code/0)
%%   * message   – a human-readable binary
%%   * details   – a free-form map (JSON-serialisable)
%%   * timestamp – millisecond-precision system time
%%
%% The numeric code mapping is shared so that logs, JSON output, and
%% monitoring all agree on the same integers.
%%

%% ===================================================================
%% Single source of truth for the code ↔ numeric mapping.
%% Add new entries here; numeric_code/1, from_numeric_code/1 and the
%% known-code checks all derive from this list automatically.
%% ===================================================================

-define(ERROR_CODES, [
    {invalid_plan,        1001},
    {validation_failed,   1002},
    {plan_not_found,      1003},
    {storage_error,       1004},
    {nif_load_failed,     2001},
    {nif_execution_error, 2002},
    {internal_error,      9999}
]).

-define(ERROR_DOMAIN, [helpy, plan, error]).

%% --- Types ---------------------------------------------------------

-type error_code() :: invalid_plan
                    | validation_failed
                    | plan_not_found
                    | storage_error
                    | nif_load_failed
                    | nif_execution_error
                    | internal_error.

-opaque error_info() :: #{
    code      := error_code(),
    message   := binary(),
    details   := map(),
    timestamp := pos_integer()
}.

-type error_info_map() :: #{
    code         := error_code(),
    message      := binary(),
    details      := map(),
    timestamp    := pos_integer(),
    numeric_code := pos_integer()
}.

%% --- API -----------------------------------------------------------

-export([
    %% Construction
    new/2, new/3, from_map/1,
    %% Accessors
    code/1, message/1, details/1, timestamp/1,
    %% Functional updates
    with_message/2, with_details/2, merge_details/2,
    %% Numeric code mapping
    numeric_code/1, from_numeric_code/1,
    %% Serialisation
    to_map/1,
    %% Validation
    is_error_info/1,
    %% Formatting & logging
    format/1, log/1, log/2
]).

-export_type([error_code/0, error_info/0, error_info_map/0]).

%% ===================================================================
%% Module init – build reverse-lookup tables once.
%% ===================================================================

-on_load(init/0).

-spec init() -> ok.
init() ->
    CodeToNum = maps:from_list(?ERROR_CODES),
    NumToCode = maps:from_list([{N, C} || {C, N} <- ?ERROR_CODES]),
    persistent_term:put({?MODULE, code_to_num}, CodeToNum),
    persistent_term:put({?MODULE, num_to_code}, NumToCode),
    ok.

%% ===================================================================
%% Construction
%% ===================================================================

%% @doc Create an error with empty details.
-spec new(error_code(), iodata()) -> error_info().
new(Code, Message) ->
    new(Code, Message, #{}).

%% @doc Create an error with the given details map.
%%
%% Raises `{unknown_error_code, Code}' when `Code' is not a known
%% error code, or `{badarg, {details, Details}}' when `Details' is
%% not a map.
-spec new(error_code(), iodata(), map()) -> error_info().
new(Code, Message, Details) when is_atom(Code), is_map(Details) ->
    ensure_known_code(Code),
    #{
        code      => Code,
        message   => unicode:characters_to_binary(Message),
        details   => Details,
        timestamp => erlang:system_time(millisecond)
    };
new(Code, _Message, Details) when is_atom(Code) ->
    %% Details failed the is_map/1 guard in the clause above.
    erlang:error({badarg, {details, Details}});
new(Code, _Message, _Details) ->
    %% Code is not an atom.
    erlang:error({unknown_error_code, Code}).

%% @doc Reconstruct an error_info from a plain map (e.g. deserialised
%% JSON).  Extra keys (such as `numeric_code' from to_map/1) are
%% silently dropped, making round-tripping safe.
-spec from_map(map()) -> error_info().
from_map(#{code := Code, message := Msg, details := Details, timestamp := Ts})
  when is_atom(Code), is_binary(Msg), is_map(Details), is_integer(Ts), Ts > 0 ->
    ensure_known_code(Code),
    #{code => Code, message => Msg, details => Details, timestamp => Ts};
from_map(Map) ->
    erlang:error({badarg, {map, Map}}).

%% ===================================================================
%% Accessors
%% ===================================================================

-spec code(error_info()) -> error_code().
code(#{code := Code}) -> Code.

-spec message(error_info()) -> binary().
message(#{message := Message}) -> Message.

-spec details(error_info()) -> map().
details(#{details := Details}) -> Details.

-spec timestamp(error_info()) -> pos_integer().
timestamp(#{timestamp := Ts}) -> Ts.

%% ===================================================================
%% Functional updates
%% ===================================================================

%% @doc Return a copy of `Error' with the message replaced.
-spec with_message(error_info(), iodata()) -> error_info().
with_message(Error, Message) ->
    Error#{message => unicode:characters_to_binary(Message)}.

%% @doc Return a copy of `Error' with the details replaced.
%%
%% Raises `{badarg, {details, Details}}' when `Details' is not a map.
-spec with_details(error_info(), map()) -> error_info().
with_details(Error, Details) when is_map(Details) ->
    Error#{details => Details};
with_details(_Error, Details) ->
    erlang:error({badarg, {details, Details}}).

%% @doc Merge `Extra' into the existing details of `Error'.
%%
%% Useful for enriching an error with context as it propagates up the
%% stack.  Raises `{badarg, {details, Extra}}' when `Extra' is not a
%% map.
-spec merge_details(error_info(), map()) -> error_info().
merge_details(#{details := D} = Error, Extra) when is_map(Extra) ->
    Error#{details => maps:merge(D, Extra)};
merge_details(_Error, Extra) ->
    erlang:error({badarg, {details, Extra}}).

%% ===================================================================
%% Numeric code mapping
%% ===================================================================

%% @doc Return the numeric identifier for a known error code.
%% Raises `{unknown_error_code, Code}' for unrecognised codes.
-spec numeric_code(error_code()) -> pos_integer().
numeric_code(Code) ->
    case maps:find(Code, persistent_term:get({?MODULE, code_to_num})) of
        {ok, Num} -> Num;
        error     -> erlang:error({unknown_error_code, Code})
    end.

%% @doc Reverse lookup: numeric identifier -> error code atom.
-spec from_numeric_code(pos_integer()) -> {ok, error_code()} | {error, unknown_code}.
from_numeric_code(Num) ->
    case maps:find(Num, persistent_term:get({?MODULE, num_to_code})) of
        {ok, Code} -> {ok, Code};
        error      -> {error, unknown_code}
    end.

%% ===================================================================
%% Serialisation
%% ===================================================================

%% @doc Convert an error_info to a plain map with an added
%% `numeric_code' field, suitable for JSON serialisation.
-spec to_map(error_info()) -> error_info_map().
to_map(#{code := Code, message := _, details := _, timestamp := _} = Error) ->
    Error#{numeric_code => numeric_code(Code)}.

%% ===================================================================
%% Validation
%% ===================================================================

%% @doc Runtime type check for error_info values.
-spec is_error_info(term()) -> boolean().
is_error_info(#{code := Code, message := Msg, details := Details, timestamp := Ts})
  when is_atom = Code, is_binary(Msg), is_map(Details), is_integer(Ts), Ts > 0 ->
    is_known_code(Code);
is_error_info(_) ->
    false.

%% ===================================================================
%% Formatting & logging
%% ===================================================================

%% @doc Pretty-print an error as a single-line binary.
-spec format(error_info()) -> binary().
format(#{code := Code, message := Msg, details := Details, timestamp := Ts}) ->
    Num = numeric_code(Code),
    iolist_to_binary([
        "[", atom_to_binary(Code, utf8), "/", integer_to_binary(Num), "] ",
        format_ts(Ts), " - ", Msg,
        format_details(Details)
    ]).

%% @doc Log the formatted error at the `error' level.
-spec log(error_info()) -> ok.
log(Error) ->
    log(error, Error).

%% @doc Log the formatted error at the given level, attaching the
%% structured error_info (as a plain map via to_map/1) under the
%% `error_info' metadata key.
-spec log(logger:level(), error_info()) -> ok.
log(Level, Error) ->
    case logger:allow(Level, ?MODULE) of
        true  -> logger:log(Level, format(Error), log_metadata(Error));
        false -> ok
    end.

%% ===================================================================
%% Internal helpers
%% ===================================================================

%% @private Raises `{unknown_error_code, Code}' if Code is unknown.
-spec ensure_known_code(atom()) -> ok.
ensure_known_code(Code) ->
    case is_known_code(Code) of
        true  -> ok;
        false -> erlang:error({unknown_error_code, Code})
    end.

%% @private Membership test – no exceptions, safe for control flow.
-spec is_known_code(atom()) -> boolean().
is_known_code(Code) ->
    is_map_key(Code, persistent_term:get({?MODULE, code_to_num})).

%% @private Build the metadata map attached to logger calls.
-spec log_metadata(error_info()) -> map().
log_metadata(Error) ->
    #{error_info => to_map(Error), domain => ?ERROR_DOMAIN}.

-spec format_details(map()) -> iolist().
format_details(Details) when map_size(Details) =:= 0 ->
    [];
format_details(Details) ->
    [" | Details: ", io_lib:format("~P", [Details, 50])].

-spec format_ts(pos_integer()) -> binary().
format_ts(Ts) ->
    calendar:system_time_to_rfc3339(Ts, [{unit, millisecond}, {offset, "Z"}]).