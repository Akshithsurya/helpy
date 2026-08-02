# Weekly focus chart data shared by the desktop renderer.
# Uses local calendar days so a session is never shifted into the wrong bar by UTC.

localDateKey = (value) ->
  date = new Date(value)
  return '' if Number.isNaN(date.getTime())
  month = String(date.getMonth() + 1).padStart(2, '0')
  day = String(date.getDate()).padStart(2, '0')
  "#{date.getFullYear()}-#{month}-#{day}"

normalizeDateKey = (value) ->
  if typeof value is 'string' and /^\d{4}-\d{2}-\d{2}$/.test(value)
    value
  else
    localDateKey(value)

numberOrZero = (value) ->
  amount = Number(value)
  if Number.isFinite(amount) and amount > 0 then Math.round(amount) else 0

buildWeeklyFocusSeries = (planStats = {}, focusReport = {}, daysToShow = 7, now = new Date()) ->
  totalDays = Math.max(1, Number.parseInt(daysToShow, 10) or 7)
  plannedMinutes = planStats?.dailyStats ? {}

  # Aggregate completed sessions by local date key
  completedSessions = {}
  for session in focusReport?.weeklyTrend ? []
    key = normalizeDateKey(session.date)
    continue unless key
    
    # Convert milliseconds before normalising so short recorded sessions are kept.
    minutes = numberOrZero(Number(session.durationMs) / 60000)
    completedSessions[key] = (completedSessions[key] ? 0) + minutes

  # Generate chart points using a list comprehension
  for offset in [totalDays - 1..0]
    date = new Date(now)
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    
    key = localDateKey(date)
    planned = numberOrZero(plannedMinutes?[key]?.minutes)
    completed = numberOrZero(completedSessions[key])
    
    # The last expression in a comprehension is pushed to the resulting array
    dateKey: key
    label: date.toLocaleDateString(undefined, weekday: 'short')
    minutes: planned + completed
    plannedMinutes: planned
    completedMinutes: completed

module.exports = { buildWeeklyFocusSeries }
