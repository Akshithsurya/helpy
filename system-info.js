const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let activeWinLoader = null;
let activeWinUnavailableLogged = false;

/**
 * Executes a command with timeout and error handling
 * @param {string} cmd - Command to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<string|null>} Command output or null on error
 */
async function safeExec(cmd, timeoutMs = 5000) {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs });
    return stdout?.trim() || null;
  } catch {
    return null;
  }
}

function loadActiveWin() {
  if (activeWinLoader !== null) {
    return activeWinLoader;
  }

  try {
    const loaded = require('active-win');
    activeWinLoader = typeof loaded === 'function' ? loaded : loaded?.default || null;
  } catch {
    activeWinLoader = null;
  }

  return activeWinLoader;
}

async function getActiveWindowFromNativeModule() {
  const loader = loadActiveWin();
  if (!loader) {
    return null;
  }

  try {
    return await loader();
  } catch (error) {
    if (!activeWinUnavailableLogged) {
      activeWinUnavailableLogged = true;
      console.warn('Active window tracking is using fallback mode:', error.message);
    }
    return null;
  }
}

async function getWindowsActiveWindowFallback() {
  const script = [
    "$sig = @'",
    'using System;',
    'using System.Text;',
    'using System.Runtime.InteropServices;',
    'public static class NativeWindow {',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
    '  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
    '}',
    "'@;",
    'Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue | Out-Null;',
    '$hwnd = [NativeWindow]::GetForegroundWindow();',
    'if ($hwnd -eq [IntPtr]::Zero) { return }',
    '$buffer = New-Object System.Text.StringBuilder 1024;',
    '[void][NativeWindow]::GetWindowText($hwnd, $buffer, $buffer.Capacity);',
    '$processId = 0;',
    '[void][NativeWindow]::GetWindowThreadProcessId($hwnd, [ref]$processId);',
    '$processName = "";',
    'if ($processId -gt 0) {',
    '  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}',
    '}',
    '[PSCustomObject]@{ title = $buffer.ToString(); owner = [PSCustomObject]@{ name = $processName } } | ConvertTo-Json -Compress',
  ].join(' ');
  const escapedScript = script.replace(/"/g, '\\"');
  const output = await safeExec(`powershell -NoProfile -Command "${escapedScript}"`, 4000);
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output);
    const ownerName = parsed?.owner?.name || '';
    const title = parsed?.title || '';
    if (!ownerName && !title) {
      return null;
    }

    return {
      title,
      owner: {
        name: ownerName,
      },
    };
  } catch {
    return null;
  }
}

async function getActiveWindow() {
  if (process.platform === 'win32') {
    const fallbackWindow = await getWindowsActiveWindowFallback();
    if (fallbackWindow) {
      return fallbackWindow;
    }
  }

  const nativeWindow = await getActiveWindowFromNativeModule();
  if (nativeWindow) {
    return nativeWindow;
  }

  return null;
}

/**
 * Gets system information including active window and open apps
 * @returns {Promise<{activeWindow: any, openApps: string[]}>} System info
 */
async function getSystemInfo() {
  try {
    const activeWindow = await getActiveWindow();

    let openApps;
    try {
      openApps = await getOpenApps();
    } catch (appsErr) {
      console.error('Error getting open apps:', appsErr);
      openApps = [];
    }

    return { activeWindow, openApps };
  } catch (error) {
    console.error('Error getting system info:', error);
    return { activeWindow: null, openApps: [] };
  }
}

/**
 * Gets list of open apps based on platform
 * @returns {Promise<string[]>} Open apps
 */
async function getOpenApps() {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      const stdout = await safeExec('tasklist /fo csv /nh');
      if (!stdout) return [];
      const apps = stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const match = line.match(/"([^"]+)"/);
          return match ? match[1].replace('.exe', '') : null;
        })
        .filter((app, index, self) => app && self.indexOf(app) === index)
        .sort((a, b) => a.localeCompare(b));
      return apps.slice(0, 10);
    } else if (platform === 'darwin') {
      const stdout = await safeExec('ps aux');
      if (!stdout) return [];
      const apps = stdout
        .split('\n')
        .filter((line) => line.includes('.app'))
        .map((line) => {
          const parts = line.split('/');
          return parts[parts.length - 1].replace('.app', '');
        })
        .filter((app, index, self) => app && self.indexOf(app) === index);
      return apps.slice(0, 10);
    } else {
      return [];
    }
  } catch (error) {
    console.error('Error getting open apps:', error);
    return [];
  }
}

module.exports = { getSystemInfo };
