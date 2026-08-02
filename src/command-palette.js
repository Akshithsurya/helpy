/**
 * Command Palette Engine for Helpy
 * Manages search indexing, hotkey shortcuts (Ctrl+K / Cmd+K), and universal action triggers.
 */

class CommandPaletteEngine {
  constructor(options = {}) {
    this.actions = [];
    this.isOpen = false;
    this.selectedIndex = 0;
    this.onExecute = options.onExecute || (() => {});
    this._registerDefaultActions();
  }

  _registerDefaultActions() {
    this.actions = [
      {
        id: 'nav-focus',
        title: 'Go to Focus Tab',
        category: 'Navigation',
        icon: '⏱️',
        action: () => this._switchTab('focus'),
      },
      {
        id: 'nav-tasks',
        title: 'Go to Tasks Tab',
        category: 'Navigation',
        icon: '✅',
        action: () => this._switchTab('tasks'),
      },
      {
        id: 'nav-habits',
        title: 'Go to Habits Tab',
        category: 'Navigation',
        icon: '🌱',
        action: () => this._switchTab('habits'),
      },
      {
        id: 'nav-notifications',
        title: 'Go to Notifications',
        category: 'Navigation',
        icon: '🔔',
        action: () => this._switchTab('notifications'),
      },
      {
        id: 'nav-stats',
        title: 'Go to Stats & Analytics',
        category: 'Navigation',
        icon: '📊',
        action: () => this._switchTab('stats'),
      },
      {
        id: 'nav-account',
        title: 'Go to Account Settings',
        category: 'Navigation',
        icon: '👤',
        action: () => this._switchTab('account'),
      },
      {
        id: 'action-quick-pomodoro',
        title: 'Start 25m Pomodoro Focus',
        category: 'Focus',
        icon: '⚡',
        action: () => this._startPresetFocus(25),
      },
      {
        id: 'action-deep-work',
        title: 'Start 50m Deep Work Session',
        category: 'Focus',
        icon: '🧠',
        action: () => this._startPresetFocus(50),
      },
      {
        id: 'action-short-break',
        title: 'Take a 5m Short Break',
        category: 'Focus',
        icon: '☕',
        action: () => this._startPresetBreak(5),
      },
      {
        id: 'theme-dark',
        title: 'Switch Theme: Dark Mode',
        category: 'Theme',
        icon: '🌙',
        action: () => this._setTheme('dark'),
      },
      {
        id: 'theme-space',
        title: 'Switch Theme: Cosmic Space',
        category: 'Theme',
        icon: '🌌',
        action: () => this._setTheme('space-theme'),
      },
      {
        id: 'theme-light',
        title: 'Switch Theme: Clean Light',
        category: 'Theme',
        icon: '☀️',
        action: () => this._setTheme('light'),
      },
    ];
  }

  _switchTab(tabId) {
    const btn = document.getElementById(`tab-${tabId}`);
    if (btn) btn.click();
  }

  _startPresetFocus(mins) {
    this._switchTab('focus');
    const input = document.getElementById('timer-duration');
    const startBtn = document.getElementById('start-timer-btn');
    if (input) input.value = mins;
    if (startBtn) startBtn.click();
  }

  _startPresetBreak(mins) {
    this._switchTab('focus');
    const breakBtn = document.getElementById('timer-mode-short-break');
    if (breakBtn) breakBtn.click();
  }

  _setTheme(themeName) {
    document.body.classList.remove('dark', 'space-theme', 'indigo-theme');
    if (themeName !== 'light') {
      document.body.classList.add(themeName);
    }
  }

  registerCustomAction(action) {
    this.actions.push(action);
  }

  search(query = '') {
    if (!query.trim()) return this.actions;
    const lowerQuery = query.toLowerCase();
    return this.actions.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery) ||
        item.category.toLowerCase().includes(lowerQuery)
    );
  }

  execute(actionId) {
    const target = this.actions.find((a) => a.id === actionId);
    if (target && typeof target.action === 'function') {
      target.action();
      this.onExecute(target);
      return true;
    }
    return false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CommandPaletteEngine };
}
