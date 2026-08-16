const globalScope = typeof self !== 'undefined' ? self : globalThis;
const injectedDeps =
  globalScope && globalScope.__helpyCommandDeps && typeof globalScope.__helpyCommandDeps === 'object'
    ? globalScope.__helpyCommandDeps
    : {};
const planCommandDeps =
  injectedDeps.planCommand || require('./shared/plan-command');
const planValidatorDeps =
  injectedDeps.planValidator || require('./shared/plan-validator');
const {
  parsePlanArguments,
  createPlanConfig,
  createPlanConfigOptimized,
  listPresets,
  getAutocompleteSuggestions,
  listShortcuts,
  addToPlanHistory,
  getSmartSuggestions,
  comparePlans,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  createBatchPlans,
  exportPlanEnhanced,
  getPlanHistory,
} = planCommandDeps;
const { validatePlan } = planValidatorDeps;

class CommandHandler {
  constructor(backgroundContext) {
    this.background = backgroundContext;
    this.commands = this.registerCommands();
    this.commandHistory = [];
  }

  registerCommands() {
    return {
      plan: {
        description: 'Plan your tasks and goals',
        suggestions: [
          'plan work',
          'plan study',
          'plan focus',
          "plan today's tasks",
          'plan help',
          'plan suggest',
          'plan template',
        ],
        handler: this.handlePlanCommand.bind(this),
      },
      task: {
        description: 'Add a new task',
        suggestions: ['task Finish report', 'task Buy groceries', 'task Call mom'],
        handler: this.handleTaskCommand.bind(this),
      },
      habit: {
        description: 'Add or track a habit',
        suggestions: ['habit Read 30 minutes', 'habit Exercise daily', 'habit Drink water'],
        handler: this.handleHabitCommand.bind(this),
      },
      pomodoro: {
        description: 'Control the Pomodoro timer',
        suggestions: ['pomodoro start', 'pomodoro stop', 'pomodoro break'],
        handler: this.handlePomodoroCommand.bind(this),
      },
      report: {
        description: 'Open time usage reports',
        suggestions: ['report today', 'report week'],
        handler: this.handleReportCommand.bind(this),
      },
      help: {
        description: 'Show available commands',
        suggestions: ['help'],
        handler: this.handleHelpCommand.bind(this),
      },
      track: {
        description: 'Start tracking an activity',
        suggestions: ['track focus', 'track work'],
        handler: this.handleTrackCommand.bind(this),
      },
      settings: {
        description: 'Open extension settings',
        suggestions: ['settings'],
        handler: this.handleSettingsCommand.bind(this),
      },
    };
  }

  getSuggestions(text) {
    const suggestions = [];
    const searchText = text.toLowerCase().trim();

    // If it's a plan command, get enhanced suggestions
    if (searchText.startsWith('plan') || searchText === '') {
      const planArgs = searchText.replace(/^plan\s*/, '');
      const autocompleteSuggestions = getAutocompleteSuggestions(planArgs);

      autocompleteSuggestions.forEach((suggestion) => {
        suggestions.push({
          content: `plan ${suggestion.content}`,
          description: `${suggestion.description} (${suggestion.type})`,
          priority: suggestion.priority,
        });
      });

      // Add shortcut suggestions
      const shortcuts = listShortcuts();
      shortcuts.forEach((shortcut) => {
        suggestions.push({
          content: `plan ${shortcut.command}`,
          description: `快捷方式: ${shortcut.name}`,
          priority: 95,
        });
      });
    }

    // Add regular command suggestions
    for (const [name, cmd] of Object.entries(this.commands)) {
      if (name.startsWith(searchText) || searchText === '') {
        cmd.suggestions.forEach((suggestion) => {
          suggestions.push({
            content: suggestion,
            description: cmd.description,
            priority: 50,
          });
        });
      }
    }

    // Sort by priority and remove duplicates
    const seen = new Set();
    return suggestions
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .filter((suggestion) => {
        if (seen.has(suggestion.content)) return false;
        seen.add(suggestion.content);
        return true;
      })
      .slice(0, 10);
  }

