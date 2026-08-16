%% @doc Helpy Focus Analytics
%%
%% ETS-backed per-user analytics aggregator. Provides:
%%   - record_session/3      Store a completed session (cast)
%%   - get_daily_stats/0     Aggregate totals for today
%%   - get_weekly_summary/0  Per-day breakdown for the last 7 days
%%   - top_focus_streaks/1   Users ranked by current consecutive-day streak
%%   - user_stats/1          Stats for a specific user
%%   - reset_daily/0         Force retention prune (testing / cron)
%%
%% All data lives in RAM ETS tables — no external dependencies.
%% Writes are serialised by a gen_server; read APIs hit ETS directly,
%% bypassing the process for throughput.
%%
%% Table layout:
%%   sessions  — ordered_set, key {Day, Seq}     — individual session log
%%   daily     — ordered_set, key {Day, UserId}  — per-day per-user aggregate
%%   streaks   — set,        key UserId          — current & best streak
%%
%% The ordered_set on Day-prefix enables efficient prefix scans for
%% daily/weekly aggregation and retention pruning.

-module(helpy_focus_analytics).
-behaviour(gen_server).

%% Public API
-export([
    start_link/0,
    record_session/3,
    get_daily_stats/0,
    get_weekly_summary/0,
    top_focus_streaks/1,
    user_stats/1,
    reset_daily/0
]).

%% gen_server callbacks
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-define(SERVER,         ?MODULE).
-define(TABLE_SESSIONS, helpy_analytics_sessions).  %% ordered_set, key = {Day, Seq}
-define(TABLE_DAILY,    helpy_analytics_daily).     %% ordered_set, key = {Day, UserId}
-define(TABLE_STREAKS,  helpy_analytics_streaks).   %% set,        key = UserId
-define(RETENTION_DAYS, 7).
-define(SECS_PER_DAY,   86400).

-type user_id() :: binary().
-type minutes() :: non_neg_integer().
-type day_key() :: calendar:date().                 %% {Y, M, D}

-record(state, {
    timer_ref :: reference() | undefined,
    seq       :: non_neg_integer()
}).

%%%==========================================================================
%%% Public API
%%%==========================================================================

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, [], []).

-spec record_session(user_id(), binary(), minutes()) -> ok.
record_session(UserId, Title, DurationMinutes)
    when is_binary(UserId), is_binary(Title),
         is_integer(DurationMinutes), DurationMinutes >= 0 ->
    gen_server:cast(?SERVER, {record_session, UserId, Title, DurationMinutes}).

-spec get_daily_stats() -> map().
get_daily_stats() ->
    Today = today_key(),
    {Sessions, Minutes, Users} = aggregate_day(Today),
    #{
        date           => date_to_binary(Today),
        total_sessions => Sessions,
        total_minutes  => Minutes,
        unique_users   => Users
    }.

-spec get_weekly_summary() -> [map()].
get_weekly_summary() ->
    [begin
         {Sessions, Minutes, _Users} = aggregate_day(Day),
         #{date     => date_to_binary(Day),
           sessions => Sessions,
           minutes  => Minutes}
     end || Day <- last_n_days(?RETENTION_DAYS)].

-spec top_focus_streaks(pos_integer()) -> [map()].
top_focus_streaks(N) when is_integer(N), N > 0 ->
    Ranked = lists:sort(
        fun({UA, CurA, _, BestA}, {UB, CurB, _, BestB}) ->
            %% Descending by {current, best, user_id} — user_id tiebreaker
            %% makes the order deterministic.
            {CurA, BestA, UA} >= {CurB, BestB, UB}
        end, ets:tab2list(?TABLE_STREAKS)),
    [#{user_id => U, streak => C, best => B}
     || {U, C, _LastDay, B} <- lists:sublist(Ranked, N)].

-spec user_stats(user_id()) -> map().
user_stats(UserId) when is_binary(UserId) ->
    %% O(RETENTION_DAYS) point lookups instead of a full table scan.
    {Sessions, Minutes} =
        lists:foldl(
            fun(Day, {S, M}) ->
                case ets:lookup(?TABLE_DAILY, {Day, UserId}) of
                    [{_, Min, Cnt}] -> {S + Cnt, M + Min};
                    []              -> {S, M}
                end
            end, {0, 0}, last_n_days(?RETENTION_DAYS)),
    {Streak, Best} = case ets:lookup(?TABLE_STREAKS, UserId) of
        [{UserId, Cur, _LastDay, B}] -> {Cur, B};
        []                           -> {0, 0}
    end,
    #{
        user_id        => UserId,
        total_sessions => Sessions,
        total_minutes  => Minutes,
        streak_days    => Streak,
        best_streak    => Best
    }.

-spec reset_daily() -> ok.
reset_daily() ->
    gen_server:cast(?SERVER, reset_daily).

%%%==========================================================================
%%% gen_server callbacks
%%%==========================================================================

