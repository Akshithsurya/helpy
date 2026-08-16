/**
 * Helpy Bot Companion Module
 * Remembers user actions, provides tech & productivity facts, and gives motivational support.
 * Uses the Ruby API as its primary backend and remains usable when the API is
 * temporarily unavailable. Integrates with the Erlang BEAM node for live diagnostics.
 */

const fs = require('fs');
const path = require('path');

const FACTS_CATALOG = [
  // Erlang & BEAM VM
  'Erlang was designed at Ericsson in 1986 by Joe Armstrong, Robert Virding, and Mike Williams for ultra-reliable telecom systems.',
  'BEAM (the Erlang VM) runs millions of lightweight processes — each isolated with its own heap, communicating only by message passing.',
  'Erlang\'s "let it crash" philosophy separates normal logic from fault recovery: supervisors restart crashed children automatically.',
  'OTP (Open Telecom Platform) provides gen_server, gen_statem, and supervisor patterns — the backbone of Erlang reliability.',
  'Erlang supports hot code swapping: you can upgrade a running production system with zero downtime, live.',
  'WhatsApp handled 2 million simultaneous connections per server with Erlang — a testament to BEAM concurrency.',
  'ETS (Erlang Term Storage) offers O(1) in-memory key-value tables shared across processes without copying.',
  'Mnesia is Erlang\'s built-in distributed real-time database, supporting transactions and cross-node replication.',
  'The BEAM scheduler runs one OS thread per CPU core; each Erlang process yields after a fixed number of reductions.',
  'Pattern matching in Erlang is pervasive — function heads, case expressions, and receive blocks all use it declaratively.',
  'Erlang binary syntax (the <<>> notation) makes network protocol parsing expressive and memory-safe.',
  'Erlang\'s process dictionary is a per-process mutable store useful for thread-local caching patterns.',
  // Productivity & focus science
  'The Pomodoro Technique was invented by Francesco Cirillo in 1987 using a tomato-shaped kitchen timer.',
  'Taking a 5-minute break every 25 minutes measurably restores attention and prevents decision fatigue.',
  'Writing down your specific daily goals increases completion rates by over 40%.',
  'The Zeigarnik effect: your brain holds unfinished tasks in active memory — completing them lowers cognitive load.',
  'Multitasking reduces effective IQ by up to 10 points due to cognitive-switching overhead.',
  'The human brain consumes ~20% of total body energy despite being only 2% of total body weight.',
  'Dopamine triggers during anticipation of goal achievement, boosting focus before you even finish.',
  '1% daily improvement compounds to 37x better performance over a full year.',
];

const MOTIVATION_CATALOG = {
  high: [
    'Outstanding performance! Your discipline and focus are setting the standard right now.',
    'Exceptional momentum. You are turning consistent effort into compounding results.',
    'Take a moment to recognise how far you have come — then keep pushing.',
  ],
  medium: [
    'Solid progress. Every completed task brings you measurably closer to your goals.',
    'Step by step, you are turning intentions into reality. Keep the cadence.',
    'Consistency is where results are made. You are building something real here.',
  ],
  low: [
    'Every large accomplishment begins with one small, concrete action. Pick one now.',
    'Progress over perfection. Start small and let momentum take care of the rest.',
    'A single focused session today changes the trajectory. You have everything you need.',
  ],
};

class BotCompanion {
  constructor(options = {}) {
    this.memoryFile = options.memoryFile || path.join(__dirname, 'bot-memory.json');
    this.rubyApiUrl = options.rubyApiUrl || 'http://localhost:4567/api/bot';
    this.erlangApiUrl = options.erlangApiUrl || 'http://localhost:8080/api';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs || 3000;
    const llm = options.llm || {};
    this.llm = {
      enabled: /^(1|true|yes|on)$/i.test(String(llm.enabled || '')),
      baseUrl: String(llm.baseUrl || '').trim(),
      apiKey: String(llm.apiKey || '').trim(),
      model: String(llm.model || '').trim(),
      timeoutMs: Math.max(1000, Number(llm.timeoutMs) || 8000),
    };
    this.rubyRetryAfter = 0;
    this.erlangRetryAfter = 0;
    this.memory = this.loadMemory();
  }