  parsePlanArguments(args) {
    return parsePlanArguments(args);
  }

  createPlanCommandResult(planConfig, overrides = {}) {
    return {
      action: 'showNotification',
      title: overrides.title || 'Plan Created!',
      message:
        overrides.message ||
        `Starting ${planConfig.title} for ${planConfig.durationMinutes} minutes in Helpy.`,
      options: { duration: overrides.duration || 3000 },
      planConfig: overrides.planConfig || planConfig,
      syncStatus: overrides.syncStatus || 'synced',
    };
  }

  async sendPlanToApp(planConfig) {
    if (this.background && typeof this.background.sendPlanToApp === 'function') {
      return this.background.sendPlanToApp(planConfig);
    }

    try {
      const bridgeTokenData = await chrome.storage.sync.get('bridgeToken');
      const bridgeToken = bridgeTokenData.bridgeToken;
      const response = await fetch('http://localhost:3456/api/focus-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bridgeToken ? { 'X-Helpy-Bridge-Token': bridgeToken } : {}),
        },
        body: JSON.stringify(planConfig),
      });

      if (!response.ok) {
        console.error('API error:', response.status, response.statusText);
        return {
          success: false,
          error: 'API error: ' + response.status,
          reason: response.status === 401 || response.status === 403 ? 'auth-error' : 'http-error',
        };
      }

      const result = await response.json().catch(() => null);
      if (!result || result.success === false) {
        return {
          success: false,
          error: result?.error || 'Invalid API response',
          reason: 'invalid-response',
        };
      }

