/*
 * Small, browser-native omnibox command handler.
 *
 * Chrome service workers do not provide CommonJS `require`, so they cannot
 * execute the Node/Electron planner module. This keeps the useful omnibox
 * workflow fast and dependency-free while the desktop app continues to use
 * the full planner.
 */
(function attachBrowserCommandHandler(scope) {
  const PRESETS = Object.freeze({
    work: { title: 'Work Session', durationMinutes: 60, goal: 'Focus on work tasks' },
    study: { title: 'Study Session', durationMinutes: 45, goal: 'Focus on studying' },
    focus: { title: 'Deep Focus', durationMinutes: 25, goal: 'Deep focus session' },
    code: { title: 'Coding Session', durationMinutes: 90, goal: 'Write code and solve problems' },
    write: { title: 'Writing Session', durationMinutes: 45, goal: 'Write articles, docs, or content' },
    read: { title: 'Reading Session', durationMinutes: 30, goal: 'Read and learn' },
  });

  function cleanText(value, maxLength) {
    return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLength);
  }

  function makePlan(args) {
    const value = cleanText(args, 180);
    const presetName = Object.keys(PRESETS).find((name) => value.toLowerCase() === name || value.toLowerCase().startsWith(`${name} `));
    const preset = presetName ? PRESETS[presetName] : null;
    const remainder = presetName ? value.slice(presetName.length).trim() : value;
    const minutesMatch = remainder.match(/(?:^|\s)(\d{1,3})\s*(?:m|min|mins|minutes)?\b/i);
    const durationMinutes = Math.max(5, Math.min(240, Number(minutesMatch ? minutesMatch[1] : preset?.durationMinutes || 30)));
    const title = cleanText((remainder.replace(minutesMatch?.[0] || '', '').trim()) || preset?.title || 'Focus session', 100);
    const goalMatch = value.match(/--goal\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
    const goal = cleanText(goalMatch?.[1] || goalMatch?.[2] || goalMatch?.[3] || preset?.goal || title, 500);
    return { title, goal, durationMinutes, chunkSizeMinutes: Math.min(30, Math.max(5, Math.round(durationMinutes / 3 / 5) * 5 || 15)), source: 'omnibox' };
  }

  class BrowserCommandHandler {
    constructor(background) {
      this.background = background || {};
    }

    getSuggestions(text) {
      const query = String(text || '').toLowerCase().trim();
      const commands = [
        ['plan focus', 'Start a 25-minute deep-focus plan'],
        ['plan work', 'Start a 60-minute work plan'],
        ['plan study', 'Start a 45-minute study plan'],
        ['pomodoro start', 'Start a focus timer'],
        ['report', 'Open Helpy reports'],
      ];
      return commands.filter(([content]) => !query || content.startsWith(query) || content.includes(query)).map(([content, description]) => ({ content, description }));
    }

    async handleCommand(text) {
      const [command = '', ...rest] = String(text || '').trim().split(/\s+/);
      const args = rest.join(' ');
      if (command.toLowerCase() === 'plan') {
        if (!args || args.toLowerCase() === 'help') {
          return { action: 'showNotification', title: 'Helpy plans', message: 'Try: plan focus, plan work 60, or plan study --goal "Read chapter 3".' };
        }
        const plan = makePlan(args);
        const result = await this.background.sendPlanToApp?.(plan);
        this.background.onPlanActivated?.(result?.plan || plan, { syncStatus: result?.success === false ? 'local-only' : 'synced' });
        return { action: 'showNotification', title: result?.success === false ? 'Plan saved locally' : 'Plan started', message: `${plan.title} · ${plan.durationMinutes} min` };
      }
      if (command.toLowerCase() === 'pomodoro') return this.background.handlePomodoroCommand?.(args) || { action: 'showNotification', title: 'Pomodoro', message: 'Use start, pause, resume, or reset.' };
      if (command.toLowerCase() === 'report') { await this.background.openReports?.(); return { action: 'none' }; }
      return { action: 'showNotification', title: 'Helpy commands', message: 'Try plan focus, pomodoro start, or report.' };
    }
  }

  scope.BrowserCommandHandler = BrowserCommandHandler;
})(self);
