const {
  parsePlanArguments,
  createPlanConfig,
} = require('./shared/plan-command');

class CommandHandler {
  constructor(backgroundContext) {
    this.background = backgroundContext;
    this.commands = this.registerCommands();
  }

  registerCommands() {
    return {
      plan: {
        description: 'Plan your tasks and goals',
        suggestions: ['plan work', 'plan study', 'plan focus', "plan today's tasks"],
        handler: this.handlePlanCommand.bind(this),
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

    for (const [name, cmd] of Object.entries(this.commands)) {
      if (name.startsWith(searchText) || searchText === '') {
        cmd.suggestions.forEach((suggestion) => {
          suggestions.push({
            content: suggestion,
            description: cmd.description,
          });
        });
      }
    }

    return suggestions.slice(0, 5);
  }

  parsePlanArguments(args) {
    return parsePlanArguments(args);
  }

  async sendPlanToApp(planConfig) {
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

      if (response.ok) {
        const result = await response.json();
        return { success: true, result: result };
      } else {
        console.error('API error:', response.status, response.statusText);
        return { success: false, error: 'API error: ' + response.status };
      }
    } catch (error) {
      console.error('Error sending plan to app:', error);
      return { success: false, error: error.message };
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
    const parsedArgs = this.parsePlanArguments(args);
    const planConfig = createPlanConfig(args, {
      source: 'omnibox',
    });

    if (this.background && this.background.dataTrackingManager) {
      this.background.dataTrackingManager.record('task_completion', 1, {
        action: 'plan_created',
        type: parsedArgs.usedPreset || 'custom',
      });
    }

    const sendResult = await this.sendPlanToApp(planConfig);

    if (!sendResult.success) {
      const isUnauthorized = String(sendResult.error || '').includes('401');
      return {
        action: 'showNotification',
        title: isUnauthorized ? 'Plan Sync Failed' : 'Plan Saved Locally',
        message: isUnauthorized
          ? `Saved ${planConfig.title} locally, but Helpy rejected the bridge session. Refresh the app connection and try again.`
          : `Saved ${planConfig.title} for ${planConfig.durationMinutes} minutes, but the Helpy app is unavailable.`,
        options: { duration: 5000 },
        planConfig: planConfig,
        syncStatus: isUnauthorized ? 'auth-error' : 'local-only',
      };
    }

    return {
      action: 'showNotification',
      title: 'Plan Created!',
      message: `Starting ${planConfig.title} for ${planConfig.durationMinutes} minutes in Helpy.`,
      options: { duration: 3000 },
      planConfig: sendResult.success ? sendResult.result.plan || planConfig : planConfig,
      syncStatus: 'synced',
    };
  }

  async handlePomodoroCommand(args) {
    const action = args.toLowerCase().trim();
    return {
      action: 'showNotification',
      title: 'Pomodoro',
      message: 'Available: start, break, pause, resume, reset',
      options: { duration: 4000 },
    };
  }

  async handleReportCommand(args) {
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

  async handleSettingsCommand(args) {
    return {
      action: 'none',
      title: '',
      message: '',
      options: {},
    };
  }
}

if (typeof module !== 'undefined') {
  module.exports = CommandHandler;
}