  loadMemory() {
    try {
      if (fs.existsSync(this.memoryFile)) {
        const raw = fs.readFileSync(this.memoryFile, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('BotCompanion: Failed to load local memory file:', e.message);
    }
    return {
      totalActions: 0,
      actions: [],
      actionCounts: {
        task_completed: 0,
        timer_completed: 0,
        focus_started: 0,
        habit_logged: 0,
      },
    };
  }

  saveMemory() {
    try {
      fs.writeFileSync(this.memoryFile, JSON.stringify(this.memory, null, 2), 'utf8');
    } catch (e) {
      console.warn('BotCompanion: Failed to save memory file:', e.message);
    }
  }

  /**
   * Log an action to memory (and try syncing with backends if available)
   */
  async logAction(type, detail = '', meta = {}) {
    const entry = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      type,
      detail,
      meta,
      timestamp: new Date().toISOString(),
    };

    this.memory.actions.unshift(entry);
    this.memory.actions = this.memory.actions.slice(0, 100);
    this.memory.totalActions = (this.memory.totalActions || 0) + 1;

    this.memory.actionCounts[type] = (this.memory.actionCounts[type] || 0) + 1;
    this.saveMemory();

    // Keep persistent backends in sync without blocking the interface.
    this.syncBackendAction(type, detail, meta).catch(() => { });
    this.syncErlangAction(type, detail).catch(() => { });

    return {
      success: true,
      action: entry,
      totalActions: this.memory.totalActions,
    };
  }

  async syncBackendAction(type, detail, meta = {}) {
    try {
      if (this.fetchImpl && Date.now() >= this.rubyRetryAfter) {
        await this.requestRuby('/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, detail, meta }),
        }).catch(() => { });
      }
    } catch (_) { }
  }

