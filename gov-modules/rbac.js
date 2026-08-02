/**
 * æ”¿åŠ¡çº§æƒé™ç®¡ç†æ¨¡å—
 * åŸºäºŽè§’è‰²çš„è®¿é—®æŽ§åˆ¶ (RBAC) ç³»ç»Ÿ
 */

const cryptoUtils = require('./crypto-utils');

// é¢„å®šä¹‰è§’è‰²
const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  AUDITOR: 'auditor',
  OPERATOR: 'operator',
  USER: 'user',
  GUEST: 'guest',
};

// æƒé™å®šä¹‰
const PERMISSIONS = {
  // ç”¨æˆ·ç®¡ç†æƒé™
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',

  // ä»»åŠ¡ç®¡ç†æƒé™
  TASK_CREATE: 'task:create',
  TASK_READ: 'task:read',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',

  // è®¡åˆ’ç®¡ç†æƒé™
  PLAN_CREATE: 'plan:create',
  PLAN_READ: 'plan:read',
  PLAN_UPDATE: 'plan:update',
  PLAN_DELETE: 'plan:delete',

  // ç³»ç»Ÿç®¡ç†æƒé™
  SYSTEM_CONFIG: 'system:config',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RESTORE: 'system:restore',

  // å®¡è®¡æƒé™
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // æŠ¥è¡¨æƒé™
  REPORT_READ: 'report:read',
  REPORT_GENERATE: 'report:generate',
};

// è§’è‰²-æƒé™æ˜ å°„
const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: [
    PERMISSIONS.USER_CREATE,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_UPDATE,
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_UPDATE,
    PERMISSIONS.TASK_DELETE,
    PERMISSIONS.PLAN_CREATE,
    PERMISSIONS.PLAN_READ,
    PERMISSIONS.PLAN_UPDATE,
    PERMISSIONS.PLAN_DELETE,
    PERMISSIONS.SYSTEM_CONFIG,
    PERMISSIONS.SYSTEM_BACKUP,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.REPORT_READ,
    PERMISSIONS.REPORT_GENERATE,
  ],
  [ROLES.AUDITOR]: [
    PERMISSIONS.USER_READ,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.PLAN_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
    PERMISSIONS.REPORT_READ,
    PERMISSIONS.REPORT_GENERATE,
  ],
  [ROLES.OPERATOR]: [
    PERMISSIONS.TASK_CREATE,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_UPDATE,
    PERMISSIONS.PLAN_CREATE,
    PERMISSIONS.PLAN_READ,
    PERMISSIONS.PLAN_UPDATE,
    PERMISSIONS.REPORT_READ,
  ],
  [ROLES.USER]: [PERMISSIONS.TASK_READ, PERMISSIONS.PLAN_READ],
  [ROLES.GUEST]: [],
};

class RBAC {
  constructor() {
    this.users = new Map();
    this.roles = new Map(Object.entries(ROLE_PERMISSIONS));
    this.userRoles = new Map();
  }

