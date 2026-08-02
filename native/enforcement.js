const { exec } = require('child_process');
const { platform } = process;

// Initialize native addon with robust error handling
let nativeAddon;
try {
  nativeAddon = require('../build/Release/enforcement_addon.node');
} catch (releaseErr) {
  try {
    nativeAddon = require('../build/Debug/enforcement_addon.node');
  } catch (debugErr) {
    console.warn(
      '[Enforcement] C++ native addon binary not yet compiled; running JS fallback engine.',
      debugErr.message
    );
  }
}

// Encapsulated fallback state with type safety (JSDoc for IDE support)
/**
 * @typedef {Object} FallbackState
 * @property {string[]} blockedProcesses
 * @property {boolean} hardModeActive
 * @property {number} unlockTimeMs
 * @property {string} password
 * @property {NodeJS.Timeout|null} intervalId
 */

/** @type {FallbackState} */
const fallbackState = Object.seal({
  blockedProcesses: [],
  hardModeActive: false,
  unlockTimeMs: 0,
  password: '',
  intervalId: null,
});

// Platform-specific process killing logic
const processKillers = {
  win32: (proc) => {
    const target = proc.endsWith('.exe') ? proc : `${proc}.exe`;
    exec(`taskkill /F /IM "${target}"`, () => {});
  },
  linux: (proc) => {
    exec(`pkill -f "${proc}"`, () => {});
  },
  darwin: (proc) => {
    exec(`pkill -f "${proc}"`, () => {});
  }
};

function performJsFallbackEnforcement() {
  const { blockedProcesses } = fallbackState;
  if (!blockedProcesses.length) return;

  const killer = processKillers[platform];
  if (!killer) return;

  blockedProcesses.forEach(killer);
}

// Utility to clear fallback interval and reset state
function clearFallbackInterval() {
  if (fallbackState.intervalId) {
    clearInterval(fallbackState.intervalId);
    fallbackState.intervalId = null;
  }
  fallbackState.blockedProcesses = [];
}

const enforcementModule = {
  isNative: () => !!nativeAddon,

  setBlockedProcesses: (procs) => {
    if (nativeAddon) {
      return nativeAddon.setBlockedProcesses(procs);
    }

    // Validate input
    if (!Array.isArray(procs)) {
      throw new TypeError('blocked processes must be an array');
    }

    fallbackState.blockedProcesses = procs;
    if (!fallbackState.intervalId && procs.length > 0) {
      fallbackState.intervalId = setInterval(performJsFallbackEnforcement, 1500);
    }
    return true;
  },

  startHardMode: (delaySeconds = 60, password = '') => {
    if (nativeAddon) {
      return nativeAddon.startHardMode(delaySeconds, password);
    }

    const clampedDelay = Math.max(60, Math.min(120, delaySeconds));
    const unlockTimeMs = Date.now() + clampedDelay * 1000;

    Object.assign(fallbackState, {
      hardModeActive: true,
      unlockTimeMs,
      password: String(password),
    });

    return {
      success: true,
      unlockTimeMs,
      delaySeconds: clampedDelay,
    };
  },

  requestUnlockHardMode: (passInput = '') => {
    if (nativeAddon) {
      return nativeAddon.requestUnlockHardMode(passInput);
    }

    const now = Date.now();
    const passwordMatch = fallbackState.password && passInput === fallbackState.password;
    const expired = now >= fallbackState.unlockTimeMs;

    if (passwordMatch || expired) {
      Object.assign(fallbackState, {
        hardModeActive: false,
        password: '',
      });
      return { 
        unlocked: true, 
        reason: passwordMatch ? 'password_verified' : 'countdown_expired' 
      };
    }

    const remainingMs = fallbackState.unlockTimeMs - now;
    return {
      unlocked: false,
      remainingSeconds: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0,
      reason: 'locked',
    };
  },

  getHardModeStatus: () => {
    if (nativeAddon) {
      return nativeAddon.getHardModeStatus();
    }

    const now = Date.now();
    const remainingMs = Math.max(0, fallbackState.unlockTimeMs - now);

    return {
      active: fallbackState.hardModeActive,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      hasPassword: !!fallbackState.password,
    };
  },

  stopEnforcement: () => {
    if (nativeAddon) {
      return nativeAddon.stopEnforcement();
    }

    if (fallbackState.hardModeActive && Date.now() < fallbackState.unlockTimeMs) {
      throw new Error('Cannot stop enforcement while Hard Mode countdown is active');
    }

    clearFallbackInterval();
    return true;
  },
};

module.exports = enforcementModule;
