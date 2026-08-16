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

-type error_code() :: invalid_plan
                    | validation_failed
                    | plan_not_found
                    | storage_error
                    | nif_load_failed
                    | nif_execution_error
                    | internal_error.

%% Declared opaque so callers must use the accessor API instead of
%% pattern-matching on the internal map structure.
-opaque error_info() :: #{
    code      := error_code(),
    message   := binary(),
    details   := map(),
    timestamp := pos_integer()
}.

%% Plain map produced by to_map/1, with an added numeric_code field
%% for JSON serialisation.  Expressed as a map update on error_info()
%% so the two types stay structurally aligned.
-type error_info_map() :: error_info()#{numeric_code := pos_integer()}.

%% --- Construction --------------------------------------------------
-export([new/2, new/3, from_map/1]).

%% --- Accessors -----------------------------------------------------
-export([code/1, message/1, details/1, timestamp/1]).

%% --- Numeric code mapping ------------------------------------------
-export([numeric_code/1, from_numeric_code/1]).

%% --- Serialisation -------------------------------------------------
-export([to_map/1]).

%% --- Validation ----------------------------------------------------
-export([is_error_info/1]).

%% --- Formatting & logging ------------------------------------------
-export([format/1, log/1, log/2]).

-export_type([error_code/0, error_info/0, error_info_map/0]).

%%%===================================================================
%%% Construction
%%%===================================================================

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
new(Code, Message, Details) when is_map(Details) ->
    ensure_known_code(Code),
    #{
        code      => Code,
        message   => iolist_to_binary(Message),
        details   => Details,
        timestamp => erlang:system_time(millisecond)
    };
new(_Code, _Message, Details) ->
    erlang:error({badarg, {details, Details}}).

%% @doc Reconstruct an error_info from a plain map (e.g. deserialised
%% JSON).  The map must contain the keys `code', `message', `details',
%% and `timestamp'.  Extra keys (such as `numeric_code' from to_map/1)
%% are silently dropped, making round-tripping safe.
-spec from_map(map()) -> error_info().
from_map(#{code := Code, message := Msg, details := Details, timestamp := Ts})
  when is_atom(Code), is_binary(Msg), is_map(Details), is_integer(Ts), Ts > 0 ->
    ensure_known_code(Code),
    #{code => Code, message => Msg, details => Details, timestamp => Ts};
from_map(Map) ->
    erlang:error({badarg, {map, Map}}).

%%%===================================================================
%%% Accessors
%%%===================================================================

-spec code(error_info()) -> error_code().
code(#{code := Code}) -> Code.

-spec message(error_info()) -> binary().
message(#{message := Message}) -> Message.

-spec details(error_info()) -> map().
details(#{details := Details}) -> Details.

-spec timestamp(error_info()) -> pos_integer().
timestamp(#{timestamp := Ts}) -> Ts.

%%%===================================================================
%%% Numeric code mapping
%%%===================================================================

%% Pattern-matched functions so that Dialyzer verifies clause
%% exhaustiveness against error_code/0.  When adding a new code,
%% update error_code/0, numeric_code/1, and from_numeric_code/1.

-spec numeric_code(error_code()) -> pos_integer().
numeric_code(invalid_plan)        -> 1001;
numeric_code(validation_failed)   -> 1002;
numeric_code(plan_not_found)      -> 1003;
numeric_code(storage_error)       -> 1004;
numeric_code(nif_load_failed)     -> 2001;
numeric_code(nif_execution_error) -> 2002;
numeric_code(internal_error)      -> 9999.

%% @doc Reverse lookup: numeric identifier -> error code atom.
%% Useful when deserialising numeric codes from external systems.
-spec from_numeric_code(pos_integer()) -> {ok, error_code()} | {error, unknown_code}.
from_numeric_code(1001) -> {ok, invalid_plan};
from_numeric_code(1002) -> {ok, validation_failed};
from_numeric_code(1003) -> {ok, plan_not_found};
from_numeric_code(1004) -> {ok, storage_error};
from_numeric_code(2001) -> {ok, nif_load_failed};
from_numeric_code(2002) -> {ok, nif_execution_error};
from_numeric_code(9999) -> {ok, internal_error};
from_numeric_code(_)    -> {error, unknown_code}.

%%%===================================================================
%%% Serialisation
%%%===================================================================

%% @doc Convert an error_info to a plain map with an added
%% `numeric_code' field, suitable for JSON serialisation.
-spec to_map(error_info()) -> error_info_map().
to_map(#{code := Code} = Error) ->
    Error#{numeric_code => numeric_code(Code)}.

%%%===================================================================
%%% Validation
%%%===================================================================

%% @doc Runtime type check for error_info values.
%% Useful when error_info values flow in from external sources.
-spec is_error_info(term()) -> boolean().
is_error_info(#{code := Code, message := Msg, details := Details, timestamp := Ts})
  when is_atom(Code), is_binary(Msg), is_map(Details), is_integer(Ts), Ts > 0 ->
    is_known_code(Code);
is_error_info(_) ->
    false.

%%%===================================================================
%%% Formatting & logging
%%%===================================================================

%% @doc Pretty-print an error as a single-line binary for human-
%% readable logs.
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
%% `error_info' metadata key so that log consumers can access the
%% numeric_code without pattern-matching on the opaque type.
-spec log(logger:level(), error_info()) -> ok.
log(Level, Error) ->
    logger:log(Level, format(Error), #{error_info => to_map(Error)}).

%%%===================================================================
%%% Internal helpers
%%%===================================================================

%% @private Raises `{unknown_error_code, Code}' if Code is not a
%% member of error_code/0.  Derives the membership check from
%% numeric_code/1 so the code list has a single source of truth.
-spec ensure_known_code(atom()) -> ok.
ensure_known_code(Code) ->
    try numeric_code(Code) of
        _ -> ok
    catch
        error:function_clause ->
            erlang:error({unknown_error_code, Code})
    end.

%% @private Membership test used by is_error_info/1.
-spec is_known_code(atom()) -> boolean().
is_known_code(Code) ->
    try numeric_code(Code) of
        _ -> true
    catch
        error:function_clause -> false
    end.

-spec format_details(map()) -> iolist().
format_details(Details) when map_size(Details) =:= 0 ->
    [];
format_details(Details) ->
    [" | Details: ", io_lib:format("~P", [Details, 50])].

-spec format_ts(pos_integer()) -> binary().
format_ts(Ts) ->
    calendar:system_time_to_rfc3339(Ts, [{unit, millisecond}, {offset, "Z"}]).