  /**
   * åˆ›å»ºç”¨æˆ·
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string} username - ç”¨æˆ·å
   * @param {string} role - è§’è‰²
   */
  createUser(userId, username, role = ROLES.USER) {
    if (!this.roles.has(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    this.users.set(userId, {
      id: userId,
      username,
      createdAt: new Date().toISOString(),
    });

    this.userRoles.set(userId, [role]);
    return this.users.get(userId);
  }

  /**
   * ä¸ºç”¨æˆ·åˆ†é…è§’è‰²
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string} role - è§’è‰²
   */
  assignRole(userId, role) {
    if (!this.roles.has(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    if (!this.users.has(userId)) {
      throw new Error(`User not found: ${userId}`);
    }

    const roles = this.userRoles.get(userId) || [];
    if (!roles.includes(role)) {
      roles.push(role);
      this.userRoles.set(userId, roles);
    }

    return roles;
  }

  /**
   * ç§»é™¤ç”¨æˆ·è§’è‰²
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string} role - è§’è‰²
   */
  removeRole(userId, role) {
    if (!this.users.has(userId)) {
      throw new Error(`User not found: ${userId}`);
    }

    const roles = this.userRoles.get(userId) || [];
    const index = roles.indexOf(role);
    if (index > -1) {
      roles.splice(index, 1);
      this.userRoles.set(userId, roles);
    }

    return roles;
  }

  /**
   * èŽ·å–ç”¨æˆ·è§’è‰²
   * @param {string} userId - ç”¨æˆ· ID
   * @returns {string[]} ç”¨æˆ·è§’è‰²åˆ—è¡¨
   */
  getUserRoles(userId) {
    return this.userRoles.get(userId) || [ROLES.GUEST];
  }

  /**
   * èŽ·å–ç”¨æˆ·æ‰€æœ‰æƒé™
   * @param {string} userId - ç”¨æˆ· ID
   * @returns {string[]} ç”¨æˆ·æƒé™åˆ—è¡¨
   */
  getUserPermissions(userId) {
    const roles = this.getUserRoles(userId);
    const permissions = new Set();

    roles.forEach((role) => {
      const rolePerms = this.roles.get(role) || [];
      rolePerms.forEach((perm) => permissions.add(perm));
    });

    return Array.from(permissions);
  }

  /**
   * æ£€æŸ¥ç”¨æˆ·æ˜¯å¦æ‹¥æœ‰æŸæƒé™
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string} permission - æƒé™
   * @returns {boolean} æ˜¯å¦æœ‰æƒé™
   */
  hasPermission(userId, permission) {
    const permissions = this.getUserPermissions(userId);
    return permissions.includes(permission);
  }

  /**
   * æ£€æŸ¥ç”¨æˆ·æ˜¯å¦æ‹¥æœ‰æ‰€æœ‰æƒé™
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string[]} permissions - æƒé™åˆ—è¡¨
   * @returns {boolean} æ˜¯å¦æ‹¥æœ‰æ‰€æœ‰æƒé™
   */
  hasAllPermissions(userId, permissions) {
    return permissions.every((perm) => this.hasPermission(userId, perm));
  }

  /**
   * æ£€æŸ¥ç”¨æˆ·æ˜¯å¦æ‹¥æœ‰ä»»ä¸€æƒé™
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string[]} permissions - æƒé™åˆ—è¡¨
   * @returns {boolean} æ˜¯å¦æ‹¥æœ‰ä»»ä¸€æƒé™
   */
  hasAnyPermission(userId, permissions) {
    return permissions.some((perm) => this.hasPermission(userId, perm));
  }

  /**
   * æ£€æŸ¥ç”¨æˆ·æ˜¯å¦æ‹¥æœ‰æŸè§’è‰²
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string} role - è§’è‰²
   * @returns {boolean} æ˜¯å¦æ‹¥æœ‰è¯¥è§’è‰²
   */
  hasRole(userId, role) {
    const roles = this.getUserRoles(userId);
    return roles.includes(role);
  }

  /**
   * æ£€æŸ¥ç”¨æˆ·æ˜¯å¦æ‹¥æœ‰ä»»ä¸€è§’è‰²
   * @param {string} userId - ç”¨æˆ· ID
   * @param {string[]} roles - è§’è‰²åˆ—è¡¨
   * @returns {boolean} æ˜¯å¦æ‹¥æœ‰ä»»ä¸€è§’è‰²
   */
  hasAnyRole(userId, roles) {
    return roles.some((role) => this.hasRole(userId, role));
  }

  /**
   * åˆ›å»ºè‡ªå®šä¹‰è§’è‰²
   * @param {string} roleName - è§’è‰²åç§°
   * @param {string[]} permissions - æƒé™åˆ—è¡¨
   */
  createRole(roleName, permissions) {
    this.roles.set(roleName, permissions);
  }

  /**
   * æ›´æ–°è§’è‰²æƒé™
   * @param {string} roleName - è§’è‰²åç§°
   * @param {string[]} permissions - æƒé™åˆ—è¡¨
   */
  updateRolePermissions(roleName, permissions) {
    if (!this.roles.has(roleName)) {
      throw new Error(`Role not found: ${roleName}`);
    }
    this.roles.set(roleName, permissions);
  }

  /**
   * èŽ·å–æ‰€æœ‰è§’è‰²
   * @returns {Object} è§’è‰²-æƒé™æ˜ å°„
   */
  getAllRoles() {
    return Object.fromEntries(this.roles);
  }

  /**
   * èŽ·å–æ‰€æœ‰æƒé™
   * @returns {Object} æƒé™å®šä¹‰
   */
  getAllPermissions() {
    return PERMISSIONS;
  }

  /**
   * æƒé™ä¸­é—´ä»¶
   * @param {string} permission - æ‰€éœ€æƒé™
   * @returns {Function} ä¸­é—´ä»¶å‡½æ•°
   */
  requirePermission(permission) {
    return (userId, next) => {
      if (!this.hasPermission(userId, permission)) {
        throw new Error(`Permission denied: ${permission}`);
      }
      return next();
    };
  }

  /**
   * å¯¼å‡º RBAC é…ç½®ï¼ˆåŠ å¯†ï¼‰
   */
  exportConfig() {
    const config = {
      users: Array.from(this.users.entries()),
      roles: Array.from(this.roles.entries()),
      userRoles: Array.from(this.userRoles.entries()),
      exportedAt: new Date().toISOString(),
    };
    return cryptoUtils.encrypt(config);
  }

  /**
   * å¯¼å…¥ RBAC é…ç½®ï¼ˆè§£å¯†ï¼‰
   */
  importConfig(encryptedConfig) {
    const config = cryptoUtils.decrypt(encryptedConfig);
    this.users = new Map(config.users);
    this.roles = new Map(config.roles);
    this.userRoles = new Map(config.userRoles);
  }
}

module.exports = {
  RBAC,
  ROLES,
  PERMISSIONS,
};