      return { success: true, result };
    } catch (error) {
      console.error('Error sending plan to app:', error);
      return { success: false, error: error.message, reason: 'network-error' };
    }
  }

  notifyPlanActivation(planConfig, syncStatus = 'synced') {
    if (this.background && typeof this.background.onPlanActivated === 'function') {
      this.background.onPlanActivated(planConfig, { syncStatus });
    }
  }

  async handleCommand(text) {
    const parts = text.trim().split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    if (this.commands[commandName]) {
      return await this.commands[commandName].handler(args);
    }

    return {
      action: 'showNotification',
      title: 'Unknown Command',
      message: `Unknown command: ${commandName}. Type "help" to see available commands.`,
      options: { duration: 3000 },
    };
  }

  async handlePlanCommand(args) {
    const startTime = Date.now();
    const trimmedArgs = String(args || '').trim();
    const effectiveArgs = trimmedArgs || 'work';
    const lowerTrimmedArgs = effectiveArgs.toLowerCase();

    // Handle /plan help
    if (lowerTrimmedArgs === 'help') {
      return {
        action: 'showNotification',
        title: 'Plan Command Help',
        message: `可用命令:
- plan help: 显示帮助
- plan list: 显示预设列表
- plan <preset>: 使用预设（work、study、focus等）
- plan <title> <duration>: 创建自定义计划
- plan <title> <duration> --goal "目标" --tags "标签1,标签2"

新增功能:
- plan suggest: 获取智能时间建议
- plan compare: 对比两个计划
- plan template save/load/list/delete: 管理计划模板
- plan batch: 批量创建计划
- plan export [json/markdown/csv]: 导出计划

示例: plan work 60 --goal "完成项目"`,
        options: { duration: 20000 },
      };
    }

    // Handle /plan list
    if (lowerTrimmedArgs === 'list') {
      const presets = listPresets();
      const shortcuts = listShortcuts();

      let message = 'Predefined Plans:\n';
      presets.forEach((p) => {
        message += `- ${p.name}: ${p.title} (${p.durationMinutes}分钟)\n`;
      });

      if (shortcuts.length > 0) {
        message += '\nMy Shortcuts:\n';
        shortcuts.forEach((s) => {
          message += `- ${s.name}: ${s.command}\n`;
        });
      }

      return {
        action: 'showNotification',
        title: 'Available Plan Presets',
        message: message,
        options: { duration: 15000 },
      };
    }

    // 功能 1: /plan suggest
    if (lowerTrimmedArgs.startsWith('suggest')) {
      const suggestions = getSmartSuggestions();
      return {
        action: 'showNotification',
        title: '🎯 Smart Time Suggestions',
        message: `Best time: ${suggestions.bestTimeOfDay}
Productivity: ${suggestions.productivityPrediction.toUpperCase()}

Recommended:
- Duration: ${suggestions.recommendedDuration} min
- Chunk size: ${suggestions.recommendedChunkSize} min
- Break: ${suggestions.recommendedBreakMinutes} min

Tips:
${suggestions.tips.map((t) => `- ${t}`).join('\n')}`,
        options: { duration: 15000 },
      };
    }

    // 功能 2: /plan compare
    if (lowerTrimmedArgs.startsWith('compare')) {
      const history = getPlanHistory();
      if (history.length < 2) {
        return {
          action: 'showNotification',
          title: 'Not Enough Plans',
          message: 'Need at least 2 plans in history to compare. Create some plans first!',
          options: { duration: 5000 },
        };
      }
      const comparison = comparePlans(history[0], history[1]);
      return {
        action: 'showNotification',
        title: '📊 Plan Comparison',
        message: `${comparison.plan1Stats.totalFocusMinutes} vs ${comparison.plan2Stats.totalFocusMinutes} focus minutes
Duration diff: ${comparison.differences.durationDiff > 0 ? '+' : ''}${comparison.differences.durationDiff} min
Task diff: ${comparison.differences.taskCountDiff > 0 ? '+' : ''}${comparison.differences.taskCountDiff}
${comparison.recommendation}`,
        options: { duration: 10000 },
      };
    }

    // 功能 3: /plan template
    if (lowerTrimmedArgs.startsWith('template')) {
      const templateArgs = trimmedArgs.slice('template'.length).trim();
      const templateParts = templateArgs.split(/\s+/);
      const templateAction = templateParts[0]?.toLowerCase();

      if (templateAction === 'save') {
        const name = templateParts[1];
        if (!name) {
          return {
            action: 'showNotification',
            title: 'Template Name Required',
            message: 'Usage: plan template save <name>',
            options: { duration: 5000 },
          };
        }
        const history = getPlanHistory();
        if (history.length === 0) {
          return {
            action: 'showNotification',
            title: 'No Plans in History',
            message: 'Create a plan first before saving as template',
            options: { duration: 5000 },
          };
        }
        saveTemplate(name, history[0]);
        return {
          action: 'showNotification',
          title: '✅ Template Saved',
          message: `Template "${name}" saved successfully!`,
          options: { duration: 5000 },
        };
      } else if (templateAction === 'load') {
        const name = templateParts[1];
        if (!name) {
          return {
            action: 'showNotification',
            title: 'Template Name Required',
            message: 'Usage: plan template load <name>',
            options: { duration: 5000 },
          };
        }
        const template = loadTemplate(name);
        if (template) {
          const planConfig = createPlanConfigOptimized(template.name, template.planConfig);
          addToPlanHistory(planConfig);
          return this.createPlanCommandResult(planConfig);
        }
        return {
          action: 'showNotification',
          title: 'Template Not Found',
          message: `Template "${name}" not found. Use "plan template list" to see available templates.`,
          options: { duration: 5000 },
        };
      } else if (templateAction === 'list') {
        const templates = listTemplates();
        if (templates.length === 0) {
          return {
            action: 'showNotification',
            title: 'No Templates',
            message: 'No templates saved yet. Use "plan template save <name>" to save one.',
            options: { duration: 5000 },
          };
        }
        let message = 'Saved Templates:\n';
        templates.forEach((t) => {
          message += `- ${t.name}${t.description ? ': ' + t.description : ''}\n`;
        });
        return {
          action: 'showNotification',
          title: '📋 Saved Templates',
          message: message,
          options: { duration: 10000 },
        };
      } else if (templateAction === 'delete') {
        const name = templateParts[1];
        if (!name) {
          return {
            action: 'showNotification',
            title: 'Template Name Required',
            message: 'Usage: plan template delete <name>',
            options: { duration: 5000 },
          };
        }
        const deleted = deleteTemplate(name);
        return {
          action: 'showNotification',
          title: deleted ? '✅ Template Deleted' : 'Template Not Found',
          message: deleted ? `Template "${name}" deleted.` : `Template "${name}" not found.`,
          options: { duration: 5000 },
        };
      }
      return {
        action: 'showNotification',
        title: 'Template Commands',
        message:
          'Usage:\n- plan template save <name>\n- plan template load <name>\n- plan template list\n- plan template delete <name>',
        options: { duration: 8000 },
      };
    }

    // 功能 4: /plan batch
    if (lowerTrimmedArgs.startsWith('batch')) {
      const batchArgs = trimmedArgs.slice('batch'.length).trim();
      const taskNames = batchArgs
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);
      if (taskNames.length === 0) {
        return {
          action: 'showNotification',
          title: 'Batch Usage',
          message: 'Usage: plan batch Task1, Task2, Task3',
          options: { duration: 5000 },
        };
      }
      const plans = createBatchPlans({
        tasks: taskNames.map((name) => ({ title: name })),
      });
      plans.forEach((p) => addToPlanHistory(p));
      return {
        action: 'showNotification',
        title: '✅ Batch Plans Created',
        message: `${plans.length} plans created:\n${taskNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
        options: { duration: 10000 },
      };
    }

    // /plan export
    if (lowerTrimmedArgs.startsWith('export')) {
      const exportArgs = trimmedArgs.slice('export'.length).trim();
      const format = (exportArgs || 'json').toLowerCase();
      const history = getPlanHistory();
      if (history.length === 0) {
        return {
          action: 'showNotification',
          title: 'No Plans',
          message: 'No plans in history to export.',
          options: { duration: 5000 },
        };
      }
      const exported = exportPlanEnhanced(history[0], format);
      return {
        action: 'showNotification',
        title: `📄 Exported (${format.toUpperCase()})`,
        message: exported.substring(0, 500) + (exported.length > 500 ? '...' : ''),
        options: { duration: 15000 },
      };
    }

    // Validate command arguments
    const validation = validatePlan(args);
    if (!validation.valid || validation.errors?.length > 0) {
      const errorMessage = validation.errors.map((e) => e.message).join('\n') || '参数验证失败';
      return {
        action: 'showNotification',
        title: 'Invalid Plan Command',
        message: `${errorMessage}\n\n使用 "plan help" 获取更多帮助`,
        options: { duration: 5000 },
      };
    }

    // Handle regular plan creation - 使用优化后的版本
    const parsedArgs = this.parsePlanArguments(args);
    const planConfig = createPlanConfigOptimized(args, {
      source: 'omnibox',
    });

    // Add to history
    addToPlanHistory(planConfig);

    if (this.background && this.background.dataTrackingManager) {
      this.background.dataTrackingManager.record('task_completion', 1, {
        action: 'plan_created',
        type: parsedArgs.usedPreset || 'custom',
      });
    }

    const sendResult = await this.sendPlanToApp(planConfig);

    if (!sendResult.success) {
      const isUnauthorized = sendResult.reason === 'auth-error';
      const isInvalidResponse = sendResult.reason === 'invalid-response';
      this.notifyPlanActivation(planConfig, isUnauthorized ? 'auth-error' : 'local-only');
      return this.createPlanCommandResult(planConfig, {
        title: isUnauthorized ? 'Plan Sync Failed' : 'Plan Saved Locally',
        message: isUnauthorized
          ? `Saved ${planConfig.title} locally, but Helpy rejected the bridge session. Refresh the app connection and try again.`
          : isInvalidResponse
            ? `Saved ${planConfig.title} locally, but Helpy returned an invalid response.`
            : `Saved ${planConfig.title} for ${planConfig.durationMinutes} minutes, but the Helpy app is unavailable.`,
        duration: 5000,
        syncStatus: isUnauthorized ? 'auth-error' : 'local-only',
      });
    }

    const syncedPlan =
      sendResult.result &&
      sendResult.result.plan &&
      typeof sendResult.result.plan.title === 'string'
        ? sendResult.result.plan
        : planConfig;
    this.notifyPlanActivation(syncedPlan, 'synced');

    const endTime = Date.now();
    console.log(`Plan command executed in ${endTime - startTime}ms`);

    return this.createPlanCommandResult(planConfig, {
      message: `Starting ${syncedPlan.title} for ${syncedPlan.durationMinutes} minutes in Helpy.`,
      planConfig: syncedPlan,
    });
  }

  async handlePomodoroCommand(args) {
    if (this.background && typeof this.background.handlePomodoroCommand === 'function') {
      return this.background.handlePomodoroCommand(args);
    }

    const action = args.toLowerCase().trim();
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Available: start, break, pause, resume, reset',
      options: { duration: 4000 },
    };
  }

  async handleReportCommand(args) {
    if (this.background && typeof this.background.openReports === 'function') {
      await this.background.openReports(args);
    }

    return {
      action: 'none',
      title: '',
      message: '',
      options: {},
    };
  }

  async handleHelpCommand(args) {
    const helpText = Object.entries(this.commands)
      .map(([name, cmd]) => `${name} - ${cmd.description}`)
      .join('\n');

    return {
      action: 'showNotification',
      title: 'Available Commands',
      message: helpText,
      options: { duration: 5000 },
    };
  }

  async handleTrackCommand(args) {
    const trackType = args.toLowerCase().trim() || 'focus';

    if (this.background && this.background.dataTrackingManager) {
      this.background.dataTrackingManager.record('user_behavior', 1, {
        action: 'tracking_started',
        type: trackType,
      });
    }

    return {
      action: 'showNotification',
      title: 'Tracking Started',
      message: `Now tracking: ${trackType}`,
      options: { duration: 3000 },
    };
  }

  async handleTaskCommand(args) {
    const taskTitle = args.trim();
    if (!taskTitle) {
      return {
        action: 'showNotification',
        title: 'Task Error',
        message: 'Please provide a task title, e.g., /task Finish report',
        options: { duration: 3000 },
      };
    }

    if (this.background && this.background.dataTrackingManager) {
      this.background.dataTrackingManager.record('task_added', 1, {
        title: taskTitle,
      });
    }

    return {
      action: 'showNotification',
      title: 'Task Added',
      message: `Added task: "${taskTitle}"`,
      options: { duration: 3000 },
    };
  }

  async handleHabitCommand(args) {
    const habitTitle = args.trim();
    if (!habitTitle) {
      return {
        action: 'showNotification',
        title: 'Habit Error',
        message: 'Please provide a habit name, e.g., /habit Read 30 minutes',
        options: { duration: 3000 },
      };
    }

    if (this.background && this.background.dataTrackingManager) {
      this.background.dataTrackingManager.record('habit_added', 1, {
        title: habitTitle,
      });
    }

    return {
      action: 'showNotification',
      title: 'Habit Added',
      message: `Added habit: "${habitTitle}"`,
      options: { duration: 3000 },
    };
  }

  async handleSettingsCommand(args) {
    if (this.background && typeof this.background.openSettings === 'function') {
      await this.background.openSettings(args);
    }

    return {
      action: 'none',
      title: '',
      message: '',
      options: {},
    };
  }
}

if (globalScope) {
  globalScope.CommandHandler = CommandHandler;
}

if (typeof module !== 'undefined') {
  module.exports = CommandHandler;
}
