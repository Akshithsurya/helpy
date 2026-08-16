"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPlanPresets = loadPlanPresets;
exports.loadPlanPresetsAsync = loadPlanPresetsAsync;
exports.getPlanPresetByName = getPlanPresetByName;
exports.getPresetsByCategory = getPresetsByCategory;
exports.clearPresetCache = clearPresetCache;
// Default presets as fallback (embedded, no YAML/fs needed)
const DEFAULT_PRESETS = [
    { name: 'work', title: 'Work Session', goal: 'Focus on work tasks', durationMinutes: 60, chunkSizeMinutes: 15, breakMinutes: 5, difficulty: 'medium', tags: ['work', 'productivity'], theme: 'professional', category: 'Work' },
    { name: 'study', title: 'Study Session', goal: 'Focus on studying', durationMinutes: 45, chunkSizeMinutes: 15, breakMinutes: 5, difficulty: 'medium', tags: ['study', 'learning'], theme: 'academic', category: 'Study' },
    { name: 'focus', title: 'Deep Focus', goal: 'Deep focus session', durationMinutes: 25, chunkSizeMinutes: 10, breakMinutes: 5, difficulty: 'high', tags: ['focus', 'deep-work'], theme: 'minimal', category: 'Focus' },
    { name: 'code', title: 'Coding Session', goal: 'Write code and solve problems', durationMinutes: 90, chunkSizeMinutes: 15, breakMinutes: 5, difficulty: 'high', tags: ['coding', 'development'], theme: 'hacker', category: 'Creative' },
    { name: 'design', title: 'Design Session', goal: 'Create and refine designs', durationMinutes: 60, chunkSizeMinutes: 15, breakMinutes: 5, difficulty: 'medium', tags: ['design', 'creativity'], theme: 'creative', category: 'Creative' },
    { name: 'write', title: 'Writing Session', goal: 'Write articles, docs, or content', durationMinutes: 45, chunkSizeMinutes: 10, breakMinutes: 5, difficulty: 'medium', tags: ['writing', 'content'], theme: 'cozy', category: 'Creative' },
    { name: 'read', title: 'Reading Session', goal: 'Read and learn new things', durationMinutes: 30, chunkSizeMinutes: 10, breakMinutes: 5, difficulty: 'low', tags: ['reading', 'learning'], theme: 'cozy', category: 'Health' },
    { name: 'exercise', title: 'Exercise Session', goal: 'Physical activity or workout', durationMinutes: 45, chunkSizeMinutes: 15, breakMinutes: 5, difficulty: 'medium', tags: ['exercise', 'health'], theme: 'energetic', category: 'Health' },
    { name: 'meditate', title: 'Meditation Session', goal: 'Practice mindfulness and meditation', durationMinutes: 15, chunkSizeMinutes: 5, breakMinutes: 0, difficulty: 'low', tags: ['meditation', 'mindfulness'], theme: 'zen', category: 'Health' },
    { name: 'clean', title: 'Cleaning Session', goal: 'Clean and organize space', durationMinutes: 30, chunkSizeMinutes: 10, breakMinutes: 5, difficulty: 'low', tags: ['cleaning', 'organization'], theme: 'fresh', category: 'Health' },
    { name: 'review', title: 'Review Session', goal: 'Review work or materials', durationMinutes: 45, chunkSizeMinutes: 10, breakMinutes: 5, difficulty: 'medium', tags: ['review', 'planning'], theme: 'academic', category: 'Work' },
    { name: 'plan', title: 'Planning Session', goal: 'Plan and organize tasks', durationMinutes: 30, chunkSizeMinutes: 10, breakMinutes: 0, difficulty: 'low', tags: ['planning', 'organization'], theme: 'organized', category: 'Work' },
    { name: 'pomodoro', title: 'Pomodoro Technique', goal: 'Work in focused sprints with regular breaks', durationMinutes: 120, chunkSizeMinutes: 25, breakMinutes: 5, difficulty: 'medium', tags: ['pomodoro', 'timer', 'focus'], theme: 'energetic', category: 'Timer', timerMode: 'pomodoro', longBreakMinutes: 15, longBreakInterval: 4 }
];
class YamlConfigValidator {
    constructor(config) {
        this.errors = [];
        this.warnings = [];
        this.config = config;
    }
    validate() {
        this.validateVersion();
        this.validateSchema();
        this.validatePresets();
        return {
            valid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings
        };
    }
    validateVersion() {
        if (!this.config.version) {
            this.warnings.push('No version specified in config file');
            return;
        }
        // Simple version format check (should be x.y.z)
        const versionPattern = /^\d+\.\d+\.\d+$/;
        if (!versionPattern.test(this.config.version)) {
            this.warnings.push(`Version format "${this.config.version}" is not standard (expected x.y.z)`);
        }
    }
    validateSchema() {
        if (!this.config.schema) {
            this.warnings.push('No schema defined for validation');
            return;
        }
        const { required_fields, optional_fields, validation_rules } = this.config.schema;
        if (!required_fields || !Array.isArray(required_fields)) {
            this.warnings.push('Schema required_fields is missing or invalid');
        }
        if (!optional_fields || !Array.isArray(optional_fields)) {
            this.warnings.push('Schema optional_fields is missing or invalid');
        }
        if (!validation_rules || typeof validation_rules !== 'object') {
            this.warnings.push('Schema validation_rules is missing or invalid');
        }
    }
    validatePresets() {
        if (!this.config.presets || !Array.isArray(this.config.presets)) {
            this.errors.push('Presets array is missing or invalid');
            return;
        }
        if (this.config.presets.length === 0) {
            this.warnings.push('No presets defined in config file');
            return;
        }
        const seenNames = new Set();
        const rules = this.config.schema?.validation_rules || {};
        this.config.presets.forEach((preset, index) => {
            // Check for duplicate names
            if (seenNames.has(preset.name)) {
                this.errors.push(`Preset at index ${index} has duplicate name: "${preset.name}"`);
            }
            seenNames.add(preset.name);
            // Validate required fields
            const requiredFields = this.config.schema?.required_fields || ['name', 'title', 'goal', 'durationMinutes'];
            for (const field of requiredFields) {
                if (!preset[field]) {
                    this.errors.push(`Preset "${preset.name || `index-${index}`}" is missing required field: ${field}`);
                }
            }
            // Validate numeric fields
            if (preset.durationMinutes !== undefined) {
                const durRule = rules.durationMinutes || { min: 5, max: 480 };
                if (preset.durationMinutes < durRule.min || preset.durationMinutes > durRule.max) {
                    this.warnings.push(`Preset "${preset.name}" durationMinutes (${preset.durationMinutes}) is outside recommended range [${durRule.min}-${durRule.max}]`);
                }
            }
            if (preset.chunkSizeMinutes !== undefined) {
                const chunkRule = rules.chunkSizeMinutes || { min: 5, max: 120 };
                if (preset.chunkSizeMinutes < chunkRule.min || preset.chunkSizeMinutes > chunkRule.max) {
                    this.warnings.push(`Preset "${preset.name}" chunkSizeMinutes (${preset.chunkSizeMinutes}) is outside recommended range [${chunkRule.min}-${chunkRule.max}]`);
                }
            }
            if (preset.breakMinutes !== undefined) {
                const breakRule = rules.breakMinutes || { min: 0, max: 60 };
                if (preset.breakMinutes < breakRule.min || preset.breakMinutes > breakRule.max) {
                    this.warnings.push(`Preset "${preset.name}" breakMinutes (${preset.breakMinutes}) is outside recommended range [${breakRule.min}-${breakRule.max}]`);
                }
            }
        });
    }
}
let cachedPresets = null;
let _cachedPresetsRaw = [];
let _cachedPresetsView = [];
let _presetByNameMap = null;
let _cacheBuilt = false;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000;
const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
function _buildCaches(presets) {
    _cachedPresetsRaw = presets;
    _cachedPresetsView = Object.freeze(_cachedPresetsRaw.slice());
    _presetByNameMap = new Map(presets.map(p => [p.name.toLowerCase(), p]));
    _cacheBuilt = true;
}
function _invalidateCaches() {
    cachedPresets = null;
    _cachedPresetsRaw = [];
    _cachedPresetsView = [];
    _presetByNameMap = null;
    _cacheBuilt = false;
    cacheTimestamp = 0;
}
function loadPlanPresets(configPath) {
    const now = Date.now();
    if (cachedPresets !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return _cachedPresetsRaw.slice();
    }
    if (isNode) {
        try {
            const fs = require('fs');
            const path = require('path');
            const yaml = require('js-yaml');
            const defaultPath = path.join(__dirname, '../../config/plan-presets.yaml');
            const filePath = configPath || defaultPath;
            if (fs.existsSync(filePath)) {
                const fileContents = fs.readFileSync(filePath, 'utf8');
                const config = yaml.load(fileContents);
                if (config) {
                    const validator = new YamlConfigValidator(config);
                    const validationResult = validator.validate();
                    if (!validationResult.valid) {
                        console.warn('⚠️ YAML config validation errors:', validationResult.errors);
                    }
                    if (validationResult.warnings.length > 0) {
                        console.warn('⚠️ YAML config validation warnings:', validationResult.warnings);
                    }
                    if (config.presets && Array.isArray(config.presets) && config.presets.length > 0) {
                        cachedPresets = config.presets;
                        cacheTimestamp = now;
                        _buildCaches(config.presets);
                        if (typeof setImmediate !== 'undefined') {
                            setImmediate(() => {
                                loadPlanPresetsAsync(configPath).catch(() => { });
                            });
                        }
                        return _cachedPresetsRaw.slice();
                    }
                }
            }
        }
        catch (error) {
            console.error('Error loading plan presets from YAML, using defaults:', error);
        }
    }
    cachedPresets = [...DEFAULT_PRESETS];
    cacheTimestamp = now;
    _buildCaches([...DEFAULT_PRESETS]);
    return _cachedPresetsRaw.slice();
}
async function loadPlanPresetsAsync(configPath) {
    const now = Date.now();
    if (cachedPresets !== null && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return _cachedPresetsRaw.slice();
    }
    if (isNode) {
        try {
            const fs = require('fs');
            const path = require('path');
            const yaml = require('js-yaml');
            const defaultPath = path.join(__dirname, '../../config/plan-presets.yaml');
            const filePath = configPath || defaultPath;
            const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            if (exists) {
                const fileContents = await fs.promises.readFile(filePath, 'utf8');
                const config = yaml.load(fileContents);
                if (config) {
                    const validator = new YamlConfigValidator(config);
                    const validationResult = validator.validate();
                    if (!validationResult.valid) {
                        console.warn('⚠️ YAML config validation errors:', validationResult.errors);
                    }
                    if (validationResult.warnings.length > 0) {
                        console.warn('⚠️ YAML config validation warnings:', validationResult.warnings);
                    }
                    if (config.presets && Array.isArray(config.presets) && config.presets.length > 0) {
                        cachedPresets = config.presets;
                        cacheTimestamp = now;
                        _buildCaches(config.presets);
                        return _cachedPresetsRaw.slice();
                    }
                }
            }
        }
        catch (error) {
            console.error('Error loading plan presets from YAML (async), using defaults:', error);
        }
    }
    cachedPresets = [...DEFAULT_PRESETS];
    cacheTimestamp = now;
    _buildCaches([...DEFAULT_PRESETS]);
    return _cachedPresetsRaw.slice();
}
function getPlanPresetByName(presets, name) {
    const normalizedName = name.toLowerCase().trim();
    if (_presetByNameMap !== null) {
        const fromMap = _presetByNameMap.get(normalizedName);
        if (fromMap !== undefined) {
            return fromMap;
        }
    }
    return presets.find(preset => preset.name.toLowerCase() === normalizedName);
}
function getPresetsByCategory(presets, category) {
    const normalizedCategory = category.toLowerCase().trim();
    return presets.filter(preset => preset.category && preset.category.toLowerCase() === normalizedCategory);
}
function clearPresetCache() {
    _invalidateCaches();
}
