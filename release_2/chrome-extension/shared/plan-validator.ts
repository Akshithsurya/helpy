const MIN_PLAN_DURATION_MINUTES = 5;
const MAX_PLAN_DURATION_MINUTES = 240;

function _removeEmojis(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  const emojiRegex = /[\u{1F000}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu;
  return text.replace(emojiRegex, '').replace(/\s+/g, ' ').trim();
}

function _validateInput(input: string, maxLength: number = 100): string {
  if (typeof input !== 'string') return '';
  let sanitized = _removeEmojis(input.trim());
  sanitized = sanitized.replace(/[<>]/g, '');
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

const _HOURS_MINUTES = /^(?<hours>\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(?<mins>\d*)\s*(?:m(?:in(?:utes?)?)?)?\b\s*/i;
const _BARE_MINUTES = /^(?<mins>\d+(?:\.\d+)?)\s*(?:m(?:in(?:utes?)?)?)?\b\s*/i;

function _matchDuration(str: string): [number, number] | null {
  let m = str.match(_HOURS_MINUTES);
  if (m && m.groups) {
    const hours = parseFloat(m.groups.hours || '0');
    const mins = parseInt(m.groups.mins || '0', 10);
    return [hours * 60 + mins, m[0].length];
  }
  m = str.match(_BARE_MINUTES);
  if (m && m.groups) {
    return [parseFloat(m.groups.mins || '0'), m[0].length];
  }
  return null;
}

function _parseDuration(str: string): number | null {
  if (!str || !str.length) return null;
  const result = _matchDuration(str.trim());
  return result ? result[0] : null;
}

const _PRESET_DEFAULTS: Record<string, { title: string; duration: number; goal: string }> = {
  work: { title: 'Work Session', duration: 60, goal: 'Focus on work tasks' },
  study: { title: 'Study Session', duration: 45, goal: 'Focus on studying' },
  focus: { title: 'Deep Focus', duration: 25, goal: 'Deep focus session' },
  'focus session': { title: 'Deep Focus', duration: 25, goal: 'Deep focus session' },
  code: { title: 'Coding Session', duration: 90, goal: 'Write code and solve problems' },
  design: { title: 'Design Session', duration: 60, goal: 'Create and refine designs' },
  write: { title: 'Writing Session', duration: 45, goal: 'Write articles, docs, or content' },
  read: { title: 'Reading Session', duration: 30, goal: 'Read and learn new things' },
  exercise: { title: 'Exercise Session', duration: 45, goal: 'Physical activity or workout' },
  meditate: { title: 'Meditation Session', duration: 15, goal: 'Practice mindfulness and meditation' },
  clean: { title: 'Cleaning Session', duration: 30, goal: 'Clean and organize space' },
  review: { title: 'Review Session', duration: 45, goal: 'Review work or materials' },
  plan: { title: 'Planning Session', duration: 30, goal: 'Plan and organize tasks' },
  sprint: { title: 'Quick Focus Sprint', duration: 25, goal: 'Short, focused burst of work' },
  blitz: { title: 'Task Blitz', duration: 15, goal: 'Knock out small tasks quickly' },
  micro: { title: 'Micro Focus', duration: 10, goal: 'Ultra-short focus session' },
  deep: { title: 'Deep Dive', duration: 45, goal: 'Extended focused work' },
  'quick task': { title: 'Quick Task Blitz', duration: 10, goal: 'Tackle one small task' },
};

const DEFAULT_PLAN_DURATION_MINUTES = 30;
const DEFAULT_CHUNK_SIZE_MINUTES = 15;
const DEFAULT_BREAK_MINUTES = 5;

function _normalizeBoundedMinutes(
  value: unknown,
  fallback: number,
  min: number = MIN_PLAN_DURATION_MINUTES,
  max: number = MAX_PLAN_DURATION_MINUTES
): number {
  const parsedValue = Number.parseInt(value as string, 10);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.max(min, Math.min(max, parsedValue));
}

function _tokenizeArgs(args: string): Array<{ raw: string; isFlag: boolean }> {
  const tokens: Array<{ raw: string; isFlag: boolean }> = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) {
    const raw = m[2] ?? m[1] ?? m[3] ?? '';
    tokens.push({ raw, isFlag: raw.startsWith('--') && raw.length > 2 });
  }
  return tokens;
}

function _internalParsePlanArguments(args: string = '') {
  const normalized = typeof args === 'string' ? args : '';
  let remaining = normalized.trim();
  let title = 'Planned session';
  let durationMinutes = DEFAULT_PLAN_DURATION_MINUTES;
  let goal = '';
  let usedPreset: string | null = null;
  let chunkSizeMinutes: number | undefined;
  let breakMinutes: number | undefined;
  let tags: string[] = [];

  const flagPatterns = [
    { regex: /--goal\s+("([^"]+)"|'([^']+)'|(\S+))/i, name: 'goal' },
    { regex: /--chunk(?:\s+|=)(\d+)/i, name: 'chunk' },
    { regex: /--break(?:\s+|=)(\d+)/i, name: 'break' },
    { regex: /--tags\s+("([^"]+)"|'([^']+)'|(\S+))/i, name: 'tags' },
  ];

  flagPatterns.forEach(flag => {
    const match = remaining.match(flag.regex);
    if (match) {
      if (flag.name === 'goal') goal = (match[2] || match[3] || match[4] || '').trim();
      else if (flag.name === 'chunk') chunkSizeMinutes = parseInt(match[1], 10);
      else if (flag.name === 'break') breakMinutes = parseInt(match[1], 10);
      else if (flag.name === 'tags') {
        const s = (match[2] || match[3] || match[4] || '').trim();
        tags = s.split(',').map(t => t.trim()).filter(t => t);
      }
      remaining = remaining.replace(match[0], '').trim();
    }
  });

  let parts = remaining ? remaining.split(/\s+/) : [];
  if (remaining) {
    const lowerTrimmed = remaining.toLowerCase();
    const presetNames = Object.keys(_PRESET_DEFAULTS).sort((a, b) => b.length - a.length);
    const matched = presetNames.find(name => lowerTrimmed === name || lowerTrimmed.startsWith(name + ' '));
    if (matched) {
      const p = _PRESET_DEFAULTS[matched];
      title = p.title;
      durationMinutes = p.duration;
      if (!goal) goal = p.goal;
      usedPreset = matched;
      const after = remaining.slice(matched.length).trim();
      parts = after ? after.split(/\s+/) : [];
    }
  }

  if (parts.length > 0) {
    const partsStr = parts.join(' ');
    const d = _parseDuration(partsStr);
    if (d !== null && d > 0) {
      const [, endIdx] = _matchDuration(partsStr) || [0, 0];
      const customTitle = partsStr.slice(endIdx).trim();
      durationMinutes = d;
      if (customTitle) title = customTitle;
    } else {
      title = partsStr;
    }
  }

  durationMinutes = _normalizeBoundedMinutes(
    durationMinutes,
    DEFAULT_PLAN_DURATION_MINUTES,
    MIN_PLAN_DURATION_MINUTES,
    MAX_PLAN_DURATION_MINUTES
  );

  return { title, goal, durationMinutes, usedPreset, chunkSizeMinutes, breakMinutes, tags };
}

function parsePlanArguments(args: string = '') {
  try { return _internalParsePlanArguments(args); }
  catch (e) {
    return {
      title: 'Planned session', goal: '',
      durationMinutes: DEFAULT_PLAN_DURATION_MINUTES,
      usedPreset: null,
      chunkSizeMinutes: undefined, breakMinutes: undefined, tags: [],
    };
  }
}

function validateInput(input: string, maxLength: number = 100): string {
  return _validateInput(input, maxLength);
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
}

export interface ValidationFix {
  description: string;
  apply: () => string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  infos: ValidationError[];
  fixes: ValidationFix[];
  suggestions: string[];
}

export class PlanValidator {
  private args: string;
  private parsed: any;

  constructor(args: string) {
    this.args = args;
    this.parsed = parsePlanArguments(args);
  }

  validate(): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      infos: [],
      fixes: [],
      suggestions: []
    };

    this.validateTitle(result);
    this.validateGoal(result);
    this.validateDuration(result);
    this.validateChunkSize(result);
    this.validateBreakTime(result);
    this.validateTags(result);
    this.generateSuggestions(result);

    result.valid = result.errors.length === 0;
    return result;
  }

  private validateTitle(result: ValidationResult): void {
    const title = this.parsed.title;
    
    if (!title || title.trim().length === 0) {
      result.warnings.push({
        field: 'title',
        message: '计划标题为空，建议提供清晰的标题',
        severity: 'warning',
        code: 'TITLE_EMPTY'
      });
    } else if (title.length > 100) {
      result.errors.push({
        field: 'title',
        message: '计划标题过长，最多100个字符',
        severity: 'error',
        code: 'TITLE_TOO_LONG'
      });
      result.fixes.push({
        description: '缩短标题',
        apply: () => this.args.replace(title, title.substring(0, 97) + '...')
      });
    } else if (title.length < 3) {
      result.warnings.push({
        field: 'title',
        message: '标题较短，建议更详细描述',
        severity: 'warning',
        code: 'TITLE_SHORT'
      });
    }
  }

  private validateGoal(result: ValidationResult): void {
    const goal = this.parsed.goal;
    
    if (goal && goal.length > 500) {
      result.errors.push({
        field: 'goal',
        message: '计划目标过长，最多500个字符',
        severity: 'error',
        code: 'GOAL_TOO_LONG'
      });
      result.fixes.push({
        description: '缩短目标描述',
        apply: () => {
          const goalMatch = this.args.match(/--goal\s+["']?([^"']+)["']?/i);
          if (goalMatch) {
            return this.args.replace(goalMatch[1], goalMatch[1].substring(0, 497) + '...');
          }
          return this.args;
        }
      });
    }
  }

  private validateDuration(result: ValidationResult): void {
    const duration = this.parsed.durationMinutes;
    
    if (duration < MIN_PLAN_DURATION_MINUTES) {
      result.warnings.push({
        field: 'duration',
        message: `建议计划时长至少 ${MIN_PLAN_DURATION_MINUTES} 分钟`,
        severity: 'warning',
        code: 'DURATION_TOO_SHORT'
      });
      result.fixes.push({
        description: `调整为 ${MIN_PLAN_DURATION_MINUTES} 分钟`,
        apply: () => this.args.replace(/\b\d+\b(?=\s*(min|minutes|m|$))/i, String(MIN_PLAN_DURATION_MINUTES))
      });
    } else if (duration > MAX_PLAN_DURATION_MINUTES) {
      result.warnings.push({
        field: 'duration',
        message: `建议计划时长不超过 ${MAX_PLAN_DURATION_MINUTES} 分钟`,
        severity: 'warning',
        code: 'DURATION_TOO_LONG'
      });
      result.fixes.push({
        description: `调整为 ${MAX_PLAN_DURATION_MINUTES} 分钟`,
        apply: () => this.args.replace(/\b\d+\b(?=\s*(min|minutes|m|$))/i, String(MAX_PLAN_DURATION_MINUTES))
      });
    } else {
      result.infos.push({
        field: 'duration',
        message: `时长设置合理 (${duration}分钟)`,
        severity: 'info',
        code: 'DURATION_GOOD'
      });
    }
  }

  private validateChunkSize(result: ValidationResult): void {
    const chunkSize = this.parsed.chunkSizeMinutes;
    const duration = this.parsed.durationMinutes;
    
    if (chunkSize !== undefined) {
      if (chunkSize < MIN_PLAN_DURATION_MINUTES) {
        result.warnings.push({
          field: 'chunkSize',
          message: `工作块时长较短，建议至少 ${MIN_PLAN_DURATION_MINUTES} 分钟`,
          severity: 'warning',
          code: 'CHUNK_TOO_SHORT'
        });
      } else if (chunkSize > 60) {
        result.warnings.push({
          field: 'chunkSize',
          message: '工作块时长较长，建议不超过60分钟以保持专注',
          severity: 'warning',
          code: 'CHUNK_TOO_LONG'
        });
      }
      
      if (chunkSize > duration) {
        result.errors.push({
          field: 'chunkSize',
          message: '工作块时长不能超过计划总时长',
          severity: 'error',
          code: 'CHUNK_EXCEEDS_DURATION'
        });
      }
    }
  }

  private validateBreakTime(result: ValidationResult): void {
    const breakTime = this.parsed.breakMinutes;
    const chunkSize = this.parsed.chunkSizeMinutes;
    
    if (breakTime !== undefined && chunkSize !== undefined) {
      if (breakTime > chunkSize / 2) {
        result.warnings.push({
          field: 'breakTime',
          message: '休息时间过长，建议不超过工作块的一半',
          severity: 'warning',
          code: 'BREAK_TOO_LONG'
        });
      }
    }
  }

  private validateTags(result: ValidationResult): void {
    const tags = this.parsed.tags || [];
    
    if (tags.length > 10) {
      result.warnings.push({
        field: 'tags',
        message: '标签过多，建议不超过10个',
        severity: 'warning',
        code: 'TOO_MANY_TAGS'
      });
    }
    
    tags.forEach((tag: string, index: number) => {
      const cleanTag = validateInput(tag, 30);
      if (tag !== cleanTag) {
        result.warnings.push({
          field: `tags[${index}]`,
          message: `标签 "${tag}" 包含无效字符或过长`,
          severity: 'warning',
          code: 'TAG_INVALID'
        });
      }
    });
  }

  private generateSuggestions(result: ValidationResult): void {
    const presets = ['work', 'study', 'focus', 'code', 'read', 'exercise'];
    const lowerArgs = this.args.toLowerCase();
    
    presets.forEach(preset => {
      if (!lowerArgs.includes(preset)) {
        result.suggestions.push(preset);
      }
    });
    
    if (!this.parsed.goal) {
      result.infos.push({
        field: 'goal',
        message: '可以添加 --goal 参数来设置计划目标',
        severity: 'info',
        code: 'GOAL_MISSING_SUGGESTION'
      });
    }
  }
}

export function validatePlan(args: string): ValidationResult {
  const validator = new PlanValidator(args);
  return validator.validate();
}

export function getValidationSummary(result: ValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return '✓ 计划配置完美！';
  }
  
  const parts: string[] = [];
  if (result.errors.length > 0) {
    parts.push(`✗ ${result.errors.length} 个错误`);
  }
  if (result.warnings.length > 0) {
    parts.push(`⚠ ${result.warnings.length} 个警告`);
  }
  if (result.infos.length > 0) {
    parts.push(`ℹ ${result.infos.length} 条提示`);
  }
  
  return parts.join(' | ');
}

// 兼容函数 - 为了保持向后兼容性
export function validatePlanArguments(args: string): ValidationResult {
  return validatePlan(args);
}

export default {
  PlanValidator,
  validatePlan,
  validatePlanArguments,
  getValidationSummary
};
