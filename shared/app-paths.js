const fs = require('fs');
const path = require('path');

let configuredDataDirectory = process.env.HELPY_DATA_DIR || null;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function resolveElectronUserDataDirectory() {
  try {
    // `app.getPath('userData')` is available in the Electron main process and packaged builds.
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // Tests and non-Electron runtimes fall back below.
  }

  return path.join(process.cwd(), '.helpy-data');
}

function getDataDirectory() {
  if (!configuredDataDirectory) {
    configuredDataDirectory = resolveElectronUserDataDirectory();
  }

  return ensureDirectory(configuredDataDirectory);
}

function configureDataDirectory(dirPath) {
  configuredDataDirectory = dirPath;
  return getDataDirectory();
}

function getLegacyFilePath(fileName) {
  return path.join(__dirname, '..', fileName);
}

function getProjectRootDirectory() {
  return path.join(__dirname, '..');
}

function getProjectDataDirectory() {
  return ensureDirectory(getProjectRootDirectory());
}

function getProjectDataFilePath(fileName) {
  return path.join(getProjectDataDirectory(), fileName);
}

function getDataFilePath(fileName) {
  return path.join(getDataDirectory(), fileName);
}

function getAppDataPaths() {
  return {
    directory: getDataDirectory(),
    settings: getDataFilePath('settings.json'),
    tasks: getDataFilePath('tasks.json'),
    tags: getDataFilePath('tags.json'),
    tabHistory: getDataFilePath('tab-history.json'),
    appHistory: getDataFilePath('app-history.json'),
    focusState: getDataFilePath('focus-state.json'),
    bridgeAuth: getDataFilePath('bridge-auth.json'),
  };
}

module.exports = {
  configureDataDirectory,
  ensureDirectory,
  getAppDataPaths,
  getDataDirectory,
  getDataFilePath,
  getLegacyFilePath,
  getProjectDataDirectory,
  getProjectDataFilePath,
  getProjectRootDirectory,
};
