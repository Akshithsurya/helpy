/**
 * æ”¿åŠ¡çº§å®¡è®¡æ—¥å¿—ç³»ç»Ÿ
 * è®°å½•æ‰€æœ‰å…³é”®æ“ä½œå’Œå®‰å…¨äº‹ä»¶
 */

const fs = require('fs');
const path = require('path');
const cryptoUtils = require('./crypto-utils');
const dataMasking = require('./data-masking');

let electronApp = null;
try {
  electronApp = require('electron').app;
} catch (e) {
  // Not running inside Electron (e.g. tests, standalone scripts) — fall back below.
}

// å®¡è®¡æ—¥å¿—çº§åˆ«
const LOG_LEVELS = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  CRITICAL: 'critical',
};

// å®¡è®¡äº‹ä»¶ç±»åž‹
const EVENT_TYPES = {
  // è®¤è¯äº‹ä»¶
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  MFA_VERIFICATION: 'mfa_verification',
  SESSION_EXPIRED: 'session_expired',

  // ç”¨æˆ·ç®¡ç†äº‹ä»¶
  USER_CREATE: 'user_create',
  USER_UPDATE: 'user_update',
  USER_DELETE: 'user_delete',
  USER_ROLE_CHANGE: 'user_role_change',

  // æƒé™äº‹ä»¶
  PERMISSION_DENIED: 'permission_denied',
  PERMISSION_GRANTED: 'permission_granted',
  PERMISSION_REVOKED: 'permission_revoked',

  // æ•°æ®æ“ä½œäº‹ä»¶
  DATA_CREATE: 'data_create',
  DATA_READ: 'data_read',
  DATA_UPDATE: 'data_update',
  DATA_DELETE: 'data_delete',
  DATA_EXPORT: 'data_export',
  DATA_IMPORT: 'data_import',

  // ç³»ç»Ÿäº‹ä»¶
  SYSTEM_START: 'system_start',
  SYSTEM_SHUTDOWN: 'system_shutdown',
  SYSTEM_CONFIG_CHANGE: 'system_config_change',
  SYSTEM_BACKUP: 'system_backup',
  SYSTEM_RESTORE: 'system_restore',

  // å®‰å…¨äº‹ä»¶
  SECURITY_ALERT: 'security_alert',
  INTRUSION_DETECTED: 'intrusion_detected',
  VIRUS_DETECTED: 'virus_detected',
};

/**
 * Resolve a writable default log directory.
 * Inside a packaged Electron app, __dirname points into app.asar, which is
 * a file, not a real directory — mkdirSync there throws ENOTDIR. Use the
 * OS-level userData folder instead, which is always writable.
 */
function getDefaultLogDir() {
  if (electronApp && electronApp.getPath) {
    return path.join(electronApp.getPath('userData'), 'audit-logs');
  }
  return path.join(__dirname, '..', 'audit-logs');
}

class AuditLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || getDefaultLogDir();
    this.logFile = path.join(this.logDir, `audit-${new Date().toISOString().split('T')[0]}.log`);
    this.maxFileSize = options.maxFileSize || 100 * 1024 * 1024; // 100MB
    this.retentionDays = options.retentionDays || 90;
    this.logs = [];
    this.flushInterval = options.flushInterval || 5000;

    this.ensureLogDir();
    this.startFlushTimer();
    this.startCleanupTimer();
  }

  /**
   * ç¡®ä¿æ—¥å¿—ç›®å½•å­˜åœ¨
   */
  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * ç”Ÿæˆæ—¥å¿—æ¡ç›® ID
   */
  generateLogId() {
    return cryptoUtils.generateSecureId(32);
  }

  /**
   * åˆ›å»ºå®¡è®¡æ—¥å¿—æ¡ç›®
   * @param {Object} options - æ—¥å¿—é€‰é¡¹
   */
  createLogEntry(options) {
    const {
      userId,
      username,
      eventType,
      level = LOG_LEVELS.INFO,
      resource,
      action,
      details,
      ipAddress,
      userAgent,
      result,
      errorMessage,
    } = options;

    return {
      id: this.generateLogId(),
      timestamp: new Date().toISOString(),
      userId,
      username: dataMasking.maskName(username),
      eventType,
      level,
      resource,
      action,
      details: dataMasking.maskLog(details),
      ipAddress,
      userAgent,
      result,
      errorMessage: dataMasking.maskLog(errorMessage),
      checksum: null,
    };
  }

  /**
   * è®¡ç®—æ—¥å¿—æ ¡éªŒå’Œ
   * @param {Object} logEntry - æ—¥å¿—æ¡ç›®
   */
  calculateChecksum(logEntry) {
    const dataToHash = JSON.stringify({
      id: logEntry.id,
      timestamp: logEntry.timestamp,
      userId: logEntry.userId,
      eventType: logEntry.eventType,
      resource: logEntry.resource,
      action: logEntry.action,
    });
    return cryptoUtils.hash(dataToHash);
  }

  /**
   * è®°å½•å®¡è®¡æ—¥å¿—
   * @param {Object} options - æ—¥å¿—é€‰é¡¹
   */
  log(options) {
    const entry = this.createLogEntry(options);
    entry.checksum = this.calculateChecksum(entry);

    this.logs.push(entry);

    // å¦‚æžœæ—¥å¿—ç¼“å†²åŒºè¾¾åˆ°ä¸€å®šå¤§å°ï¼Œç«‹å³åˆ·æ–°
    if (this.logs.length >= 100) {
      this.flush();
    }

    return entry;
  }

  /**
   * è®°å½•ç™»å½•äº‹ä»¶
   */
  logLogin(userId, username, result, ipAddress, details = {}) {
    return this.log({
      userId,
      username,
      eventType: EVENT_TYPES.LOGIN,
      level: result === 'success' ? LOG_LEVELS.INFO : LOG_LEVELS.WARN,
      resource: 'auth',
      action: 'login',
      result,
      ipAddress,
      details,
    });
  }

  /**
   * è®°å½•ç™»å‡ºäº‹ä»¶
   */
  logLogout(userId, username, ipAddress, details = {}) {
    return this.log({
      userId,
      username,
      eventType: EVENT_TYPES.LOGOUT,
      level: LOG_LEVELS.INFO,
      resource: 'auth',
      action: 'logout',
      result: 'success',
      ipAddress,
      details,
    });
  }

  /**
   * è®°å½•æ•°æ®æ“ä½œäº‹ä»¶
   */
  logDataOperation(userId, username, operation, resource, details, result = 'success') {
    const eventTypes = {
      create: EVENT_TYPES.DATA_CREATE,
      read: EVENT_TYPES.DATA_READ,
      update: EVENT_TYPES.DATA_UPDATE,
      delete: EVENT_TYPES.DATA_DELETE,
      export: EVENT_TYPES.DATA_EXPORT,
      import: EVENT_TYPES.DATA_IMPORT,
    };

    return this.log({
      userId,
      username,
      eventType: eventTypes[operation] || EVENT_TYPES.DATA_UPDATE,
      level: operation === 'delete' ? LOG_LEVELS.WARN : LOG_LEVELS.INFO,
      resource,
      action: operation,
      result,
      details,
    });
  }

  /**
   * è®°å½•æƒé™æ‹’ç»äº‹ä»¶
   */
  logPermissionDenied(userId, username, permission, resource, ipAddress) {
    return this.log({
      userId,
      username,
      eventType: EVENT_TYPES.PERMISSION_DENIED,
      level: LOG_LEVELS.WARN,
      resource,
      action: 'access_denied',
      result: 'failed',
      ipAddress,
      details: { permission },
    });
  }

  /**
   * è®°å½•ç³»ç»Ÿäº‹ä»¶
   */
  logSystemEvent(eventType, details, level = LOG_LEVELS.INFO) {
    return this.log({
      userId: 'system',
      username: 'system',
      eventType,
      level,
      resource: 'system',
      action: eventType,
      result: 'success',
      details,
    });
  }

  /**
   * è®°å½•å®‰å…¨å‘Šè­¦
   */
  logSecurityAlert(message, details = {}, level = LOG_LEVELS.CRITICAL) {
    return this.log({
      userId: 'system',
      username: 'security_system',
      eventType: EVENT_TYPES.SECURITY_ALERT,
      level,
      resource: 'security',
      action: 'alert',
      details: { message, ...details },
    });
  }

  /**
   * åˆ·æ–°æ—¥å¿—åˆ°æ–‡ä»¶
   */
  flush() {
    if (this.logs.length === 0) {
      return;
    }

    const logsToWrite = [...this.logs];
    this.logs = [];

    try {
      this.rotateLogFileIfNeeded();

      const logLines = logsToWrite.map((log) => JSON.stringify(log));
      fs.appendFileSync(this.logFile, logLines.join('\n') + '\n', { mode: 0o600 });
    } catch (error) {
      console.error('Failed to flush audit logs:', error);
      // å›žæ»šæ—¥å¿—åˆ°ç¼“å†²åŒº
      this.logs = [...logsToWrite, ...this.logs];
    }
  }

  /**
   * æ£€æŸ¥å¹¶è½®è½¬æ—¥å¿—æ–‡ä»¶
   */
  rotateLogFileIfNeeded() {
    if (!fs.existsSync(this.logFile)) {
      return;
    }

    const stats = fs.statSync(this.logFile);
    if (stats.size >= this.maxFileSize) {
      const timestamp = Date.now();
      const rotatedFile = path.join(this.logDir, `audit-rotated-${timestamp}.log`);
      fs.renameSync(this.logFile, rotatedFile);
    }
  }

  /**
   * å¯åŠ¨å®šæ—¶åˆ·æ–°å™¨
   */
  startFlushTimer() {
    setInterval(() => this.flush(), this.flushInterval);
  }

  /**
   * å¯åŠ¨æ—¥å¿—æ¸…ç†å®šæ—¶å™¨
   */
  startCleanupTimer() {
    // æ¯å¤©æ¸…ç†ä¸€æ¬¡è¿‡æœŸæ—¥å¿—
    const oneDayMs = 24 * 60 * 60 * 1000;
    setInterval(() => this.cleanupOldLogs(), oneDayMs);
  }

  /**
   * æ¸…ç†è¿‡æœŸæ—¥å¿—
   */
  cleanupOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();
      const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;

      files.forEach((file) => {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtime.getTime() > retentionMs) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.error('Failed to cleanup old audit logs:', error);
    }
  }

  /**
   * æœç´¢å®¡è®¡æ—¥å¿—
   * @param {Object} filters - æœç´¢è¿‡æ»¤æ¡ä»¶
   */
  searchLogs(filters = {}) {
    const { userId, eventType, level, startDate, endDate, resource, limit = 100 } = filters;

    const results = [];

    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((file) => file.startsWith('audit-') && file.endsWith('.log'))
        .sort()
        .reverse();

      for (const file of files) {
        if (results.length >= limit) break;

        const filePath = path.join(this.logDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter((line) => line.trim());

        for (const line of lines.reverse()) {
          if (results.length >= limit) break;

          try {
            const log = JSON.parse(line);

            if (userId && log.userId !== userId) continue;
            if (eventType && log.eventType !== eventType) continue;
            if (level && log.level !== level) continue;
            if (resource && log.resource !== resource) continue;
            if (startDate && log.timestamp < startDate) continue;
            if (endDate && log.timestamp > endDate) continue;

            results.push(log);
          } catch (e) {
            // è·³è¿‡æ— æ•ˆè¡Œ
          }
        }
      }
    } catch (error) {
      console.error('Failed to search audit logs:', error);
    }

    return results;
  }

  /**
   * éªŒè¯æ—¥å¿—å®Œæ•´æ€§
   * @param {Object} logEntry - æ—¥å¿—æ¡ç›®
   */
  verifyLogIntegrity(logEntry) {
    const calculatedChecksum = this.calculateChecksum(logEntry);
    return (
      cryptoUtils.verifyHmac(JSON.stringify(logEntry), logEntry.checksum, calculatedChecksum) ||
      logEntry.checksum === calculatedChecksum
    );
  }

  /**
   * å¯¼å‡ºå®¡è®¡æ—¥å¿—
   * @param {Object} filters - å¯¼å‡ºè¿‡æ»¤æ¡ä»¶
   * @param {string} format - å¯¼å‡ºæ ¼å¼ (json/csv)
   */
  exportLogs(filters = {}, format = 'json') {
    const logs = this.searchLogs(filters);

    if (format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'userId',
        'username',
        'eventType',
        'level',
        'resource',
        'action',
        'result',
      ];
      const csvLines = [headers.join(',')];

      logs.forEach((log) => {
        const values = headers.map((h) => {
          const value = log[h] || '';
          return `"${String(value).replace(/"/g, '""')}"`;
        });
        csvLines.push(values.join(','));
      });

      return csvLines.join('\n');
    }

    return JSON.stringify(logs, null, 2);
  }

  /**
   * ç”Ÿæˆå®¡è®¡æŠ¥å‘Š
   */
  generateReport(startDate, endDate) {
    const logs = this.searchLogs({ startDate, endDate, limit: 10000 });

    const report = {
      period: { start: startDate, end: endDate },
      generatedAt: new Date().toISOString(),
      summary: {
        totalLogs: logs.length,
        byLevel: {},
        byEventType: {},
        byUser: {},
      },
      criticalEvents: logs.filter((log) => log.level === LOG_LEVELS.CRITICAL),
      securityAlerts: logs.filter((log) => log.eventType === EVENT_TYPES.SECURITY_ALERT),
      permissionDenials: logs.filter((log) => log.eventType === EVENT_TYPES.PERMISSION_DENIED),
    };

    logs.forEach((log) => {
      report.summary.byLevel[log.level] = (report.summary.byLevel[log.level] || 0) + 1;
      report.summary.byEventType[log.eventType] =
        (report.summary.byEventType[log.eventType] || 0) + 1;
      if (log.userId) {
        report.summary.byUser[log.userId] = (report.summary.byUser[log.userId] || 0) + 1;
      }
    });

    return report;
  }

  /**
   * ä¼˜é›…å…³é—­
   */
  shutdown() {
    this.flush();
  }
}

module.exports = {
  AuditLogger,
  LOG_LEVELS,
  EVENT_TYPES,
};