  async syncErlangAction(type, detail = '') {
    try {
      if (this.fetchImpl && Date.now() >= this.erlangRetryAfter) {
        await this.requestErlang('/bot/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, detail }),
        }).catch(() => { });
      }
    } catch (_) { }
  }

  async requestErlang(pathname, options) {
    if (!this.fetchImpl) throw new Error('Fetch is unavailable');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller?.abort();
        reject(new Error('Erlang API request timed out'));
      }, this.requestTimeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetchImpl(`${this.erlangApiUrl}${pathname}`, {
          ...options,
          ...(controller ? { signal: controller.signal } : {}),
        }),
        timeoutPromise,
      ]);
      if (!response.ok) throw new Error(`Erlang API returned ${response.status}`);
      return response;
    } catch (error) {
      this.erlangRetryAfter = Date.now() + 30_000;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Fetch live Erlang node diagnostics from the /api/erlang/status endpoint.
   * Returns a structured object with node name, uptime, process count, etc.
   * Falls back gracefully when the Erlang node is not reachable.
   */
  async erlangNodeInfo() {
    try {
      if (!this.fetchImpl || Date.now() < this.erlangRetryAfter) {
        return { available: false, reason: 'Erlang node not reachable (cooldown)' };
      }
      const res = await this.requestErlang('/erlang/status', { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        return { available: true, ...json };
      }
    } catch (_) { }
    return { available: false, reason: 'Erlang node offline or unreachable' };
  }

  /**
   * Make a bounded request to the Ruby service. A failed service is put on a
   * short cooldown so a missing Ruby runtime never makes every chat message
   * appear to hang.
   */
  async requestRuby(pathname, options) {
    if (!this.fetchImpl) throw new Error('Fetch is unavailable');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller?.abort();
        reject(new Error('Ruby API request timed out'));
      }, this.requestTimeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetchImpl(`${this.rubyApiUrl}${pathname}`, {
          ...options,
          ...(controller ? { signal: controller.signal } : {}),
        }),
        timeoutPromise,
      ]);
      if (!response.ok) throw new Error(`Ruby API returned ${response.status}`);
      return response;
    } catch (error) {
      this.rubyRetryAfter = Date.now() + 30_000;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  hasLlmConnection() {
    return Boolean(this.fetchImpl && this.llm.enabled && this.llm.baseUrl && this.llm.apiKey && this.llm.model);
  }

  async requestLlm(userInput, context = {}) {
    if (!this.hasLlmConnection()) return null;

    const endpoint = this.llm.baseUrl.endsWith('/chat/completions')
      ? this.llm.baseUrl
      : `${this.llm.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const history = Array.isArray(context.conversation)
      ? context.conversation
          .filter((message) => message && ['user', 'assistant'].includes(message.role) && String(message.content || '').trim())
          .slice(-8)
          .map((message) => ({ role: message.role, content: String(message.content).slice(0, 1500) }))
      : [];
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeout;
    try {
      const response = await Promise.race([
        this.fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.llm.apiKey}` },
          body: JSON.stringify({
            model: this.llm.model,
            temperature: 0.3,
            max_tokens: 700,
            messages: [
              {
                role: 'system',
                content: 'You are Helpy, a thoughtful productivity assistant. Give practical, concise help using the user\'s app context. Preserve continuity with the conversation. Never claim actions were completed unless you return one of these exact action values: toggle_focus_shield, start_timer, add_task. Return JSON only with answer, action, actionData, and actionChips.',
              },
              ...history,
              { role: 'user', content: JSON.stringify({ prompt: userInput, context: this.getContextSummary(context) }) },
            ],
          }),
          ...(controller ? { signal: controller.signal } : {}),
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller?.abort();
            reject(new Error('LLM request timed out'));
          }, this.llm.timeoutMs);
        }),
      ]);
      if (!response.ok) throw new Error(`LLM request failed with ${response.status}`);
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content || payload?.output_text || '';
      const jsonText = String(content).match(/\{[\s\S]*\}/)?.[0] || content;
      const parsed = typeof jsonText === 'string' ? JSON.parse(jsonText) : {};
      return this.normalizeAssistantResponse({ ...parsed, mode: 'llm', provider: 'configured-llm' });
    } catch (error) {
      console.warn('BotCompanion: LLM request failed, using local assistant:', error.message);
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Get what the bot remembers about the user
   */
  getMemorySummary() {
    const total = this.memory.totalActions || 0;
    const counts = this.memory.actionCounts || {};
    const recent = (this.memory.actions || []).slice(0, 10);

    let summary = `I have recorded ${total} action${total !== 1 ? 's' : ''} so far. `;
    if (counts.task_completed > 0) {
      summary += `You finished ${counts.task_completed} task${counts.task_completed > 1 ? 's' : ''}. `;
    }
    if (counts.focus_started > 0 || counts.timer_completed > 0) {
      const focusTotal = (counts.focus_started || 0) + (counts.timer_completed || 0);
      summary += `You ran ${focusTotal} focus session${focusTotal > 1 ? 's' : ''}. `;
    }
    if (counts.habit_logged > 0) {
      summary += `You logged habits ${counts.habit_logged} time${counts.habit_logged > 1 ? 's' : ''}. `;
    }
    if (total === 0) {
      summary = "I haven't recorded any actions yet. Complete a task or start a focus session to begin tracking.";
    }

    return {
      success: true,
      totalActions: total,
      actionCounts: counts,
      recentActions: recent,
      summary: summary.trim(),
    };
  }

  /**
   * Get a random tech or productivity fact
   */
  getRandomFact() {
    const idx = Math.floor(Math.random() * FACTS_CATALOG.length);
    return {
      success: true,
      fact: FACTS_CATALOG[idx],
      category: 'productivity & tech',
    };
  }

  /**
   * Get personalized motivational message
   */
  getMotivation() {
    const total = this.memory.totalActions || 0;
    let level = 'low';
    if (total >= 10) level = 'high';
    else if (total >= 3) level = 'medium';

    const pool = MOTIVATION_CATALOG[level];
    const idx = Math.floor(Math.random() * pool.length);

    return {
      success: true,
      motivation: pool[idx],
      activityLevel: level,
      totalActions: total,
    };
  }

  normalizeAssistantResponse(payload, fallback = {}) {
    const data = payload && payload.data && payload.success ? payload.data : payload;
    const normalized = data && typeof data === 'object' ? data : {};
    const answer = typeof normalized.answer === 'string' ? normalized.answer : fallback.answer || '';
    const planDraft = normalized.planDraft || normalized.plan_draft || fallback.planDraft || null;
    const suggestedCommands =
      normalized.suggestedCommands || normalized.suggested_commands || fallback.suggestedCommands || [];
    const warnings = normalized.warnings || fallback.warnings || [];
    const action = normalized.action || fallback.action || null;
    const actionData = normalized.actionData || fallback.actionData || null;
    const actionChips = normalized.actionChips || normalized.action_chips || fallback.actionChips || [];

    return {
      success: normalized.success !== false,
      answer,
      intent: normalized.intent || fallback.intent || 'assistant',
      mode: normalized.mode || fallback.mode || 'local',
      provider: normalized.provider || fallback.provider || null,
      planDraft,
      suggestedCommands: Array.isArray(suggestedCommands) ? suggestedCommands : [],
      warnings: Array.isArray(warnings) ? warnings : [],
      action,
      actionData,
      actionChips: Array.isArray(actionChips) ? actionChips : [],
    };
  }

  getContextSummary(context = {}) {
    const tasks = Array.isArray(context.tasks) ? context.tasks : [];
    const habits = Array.isArray(context.habits) ? context.habits : [];
    const notifications = Array.isArray(context.notifications) ? context.notifications : [];
    const openTasks = tasks.filter((task) => !task.completed && task.status !== 'completed');
    const activeNotifications = notifications.filter((item) => !item.dismissed);
    const totalMinutes =
      context.planStatistics?.totalMinutes || context.plan_statistics?.totalMinutes || 0;
    const focusedTodayMs =
      context.focusReport?.todayFocusedMs || context.focus_report?.todayFocusedMs || 0;

    const parts = [];
    if (openTasks.length) parts.push(`${openTasks.length} open tasks`);
    if (habits.length) parts.push(`${habits.length} habits`);
    if (activeNotifications.length) parts.push(`${activeNotifications.length} notifications`);
    if (totalMinutes > 0) parts.push(`${totalMinutes} planned minutes recently`);
    if (focusedTodayMs > 0) parts.push(`${Math.round(focusedTodayMs / 60000)} focused minutes today`);
    return parts.join(', ');
  }

  extractDurationMinutes(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    let match = text.match(/(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?/i);
    if (match) return parseInt(match[1], 10) * 60 + parseInt(match[2] || '0', 10);
    match = text.match(/(\d+)\s*h(?:ours?)?/i);
    if (match) return parseInt(match[1], 10) * 60;
    match = text.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
    if (match) return parseInt(match[1], 10);
    return null;
  }

  deriveLocalPlanDraft(userInput, context = {}) {
    const tasks = Array.isArray(context.tasks) ? context.tasks : [];
    const openTasks = tasks.filter((task) => !task.completed && task.status !== 'completed');
    const durationMinutes = Math.max(5, Math.min(240, this.extractDurationMinutes(userInput) || (openTasks.length >= 3 ? 45 : 30)));
    const chunkSizeMinutes = durationMinutes <= 30 ? 15 : durationMinutes <= 60 ? 20 : 25;
    const breakMinutes = durationMinutes >= 90 ? 10 : 5;
    const stripped = String(userInput || '').replace(/^\/plan\s*/i, '').trim();
    const cleaned = stripped
      .replace(/\b(plan|schedule|revise|adjust|around|today|tonight|tomorrow|i have|only have|my|next|task|tasks)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const title =
      cleaned.length > 0
        ? cleaned.split(' ').slice(0, 6).join(' ')
        : openTasks[0]?.title || 'Focused Work Session';

    return {
      title,
      goal: stripped || `Make progress on ${title.toLowerCase()}`,
      durationMinutes,
      chunkSizeMinutes,
      breakMinutes,
      tags: ['focus', ...(openTasks.length ? ['tasks'] : [])],
      tasks: openTasks.slice(0, 3).map((task) => ({ title: task.title })),
    };
  }

  isPlanningQuery(userInput, context = {}) {
    const text = String(userInput || '').toLowerCase().trim();
    return (
      context.assistantMode === 'plan' ||
      context.assistant_mode === 'plan' ||
      /\b(plan|schedule|prioriti[sz]e|revise|adjust|rework|only have|i have|fit|around|tonight|today|tomorrow)\b/.test(
        text
      )
    );
  }

  getTaskGuidance(context = {}) {
    const tasks = Array.isArray(context.tasks) ? context.tasks : [];
    const openTasks = tasks.filter((task) => !task.completed && task.status !== 'completed');
    const nextTask = openTasks[0];
    if (!nextTask) return 'You have no open tasks right now. Add one concrete task, then start a 25-minute focus block.';

    const title = String(nextTask.title || nextTask.name || 'your next task').trim();
    return `You have ${openTasks.length} open task${openTasks.length === 1 ? '' : 's'}. Start with **${title}**: define the smallest visible result, work on it for 25 minutes, then decide whether to continue.`;
  }

  getLocalDetailedResponse(userInput, context = {}) {
    const text = String(userInput || '').toLowerCase().trim();
    if (!text) {
      return this.normalizeAssistantResponse({
        answer: 'Tell me what you would like help with today.',
        intent: 'greeting',
        mode: 'local',
        actionChips: ['Activate Focus Shield', 'Start Focus Session', 'Give Motivation', 'Tell me a Fact'],
      });
    }

    // Erlang / BEAM queries
    if (
      text.includes('erlang') ||
      text.includes('beam') ||
      text.includes('otp') ||
      text.includes('gen_server') ||
      text.includes('supervisor')
    ) {
      const fact = FACTS_CATALOG.filter(
        (f) =>
          f.toLowerCase().includes('erlang') ||
          f.toLowerCase().includes('beam') ||
          f.toLowerCase().includes('otp')
      );
      const chosen = fact[Math.floor(Math.random() * fact.length)] || this.getRandomFact().fact;
      return this.normalizeAssistantResponse({
        answer: `**Erlang / BEAM Insight:**\n${chosen}\n\nHelpy's backend includes an Erlang node running OTP gen_servers for session tracking, analytics, and fault-tolerant message processing.`,
        intent: 'erlang_info',
        mode: 'local',
        actionChips: ['Tell me more about Erlang', 'Start Focus Session', 'View Erlang Status'],
      });
    }

    // Direct Shield intent
    if (text.includes('shield') || text.includes('block distraction') || text.includes('focus mode')) {
      return this.normalizeAssistantResponse({
        answer: '**Focus Shield Activated.**\nSingle-task focus mode is engaged. Distractions are shielded.',
        intent: 'focus_shield',
        mode: 'local',
        action: 'toggle_focus_shield',
        actionChips: ['Toggle Shield', 'Start 25m Timer', 'View Tasks'],
      });
    }

    // Direct Start Timer intent
    if (text.startsWith('start') && (text.includes('timer') || text.includes('pomodoro') || text.includes('focus') || text.includes('work'))) {
      const minutes = this.extractDurationMinutes(text) || 25;
      return this.normalizeAssistantResponse({
        answer: `**Focus Timer — ${minutes} minutes.**\nStarting your session. Enter deep flow and eliminate distractions.`,
        intent: 'start_timer',
        mode: 'local',
        action: 'start_timer',
        actionData: { durationMinutes: minutes },
        actionChips: ['Activate Focus Shield', 'Play Soundscape', 'View Tasks'],
      });
    }

    // Direct Add Task intent
    if (text.startsWith('add task') || text.startsWith('create task') || text.startsWith('remind me to')) {
      const taskTitle = text
        .replace(/^(add task|create task|remind me to)\s*/i, '')
        .trim();
      const finalTitle = taskTitle.length > 0 ? taskTitle : 'New Focus Task';
      return this.normalizeAssistantResponse({
        answer: `**Task Added:** "${finalTitle}" has been created in your workspace.`,
        intent: 'add_task',
        mode: 'local',
        action: 'add_task',
        actionData: { title: finalTitle },
        actionChips: ['Start Focus on Task', 'Activate Focus Shield'],
      });
    }

    if (text.includes('fact') || text.includes('tell me something') || text.includes('learn')) {
      return this.normalizeAssistantResponse({
        answer: `**Did you know?**\n${this.getRandomFact().fact}`,
        intent: 'fact',
        mode: 'local',
        actionChips: ['Give Motivation', 'Start Focus Session', 'Memory Summary'],
      });
    }

    if (
      text.includes('motivation') ||
      text.includes('inspire') ||
      text.includes('encourage') ||
      text.includes('cheer')
    ) {
      return this.normalizeAssistantResponse({
        answer: `**Bot Motivation:**\n${this.getMotivation().motivation}`,
        intent: 'motivation',
        mode: 'local',
        actionChips: ['Activate Focus Shield', 'Start 25m Focus', 'Tell me a Fact'],
      });
    }

    if (
      text.includes('remember') ||
      text.includes('memory') ||
      text.includes('what did i do') ||
      text.includes('history') ||
      text.includes('stats')
    ) {
      return this.normalizeAssistantResponse({
        answer: `**What I Remember About You:**\n${this.getMemorySummary().summary}`,
        intent: 'memory',
        mode: 'local',
        actionChips: ['Give Motivation', 'Start Focus Session', 'Focus Shield'],
      });
    }

    if (text.includes('focus') || text.includes('distract') || text.includes('concentrat')) {
      return this.normalizeAssistantResponse({
        answer:
          'Focus reset protocol:\n1. Choose one task with a clear finish line.\n2. Remove one distraction source before you begin.\n3. Work for 25 minutes, then take a five-minute break.',
        intent: 'focus',
        mode: 'local',
        actionChips: ['Activate Focus Shield', 'Start 25m Timer'],
      });
    }

    if (this.isPlanningQuery(userInput, context) || text.includes('task') || text.includes('next action')) {
      const planDraft = this.deriveLocalPlanDraft(userInput, context);
      const contextSummary = this.getContextSummary(context);
      return this.normalizeAssistantResponse({
        answer: `I mapped out a ${planDraft.durationMinutes}-minute plan for **${planDraft.title}**.${contextSummary ? ` (${contextSummary})` : ''}`,
        intent: 'planning_assistant',
        mode: 'local',
        planDraft,
        suggestedCommands: [`/plan ${planDraft.title} ${planDraft.durationMinutes}`],
        actionChips: ['Focus Shield', `Start ${planDraft.durationMinutes}m Session`],
      });
    }

    if (text.includes('help') || text.includes('what can you do')) {
      return this.normalizeAssistantResponse({
        answer:
          'Helpy Bot capabilities:\n- Activate Focus Shield for single-task mode\n- Start Pomodoro focus timers\n- Add and manage tasks\n- Share productivity and Erlang engineering facts\n- Summarise your progress and session history\n- Query live Erlang node status',
        intent: 'help',
        mode: 'local',
        actionChips: ['Activate Focus Shield', 'Start 25m Focus', 'Give Motivation', 'Tell me a Fact'],
      });
    }

    if (/^(hello|hi|hey|greetings|sup|helpy)\b/.test(text)) {
      return this.normalizeAssistantResponse({
        answer: "Hi! I'm **Helpy Companion Bot**, your notebook assistant and focus companion. How can I help you plan your tasks, manage timers, or answer questions today?",
        intent: 'greeting',
        mode: 'local',
        actionChips: ['Focus Shield Mode', 'Start Focus Session', 'Give Motivation', 'Tell me a Fact'],
      });
    }

    return null;
  }

  /**
   * Respond to user prompts/questions in bot chat interface
   */
  async processQueryDetailed(userInput = '', context = {}) {
    const localResponse = this.getLocalDetailedResponse(userInput, context);
    const shouldTryBackend =
      !localResponse ||
      this.isPlanningQuery(userInput, context) ||
      localResponse.intent === 'help' ||
      localResponse.intent === 'planning_assistant';

    try {
      if (this.hasLlmConnection()) {
        const llmResponse = await this.requestLlm(userInput, context);
        if (llmResponse?.answer) return llmResponse;
      }
      if (shouldTryBackend && this.fetchImpl && Date.now() >= this.rubyRetryAfter) {
        const res = await this.requestRuby('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: userInput, context }),
        });
        if (res.ok) {
          const json = await res.json();
          const normalized = this.normalizeAssistantResponse(json, localResponse || {});
          if (normalized.answer) return normalized;
        }
      }
    } catch (_) {
      // Fallback to local processing if Ruby server is offline
    }

    if (localResponse) return localResponse;

    const mem = this.getMemorySummary();
    const mot = this.getMotivation();
    return this.normalizeAssistantResponse({
      answer: `Helpy Bot: ${mem.summary}\n\n${mot.motivation}`,
      intent: 'general_inquiry',
      mode: 'local',
      actionChips: ['Activate Focus Shield', 'Start Focus Session', 'Tell me a Fact'],
    });
  }

  async processQuery(userInput = '', context = {}) {
    const response = await this.processQueryDetailed(userInput, context);
    return response.answer;
  }
}

module.exports = {
  BotCompanion,
  FACTS_CATALOG,
  MOTIVATION_CATALOG,
};
