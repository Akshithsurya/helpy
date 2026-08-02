const SecurityManager = require('./security');
const BehaviorAnalytics = require('./behavior-analytics');
const PlanEnhancer = require('./plan-enhancer');

module.exports = {
  SecurityManager,
  BehaviorAnalytics,
  PlanEnhancer,

  CoffeeSimpleCache: PlanEnhancer.SimpleCache,
  DEFAULT_EVENT_TYPES: BehaviorAnalytics.DEFAULT_EVENT_TYPES,

  SecurityError: SecurityManager.SecurityError,
  EncryptionError: SecurityManager.EncryptionError,
  DecryptionError: SecurityManager.DecryptionError,
  HashingError: SecurityManager.HashingError,
  KeyLengthError: SecurityManager.KeyLengthError,
  CSRFTokenError: SecurityManager.CSRFTokenError,
  RateLimitError: SecurityManager.RateLimitError,
};
