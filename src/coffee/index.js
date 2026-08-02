const SecurityManager = require('./security');
const BehaviorAnalytics = require('./behavior-analytics');
const PlanEnhancer = require('./plan-enhancer');

module.exports = {
  // Core classes
  SecurityManager,
  BehaviorAnalytics,
  PlanEnhancer,

  // Alias + re-exports for convenience
  CoffeeSimpleCache: PlanEnhancer.SimpleCache,
  DEFAULT_EVENT_TYPES: BehaviorAnalytics.DEFAULT_EVENT_TYPES,

  // Error classes (re-exported for instanceof checks by consumers)
  SecurityError: SecurityManager.SecurityError,
  EncryptionError: SecurityManager.EncryptionError,
  DecryptionError: SecurityManager.DecryptionError,
  HashingError: SecurityManager.HashingError,
  KeyLengthError: SecurityManager.KeyLengthError,
  CSRFTokenError: SecurityManager.CSRFTokenError,
  RateLimitError: SecurityManager.RateLimitError,
};