-spec init(term()) -> {ok, #state{}}.
init([]) ->
    ets:new(?TABLE_SESSIONS, [named_table, ordered_set, public,
                              {keypos, 1}, {read_concurrency, true}]),
    ets:new(?TABLE_DAILY,    [named_table, ordered_set, public,
                              {keypos, 1}, {read_concurrency, true}]),
    ets:new(?TABLE_STREAKS,  [named_table, set, public,
                              {keypos, 1}, {read_concurrency, true}]),
    ok = prune_old_data(today_key()),
    {ok, #state{timer_ref = schedule_midnight_reset(), seq = 0}}.

-spec handle_call(term(), {pid(), term()}, #state{}) ->
    {reply, term(), #state{}}.
handle_call(_Req, _From, State) ->
    {reply, {error, unknown_request}, State}.

-spec handle_cast(term(), #state{}) -> {noreply, #state{}}.
handle_cast({record_session, UserId, Title, DurationMinutes}, State) ->
    Today = today_key(),
    Seq   = State#state.seq + 1,
    ets:insert(?TABLE_SESSIONS,
               {{Today, Seq}, UserId, Title, DurationMinutes}),
    DailyKey = {Today, UserId},
    ets:update_counter(?TABLE_DAILY, DailyKey,
                       [{2, DurationMinutes}, {3, 1}],
                       {DailyKey, 0, 0}),
    ok = update_streak(UserId, Today),
    {noreply, State#state{seq = Seq}};

handle_cast(reset_daily, State) ->
    ok = prune_old_data(today_key()),
    {noreply, State};

handle_cast(_Msg, State) ->
    {noreply, State}.

-spec handle_info(term(), #state{}) -> {noreply, #state{}}.
handle_info(midnight_reset, State) ->
    ok = prune_old_data(today_key()),
    {noreply, State#state{timer_ref = schedule_midnight_reset()}};

handle_info(_Info, State) ->
    {noreply, State}.

-spec terminate(term(), #state{}) -> ok.
terminate(_Reason, #state{timer_ref = Ref}) ->
    case Ref of
        R when is_reference(R) -> _ = erlang:cancel_timer(R);
        _                      -> ok
    end,
    ok.

-spec code_change(term(), #state{}, term()) -> {ok, #state{}}.
code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

%%%==========================================================================
%%% Internal helpers
%%%==========================================================================

-spec today_key() -> day_key().
today_key() ->
    {Date, _} = erlang:universaltime(),
    Date.

-spec last_n_days(pos_integer()) -> [day_key()].
last_n_days(N) ->
    {Date, _} = erlang:universaltime(),
    Abs = calendar:date_to_gregorian_days(Date),
    [calendar:gregorian_days_to_date(Abs - I) || I <- lists:seq(0, N - 1)].

-spec shift_days(day_key(), integer()) -> day_key().
shift_days(Day, Offset) ->
    calendar:gregorian_days_to_date(
        calendar:date_to_gregorian_days(Day) + Offset).

-spec aggregate_day(day_key()) ->
    {Sessions :: non_neg_integer(),
     Minutes  :: non_neg_integer(),
     Users    :: non_neg_integer()}.
aggregate_day(Day) ->
    %% ordered_set prefix scan: only entries with key {Day, _} are visited.
    Rows = ets:match_object(?TABLE_DAILY, {{Day, '_'}, '_', '_'}),
    lists:foldl(
        fun({{_, _}, Mins, Cnt}, {S, M, U}) ->
            {S + Cnt, M + Mins, U + 1}
        end, {0, 0, 0}, Rows).

-spec date_to_binary(day_key()) -> binary().
date_to_binary({Y, M, D}) ->
    iolist_to_binary(io_lib:format("~4..0B-~2..0B-~2..0B", [Y, M, D])).

-spec update_streak(user_id(), day_key()) -> ok.
update_streak(UserId, Today) ->
    Yesterday = shift_days(Today, -1),
    case ets:lookup(?TABLE_STREAKS, UserId) of
        [{UserId, Cur, Yesterday, Best}] ->
            %% Consecutive day — extend streak.
            NewCur = Cur + 1,
            ets:insert(?TABLE_STREAKS,
                       {UserId, NewCur, Today, erlang:max(NewCur, Best)});
        [{UserId, _Cur, Today, _Best}] ->
            %% Already recorded today — idempotent, no write needed.
            ok;
        [{UserId, _Broken, _OldLast, Best}] ->
            %% Streak broken — restart at 1.
            ets:insert(?TABLE_STREAKS,
                       {UserId, 1, Today, erlang:max(1, Best)});
        [] ->
            %% First ever session.
            ets:insert(?TABLE_STREAKS, {UserId, 1, Today, 1})
    end,
    ok.

-spec prune_old_data(day_key()) -> ok.
prune_old_data(Today) ->
    Cutoff = shift_days(Today, -?RETENTION_DAYS),
    ets:select_delete(?TABLE_SESSIONS,
        [{{{'$1', '_'}, '_', '_', '_'}, [{'<', '$1', Cutoff}], [true]}]),
    ets:select_delete(?TABLE_DAILY,
        [{{{'$1', '_'}, '_', '_'}, [{'<', '$1', Cutoff}], [true]}]),
    ok.

-spec schedule_midnight_reset() -> reference().
schedule_midnight_reset() ->
    {_Date, {H, Min, S}} = erlang:universaltime(),
    SecsUntilMidnight = ?SECS_PER_DAY - (H * 3600 + Min * 60 + S),
    erlang:send_after(erlang:max(1, SecsUntilMidnight) * 1000,
                      self(), midnight_reset).