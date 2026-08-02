const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./app-paths');
const cryptoUtils = require('../gov-modules/crypto-utils');

const logger = {
  error: (...args) => console.error('[ERROR]', ...args),
};

class FileStore {
  constructor(filePath, fallbackValue, validate, encrypt = false) {
    this.filePath = filePath;
    this.fallbackValue = cloneFallback(fallbackValue);
    this.validate = validate;
    this.encrypt = encrypt;
  }

  load() {
    if (this.encrypt) {
      return safeReadEncryptedJson(this.filePath, this.fallbackValue, this.validate);
    }
    return safeReadJson(this.filePath, this.fallbackValue, this.validate);
  }

  save(value) {
    const normalized =
      typeof this.validate === 'function' ? this.validate(value) : cloneFallback(value);
    const nextValue =
      normalized === undefined ? cloneFallback(this.fallbackValue) : cloneFallback(normalized);

    if (this.encrypt) {
      writeEncryptedJsonAtomic(this.filePath, nextValue);
    } else {
      writeJsonAtomic(this.filePath, nextValue);
    }
    return nextValue;
  }
}

// 加密存储相关方法
function safeReadEncryptedJson(filePath, fallbackValue, validate) {
  try {
    if (!fs.existsSync(filePath)) {
      return cloneFallback(fallbackValue);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const decrypted = cryptoUtils.decrypt(raw);
    const parsed = JSON.parse(decrypted);

    if (typeof validate === 'function') {
      return validate(parsed);
    }

    return parsed;
  } catch (err) {
    logger.error(`Error reading encrypted JSON file ${filePath}:`, err);
    return cloneFallback(fallbackValue);
  }
}

function writeEncryptedJsonAtomic(filePath, value) {
  try {
    const directory = path.dirname(filePath);
    ensureDirectory(directory);

    const encrypted = cryptoUtils.encrypt(JSON.stringify(value));
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, encrypted);
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    logger.error(`Error writing encrypted JSON file ${filePath}:`, err);
    throw err;
  }
}

function safeReadJson(filePath, fallbackValue, validate) {
  try {
    if (!fs.existsSync(filePath)) {
      return cloneFallback(fallbackValue);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (typeof validate === 'function') {
      return validate(parsed);
    }

    return parsed;
  } catch (err) {
    logger.error(`Error reading JSON file ${filePath}:`, err);
    return cloneFallback(fallbackValue);
  }
}

function writeJsonAtomic(filePath, value) {
  try {
    const directory = path.dirname(filePath);
    ensureDirectory(directory);

    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    logger.error(`Error writing JSON file ${filePath}:`, err);
    throw err;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function copyFileIfMissing(sourcePath, destinationPath) {
  if (!fileExists(sourcePath) || fileExists(destinationPath)) {
    return false;
  }

  ensureDirectory(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

function cloneFallback(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneFallback(item));
  }

  if (value && typeof value === 'object') {
    const cloned = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        cloned[key] = cloneFallback(value[key]);
      }
    }
    return cloned;
  }

  return value;
}

module.exports = {
  FileStore,
  cloneFallback,
  copyFileIfMissing,
  fileExists,
  safeReadJson,
  safeReadEncryptedJson,
  writeJsonAtomic,
  writeEncryptedJsonAtomic,
};
