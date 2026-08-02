const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const AutoLaunch = require('auto-launch');
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('[AutoUpdater] electron-updater package optional import warning:', e.message);
}

/**
 * Resolve a directory that must exist as a REAL folder on disk (needed as a
 * spawn() cwd). In a packaged app, __dirname points inside app.asar, which
 * is a single archive file — not a real directory — so spawn() fails with
 * ENOENT when cwd doesn't exist. electron-builder's asarUnpack setting
 * copies matching folders to app.asar.unpacked alongside the archive; this
 * swaps the path over to that real, on-disk location when packaged.
 */
function resolveSpawnCwd(relativeDir) {
  const dir = path.join(__dirname, relativeDir);
  if (dir.includes('app.asar' + path.sep) && !dir.includes('app.asar.unpacked')) {
    return dir.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  }
  return dir;
}

class ServiceOrchestrator {
  constructor() {
    this.erlangProcess = null;
    this.rubyProcess = null;
    this.autoLauncher = new AutoLaunch({
      name: 'Helpy',
      path: process.execPath,
    });
  }

  async initAutoLaunchAndUpdates() {
    try {
      const isEnabled = await this.autoLauncher.isEnabled();
      if (!isEnabled) {
        await this.autoLauncher.enable();
        console.log('[Orchestrator] Auto-launch enabled successfully.');
      }
    } catch (err) {
      console.warn('[Orchestrator] Auto-launch setup notice:', err.message);
    }

    if (autoUpdater) {
      try {
        autoUpdater.checkForUpdatesAndNotify();
        console.log('[Orchestrator] Auto-updater initialized.');
      } catch (err) {
        console.warn('[Orchestrator] Auto-updater notice:', err.message);
      }
    }
  }

  startErlangService() {
    const erlangDir = resolveSpawnCwd('erlang');
    console.log('[Orchestrator] Launching Erlang/OTP sync service from:', erlangDir);

    if (!fs.existsSync(erlangDir)) {
      console.warn('[Orchestrator] Erlang service dir not found on disk, skipping:', erlangDir);
      return;
    }

    try {
      if (process.platform === 'win32') {
        this.erlangProcess = spawn('cmd.exe', ['/c', 'rebar3 shell'], {
          cwd: erlangDir,
          detached: false,
        });
      } else {
        this.erlangProcess = spawn('rebar3', ['shell'], { cwd: erlangDir, detached: false });
      }

      // Without this, a spawn failure (e.g. rebar3/cmd.exe not found) emits
      // an unhandled 'error' event, which Node re-throws as an uncaught
      // exception and crashes the whole Electron app.
      this.erlangProcess.on('error', (err) => {
        console.warn('[Erlang Sync] Failed to start (service will be unavailable):', err.message);
        this.erlangProcess = null;
      });

      this.erlangProcess.stdout?.on('data', (data) => {
        console.log(`[Erlang Sync] ${data.toString().trim()}`);
      });

      this.erlangProcess.stderr?.on('data', (data) => {
        console.warn(`[Erlang Sync Err] ${data.toString().trim()}`);
      });

      this.erlangProcess.on('exit', (code) => {
        console.log(`[Erlang Sync] Process exited with code ${code}`);
      });
    } catch (e) {
      console.error('[Orchestrator] Failed to launch Erlang background service:', e);
    }
  }

  startRubyService() {
    if (this.rubyProcess) return;
    const rubyDir = resolveSpawnCwd('ruby-api');
    console.log('[Orchestrator] Launching Ruby stats service from:', rubyDir);

    if (!fs.existsSync(rubyDir)) {
      console.warn('[Orchestrator] Ruby service dir not found on disk, skipping:', rubyDir);
      return;
    }

    try {
      const hasGemfile = fs.existsSync(path.join(rubyDir, 'Gemfile'));
      const command = hasGemfile ? 'bundle exec ruby app.rb' : 'ruby app.rb';
      if (process.platform === 'win32') {
        this.rubyProcess = spawn('cmd.exe', ['/d', '/s', '/c', command], {
          cwd: rubyDir,
          detached: false,
          windowsHide: true,
        });
      } else {
        this.rubyProcess = spawn(hasGemfile ? 'bundle' : 'ruby', hasGemfile ? ['exec', 'ruby', 'app.rb'] : ['app.rb'], { cwd: rubyDir, detached: false });
      }

      // Same rationale as the Erlang process above — prevents an unhandled
      // 'error' event from crashing the app if ruby/bundle isn't installed.
      this.rubyProcess.on('error', (err) => {
        console.warn('[Ruby Stats] Failed to start (chat will use offline replies):', err.message);
        this.rubyProcess = null;
      });

      this.rubyProcess.stdout?.on('data', (data) => {
        console.log(`[Ruby Stats] ${data.toString().trim()}`);
      });

      this.rubyProcess.stderr?.on('data', (data) => {
        console.warn(`[Ruby Stats Err] ${data.toString().trim()}`);
      });

      this.rubyProcess.on('exit', (code) => {
        this.rubyProcess = null;
        console.warn(`[Ruby Stats] Process exited with code ${code}. The chat will use its built-in offline replies until Ruby is available.`);
      });
    } catch (e) {
      console.error('[Orchestrator] Failed to launch Ruby background service:', e);
    }
  }

  startAll() {
    this.initAutoLaunchAndUpdates();
    this.startErlangService();
    this.startRubyService();
  }

  stopAll() {
    console.log('[Orchestrator] Shutting down background services...');
    if (this.erlangProcess) {
      try {
        this.erlangProcess.kill('SIGTERM');
      } catch (e) {}
      this.erlangProcess = null;
    }

    if (this.rubyProcess) {
      try {
        this.rubyProcess.kill('SIGTERM');
      } catch (e) {}
      this.rubyProcess = null;
    }
  }
}

module.exports = new ServiceOrchestrator();