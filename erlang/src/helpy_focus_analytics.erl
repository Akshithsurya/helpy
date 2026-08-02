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
-define(TABLE_DAILY,    helpy_analytics_daily).     %% set,        key = {Day, UserId}
-define(TABLE_STREAKS,  helpy_analytics_streaks).   %% set,        key = UserId
-define(RETENTION_DAYS, 7).

-type user_id() :: binary().
-type minutes() :: non_neg_integer().
-type day_key() :: calendar:date().                 %% {Y, M, D}

-record(state, {
    last_reset_day :: day_key() | undefined,
    timer_ref      :: reference() | undefined,
    seq            :: non_neg_integer()
}).

%%%==========================================================================
%%% Public API
%%%==========================================================================

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?SERVER}, ?MODULE, [], []).

-spec record_session(user_id(), binary(), minutes()) -> ok.
record_session(UserId, Title, DurationMinutes) ->
    gen_server:cast(?SERVER, {record_session, UserId, Title, DurationMinutes}).

-spec get_daily_stats() -> map().
get_daily_stats() ->
    Today = today_key(),
    Rows  = daily_rows_for(Today),
    #{
        date           => date_to_binary(Today),
        total_sessions => lists:sum([C || {_, _, C} <- Rows]),
        total_minutes  => lists:sum([M || {_, M, _}  <- Rows]),
        unique_users   => length(Rows)
    }.

-spec get_weekly_summary() -> [map()].
get_weekly_summary() ->
    [begin
         Rows = daily_rows_for(Day),
         #{
            date     => date_to_binary(Day),
            sessions => lists:sum([C || {_, _, C} <- Rows]),
            minutes  => lists:sum([M || {_, M, _}  <- Rows])
         }
     end || Day <- last_n_days(?RETENTION_DAYS)].

-spec top_focus_streaks(pos_integer()) -> [map()].
top_focus_streaks(N) ->
    Entries = ets:foldl(
        fun({UserId, Cur, _LastDay, Best}, Acc) ->
            [#{user_id => UserId, streak => Cur, best => Best} | Acc]
        end, [], ?TABLE_STREAKS),
    Ranked = lists:sort(
        fun(A, B) ->
            {maps:get(streak, A), maps:get(best, A)} >=
            {maps:get(streak, B), maps:get(best, B)}
        end, Entries),
    lists:sublist(Ranked, N).

-spec user_stats(user_id()) -> map().
user_stats(UserId) ->
    {Sessions, Minutes} =
        ets:foldl(
            fun({{_, U}, Mins, Cnt}, {S, Mn}) when U =:= UserId ->
                    {S + Cnt, Mn + Mins};
               (_, Acc) -> Acc
            end, {0, 0}, ?TABLE_DAILY),
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
    ets:new(?TABLE_DAILY,    [named_table, set, public,
                              {keypos, 1}, {read_concurrency, true}]),
    ets:new(?TABLE_STREAKS,  [named_table, set, public,
                              {keypos, 1}, {read_concurrency, true}]),
    Today = today_key(),
    ok = prune_old_data(Today),
    TimerRef = schedule_midnight_reset(),
    {ok, #state{last_reset_day = Today, timer_ref = TimerRef, seq = 0}}.

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
    ets:update_counter(?TABLE_DAILY, {Today, UserId},
                       [{2, DurationMinutes}, {3, 1}],
                       {{Today, UserId}, 0, 0}),
    ok = update_streak(UserId, Today),
    {noreply, State#state{seq = Seq}};

handle_cast(reset_daily, State) ->
    Today = today_key(),
    ok = prune_old_data(Today),
    {noreply, State#state{last_reset_day = Today}};

handle_cast(_Msg, State) ->
    {noreply, State}.

-spec handle_info(term(), #state{}) -> {noreply, #state{}}.
handle_info(midnight_reset, State) ->
    Today = today_key(),
    ok = prune_old_data(Today),
    TimerRef = schedule_midnight_reset(),
    {noreply, State#state{last_reset_day = Today, timer_ref = TimerRef}};

handle_info(_Info, State) ->
    {noreply, State}.

-spec terminate(term(), #state{}) -> ok.
terminate(_Reason, State) ->
    case State#state.timer_ref of
        Ref when is_reference(Ref) -> erlang:cancel_timer(Ref);
        _ -> ok
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
    %% system_time -> UTC seconds -> UTC date. No double-offset.
    {Date, _} = calendar:system_time_to_universal_time(
                   erlang:system_time(second), second),
    Date.

-spec last_n_days(pos_integer()) -> [day_key()].
last_n_days(N) ->
    Today = today_key(),
    Abs   = calendar:date_to_gregorian_days(Today),
    [calendar:gregorian_days_to_date(Abs - I) || I <- lists:seq(0, N - 1)].

-spec daily_rows_for(day_key()) -> [tuple()].
daily_rows_for(Day) ->
    %% Day is bound in the pattern, so this select is efficient.
    ets:select(?TABLE_DAILY,
               [{{{Day, '_'}, '_', '_'}, [], ['$_']}]).

-spec date_to_binary(day_key()) -> binary().
date_to_binary({Y, M, D}) ->
    iolist_to_binary(io_lib:format("~4..0B-~2..0B-~2..0B", [Y, M, D])).

-spec update_streak(user_id(), day_key()) -> ok.
update_streak(UserId, Today) ->
    Yesterday = calendar:gregorian_days_to_date(
                   calendar:date_to_gregorian_days(Today) - 1),
    case ets:lookup(?TABLE_STREAKS, UserId) of
        [{UserId, Cur, Yesterday, Best}] ->
            %% Streak continued from yesterday.
            NewCur = Cur + 1,
            ets:insert(?TABLE_STREAKS,
                       {UserId, NewCur, Today, erlang:max(NewCur, Best)});
        [{UserId, Cur, Today, Best}] ->
            %% Already active today — idempotent.
            ets:insert(?TABLE_STREAKS, {UserId, Cur, Today, Best});
        [{UserId, _Broken, _OldLast, Best}] ->
            %% Streak broken — start fresh at 1.
            ets:insert(?TABLE_STREAKS,
                       {UserId, 1, Today, erlang:max(1, Best)});
        [] ->
            ets:insert(?TABLE_STREAKS, {UserId, 1, Today, 1})
    end,
    ok.

-spec prune_old_data(day_key()) -> ok.
prune_old_data(Today) ->
    Cutoff = calendar:gregorian_days_to_date(
               calendar:date_to_gregorian_days(Today) - ?RETENTION_DAYS),
    ets:select_delete(?TABLE_SESSIONS,
        [{{{'$1', '_'}, '_', '_', '_'}, [{'<', '$1', Cutoff}], [true]}]),
    ets:select_delete(?TABLE_DAILY,
        [{{{'$1', '_'}, '_', '_'}, [{'<', '$1', Cutoff}], [true]}]),
    ok.

-spec schedule_midnight_reset() -> reference().
schedule_midnight_reset() ->
    {_, {H, Min, S}} = calendar:universal_time(),
    SecsUntilMidnight = (24 * 3600) - (H * 3600 + Min * 60 + S),
    %% Add a 1-second floor to avoid pathological tight loops if called
    %% right at midnight.
    erlang:send_after(erlang:max(1, SecsUntilMidnight) * 1000,
                      self(), midnight_reset).