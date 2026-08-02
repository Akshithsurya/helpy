import React, { useState, useReducer, useCallback, useMemo, useRef, useEffect } from 'react';
import { Task, FocusPlan, PlanPreset } from '../types';
import {
  parsePlanArguments,
  createPlanConfig,
  breakDownIntoTasks,
  validatePlanInput,
  validatePlanArguments,
  getAutocompleteSuggestions,
  addShortcut,
  addToPlanHistory,
  MIN_PLAN_DURATION_MINUTES,
  MAX_PLAN_DURATION_MINUTES,
  DEFAULT_PLAN_DURATION_MINUTES,
  DEFAULT_CHUNK_SIZE_MINUTES,
  DEFAULT_BREAK_MINUTES,
  generateSmartRecommendation,
} from '../../chrome-extension/shared/plan-command';
import PlanPresets from './PlanPresets';
import TaskList from './TaskList';
import BreakSchedule from './BreakSchedule';
import PlanPreview from './PlanPreview';
import ErrorBoundary from './ErrorBoundary';
import LoadingSpinner from './LoadingSpinner';
import { useToast } from './ToastNotification';
import { logger } from '../utils/logger';
import { debounce, cyrb53 } from '../utils/performance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanBuilderProps {
  initialPlanArgs?: string;
  onPlanCreated?: (plan: FocusPlan) => void;
}

interface ValidationState {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface AutocompleteSuggestion {
  content: string;
  description: string;
}

interface BuilderState {
  planArgs: string;
  title: string;
  goal: string;
  durationMinutes: number;
  chunkSizeMinutes: number;
  breakMinutes: number;
  includeBreaks: boolean;
  tags: string[];
  tagInput: string;
  validationResult: ValidationState;
  isGenerating: boolean;
  showPreview: boolean;
  showSuggestions: boolean;
  autocompleteSuggestions: AutocompleteSuggestion[];
  userEnergy: number;
  workIntensity: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_VALIDATION: ValidationState = { valid: true, errors: [], warnings: [] };

const INITIAL_STATE: BuilderState = {
  planArgs: '',
  title: '',
  goal: '',
  durationMinutes: DEFAULT_PLAN_DURATION_MINUTES,
  chunkSizeMinutes: DEFAULT_CHUNK_SIZE_MINUTES,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  includeBreaks: false,
  tags: [],
  tagInput: '',
  validationResult: INITIAL_VALIDATION,
  isGenerating: false,
  showPreview: true,
  showSuggestions: false,
  autocompleteSuggestions: [],
  userEnergy: 70,
  workIntensity: 60,
};

/** Debounce delay (ms) for preview recomputation — single source of truth. */
const PREVIEW_DEBOUNCE_MS = 150;

/** Debounce delay (ms) for autocomplete text search. */
const SEARCH_DEBOUNCE_MS = 100;

/** Valid chunk-size presets used by the recommendation applier. */
const VALID_CHUNK_PRESETS = [5, 10, 15, 20, 30] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (val: number, min: number, max: number) =>
  Math.max(min, Math.min(max, val));

/** Pick the fields that feed into preview/task computation. */
type ComputationSeed = Pick<
  BuilderState,
  | 'title'
  | 'goal'
  | 'durationMinutes'
  | 'chunkSizeMinutes'
  | 'breakMinutes'
  | 'includeBreaks'
  | 'tags'
  | 'planArgs'
>;

function extractSeed(s: BuilderState): ComputationSeed {
  return {
    title: s.title,
    goal: s.goal,
    durationMinutes: s.durationMinutes,
    chunkSizeMinutes: s.chunkSizeMinutes,
    breakMinutes: s.breakMinutes,
    includeBreaks: s.includeBreaks,
    tags: s.tags,
    planArgs: s.planArgs,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type BuilderAction =
  | { type: 'patch'; payload: Partial<BuilderState> }
  | { type: 'addTag'; tag: string }
  | { type: 'removeTag'; tag: string }
  | { type: 'togglePreview' };

function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.payload };

    case 'addTag': {
      const trimmed = action.tag.trim();
      if (trimmed && !state.tags.includes(trimmed)) {
        return { ...state, tags: [...state.tags, trimmed], tagInput: '' };
      }
      return state;
    }

    case 'removeTag':
      return { ...state, tags: state.tags.filter((t) => t !== action.tag) };

    case 'togglePreview':
      return { ...state, showPreview: !state.showPreview };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Small presentational components
// ---------------------------------------------------------------------------

const TagChip = React.memo(
  function TagChip({ tag, onRemove }: { tag: string; onRemove: (tag: string) => void }) {
    return (
      <span
        className="plan-builder-tag inline-flex items-center px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded"
        role="listitem"
      >
        {tag}
        <button
          type="button"
          onClick={() => onRemove(tag)}
          className="plan-builder-tag-remove ml-2 text-blue-800 hover:text-blue-900"
          aria-label={`Remove tag ${tag}`}
        >
          &times;
        </button>
      </span>
    );
  },
  (prev, next) => prev.tag === next.tag,
);

const SuggestionItem = React.memo(
  function SuggestionItem({
    suggestion,
    onClick,
  }: {
    suggestion: AutocompleteSuggestion;
    onClick: (suggestion: AutocompleteSuggestion) => void;
  }) {
    return (
      <div
        onMouseDown={(e) => e.preventDefault()} // prevent input blur before click fires
        onClick={() => onClick(suggestion)}
        className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b last:border-0"
      >
        <div className="font-medium">{suggestion.content}</div>
        <div className="text-xs text-gray-500">{suggestion.description}</div>
      </div>
    );
  },
  (prev, next) => prev.suggestion.content === next.suggestion.content,
);

const ValidationMessage = React.memo(
  function ValidationMessage({ items, variant }: { items: string[]; variant: 'error' | 'warning' }) {
    if (items.length === 0) return null;

    const isError = variant === 'error';
    const cls = isError ? 'plan-builder-errors mb-4' : 'plan-builder-warnings mb-4';
    const role = isError ? 'alert' : 'status';
    const innerCls = isError
      ? 'plan-builder-error text-red-600 bg-red-50 p-2 rounded mb-1'
      : 'plan-builder-warning text-yellow-700 bg-yellow-50 p-2 rounded mb-1';
    const prefix = isError ? '[Error]' : '[Hint]';

    return (
      <div className={cls} role={role} aria-live="polite">
        {items.map((msg, idx) => (
          <div key={`${variant}-${idx}-${cyrb53(msg)}`} className={innerCls}>
            {prefix} {msg}
          </div>
        ))}
      </div>
    );
  },
  (prev, next) =>
    prev.variant === next.variant &&
    prev.items.length === next.items.length &&
    prev.items.every((m, i) => m === next.items[i]),
);

// ---------------------------------------------------------------------------
// Custom hook: debounced state seed
// ---------------------------------------------------------------------------

/**
 * Returns a debounced snapshot of the computation-relevant fields.
 * A single debounce timer is reused and cleaned up on unmount.
 */
function useDebouncedSeed(state: BuilderState, delayMs = PREVIEW_DEBOUNCE_MS): ComputationSeed {
  const [seed, setSeed] = useState<ComputationSeed>(() => extractSeed(state));

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending tick
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      setSeed(extractSeed(state));
    }, delayMs);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }); // no dependency array — runs after every render, then debounces

  return seed;
}

// ---------------------------------------------------------------------------
// Custom hook: debounced search text (for autocomplete)
// ---------------------------------------------------------------------------

function useDebouncedSearchText(text: string, delayMs = SEARCH_DEBOUNCE_MS): string {
  const [debounced, setDebounced] = useState(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(text), delayMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [text, delayMs]);

  return debounced;
}

// ---------------------------------------------------------------------------
// PlanBuilder
// ---------------------------------------------------------------------------

const PlanBuilder: React.FC<PlanBuilderProps> = ({ initialPlanArgs = '', onPlanCreated }) => {
  const { addToast } = useToast();

  // ---- state ----
  const [state, dispatch] = useReducer(builderReducer, {
    ...INITIAL_STATE,
    planArgs: initialPlanArgs,
  });

  /** Single stable dispatch helper — replaces ~15 individual setters. */
  const patch = useCallback(
    (payload: Partial<BuilderState>) => dispatch({ type: 'patch', payload }),
    [],
  );

  // ---- debounced derived values ----
  const seed = useDebouncedSeed(state);
  const debouncedSearchText = useDebouncedSearchText(state.planArgs);

  // ---- autocomplete ----
  useEffect(() => {
    const suggestions = getAutocompleteSuggestions(debouncedSearchText);
    patch({
      autocompleteSuggestions: suggestions,
      // Only surface the dropdown when there are results and user has typed something
      // (the dropdown is also gated by focus state — see showSuggestions logic below)
    });
  }, [debouncedSearchText, patch]);

  // ---- memoized computations ----
  const smartRecommendation = useMemo(
    () =>
      generateSmartRecommendation(
        state.durationMinutes,
        state.workIntensity,
        state.userEnergy,
      ),
    [state.durationMinutes, state.workIntensity, state.userEnergy],
  );

  const previewPlan = useMemo(
    () =>
      createPlanConfig(seed.planArgs, {
        title: seed.title,
        goal: seed.goal,
        durationMinutes: seed.durationMinutes,
        chunkSizeMinutes: seed.chunkSizeMinutes,
        breakMinutes: seed.breakMinutes,
        includeBreaks: seed.includeBreaks,
        tags: seed.tags,
      }),
    [seed],
  );

  const tasks = useMemo((): Task[] => {
    try {
      return breakDownIntoTasks(
        { title: seed.title, goal: seed.goal, durationMinutes: seed.durationMinutes },
        seed.chunkSizeMinutes,
        seed.breakMinutes,
        seed.includeBreaks,
      );
    } catch (error) {
      logger.error('Failed to break down tasks', error);
      return [];
    }
  }, [seed]);

  // ---- handlers ----
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => patch({ title: e.target.value }),
    [patch],
  );

  const handleGoalChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ goal: e.target.value }),
    [patch],
  );

  const handleDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) patch({ durationMinutes: clamp(v, MIN_PLAN_DURATION_MINUTES, MAX_PLAN_DURATION_MINUTES) });
    },
    [patch],
  );

  const handleChunkSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) patch({ chunkSizeMinutes: clamp(v, MIN_PLAN_DURATION_MINUTES, 60) });
    },
    [patch],
  );

  const handleBreakMinutesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) patch({ breakMinutes: clamp(v, 1, 30) });
    },
    [patch],
  );

  const handlePlanArgsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => patch({ planArgs: e.target.value }),
    [patch],
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      const parsed = parsePlanArguments(suggestion.content);
      patch({
        planArgs: suggestion.content,
        autocompleteSuggestions: [], // dismiss dropdown
        title: parsed.title || state.title,
        goal: parsed.goal || state.goal,
        durationMinutes: parsed.durationMinutes ?? state.durationMinutes,
        chunkSizeMinutes: parsed.chunkSizeMinutes ?? state.chunkSizeMinutes,
        breakMinutes: parsed.breakMinutes ?? state.breakMinutes,
        tags: parsed.tags ?? state.tags,
      });
    },
    [patch, state.title, state.goal, state.durationMinutes, state.chunkSizeMinutes, state.breakMinutes, state.tags],
  );

  const handleSelectPreset = useCallback(
    (preset: PlanPreset) =>
      patch({
        title: preset.title,
        goal: preset.goal,
        durationMinutes: preset.durationMinutes,
        chunkSizeMinutes: preset.chunkSizeMinutes ?? state.chunkSizeMinutes,
        breakMinutes: preset.breakMinutes ?? state.breakMinutes,
        tags: preset.tags ?? state.tags,
        planArgs: preset.name ?? state.planArgs,
      }),
    [patch, state.chunkSizeMinutes, state.breakMinutes, state.tags, state.planArgs],
  );

  // Tag management
  const handleAddTag = useCallback(() => {
    const trimmed = state.tagInput.trim();
    if (trimmed && !state.tags.includes(trimmed)) {
      dispatch({ type: 'addTag', tag: trimmed });
    }
  }, [state.tagInput, state.tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    dispatch({ type: 'removeTag', tag });
  }, []);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  const handleTagInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => patch({ tagInput: e.target.value }),
    [patch],
  );

  // Energy / intensity sliders
  const handleUserEnergyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => patch({ userEnergy: Number(e.target.value) }),
    [patch],
  );
  const handleWorkIntensityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => patch({ workIntensity: Number(e.target.value) }),
    [patch],
  );

  // Recommendations
  const handleApplyRecommendation = useCallback(() => {
    const closest = VALID_CHUNK_PRESETS.reduce((prev, curr) =>
      Math.abs(curr - smartRecommendation.optimalWorkMinutes) <
      Math.abs(prev - smartRecommendation.optimalWorkMinutes)
        ? curr
        : prev,
    );
    patch({
      chunkSizeMinutes: closest,
      breakMinutes: smartRecommendation.optimalBreakMinutes,
      includeBreaks: true,
    });
  }, [smartRecommendation, patch]);

  // Toggle / save
  const handleTogglePreview = useCallback(() => dispatch({ type: 'togglePreview' }), []);

  const handleSaveShortcut = useCallback(() => {
    const shortcutName = window.prompt('Enter shortcut name:', state.title || 'My Plan');
    if (!shortcutName) return;
    const shortcutDesc = window.prompt('Enter description (optional):', state.goal);
    addShortcut(shortcutName, state.planArgs, shortcutDesc || undefined);
    addToast('Shortcut saved successfully!', 'success');
  }, [state.title, state.goal, state.planArgs, addToast]);

  // Create plan
  const handleCreatePlan = useCallback(() => {
    const validation = validatePlanInput(state.title, state.goal);
    const argsValidation = validatePlanArguments(state.planArgs);

    const combined: ValidationState = {
      valid: validation.valid && argsValidation.valid,
      errors: [...validation.errors, ...(argsValidation.errors ?? []).map(String)],
      warnings: [...validation.warnings, ...(argsValidation.warnings ?? []).map(String)],
    };

    patch({ validationResult: combined });
    if (!combined.valid) return;

    patch({ isGenerating: true });
    try {
      logger.info('Creating new plan', {
        title: state.title,
        goal: state.goal,
        durationMinutes: state.durationMinutes,
      });

      const plan = createPlanConfig(state.planArgs, {
        title: state.title,
        goal: state.goal,
        durationMinutes: state.durationMinutes,
        chunkSizeMinutes: state.chunkSizeMinutes,
        breakMinutes: state.breakMinutes,
        includeBreaks: state.includeBreaks,
        tags: state.tags,
      });

      addToPlanHistory(plan);
      addToast('Plan created successfully!', 'success');
      onPlanCreated?.(plan);
    } catch (error) {
      logger.error('Failed to create plan', error);
      const message = error instanceof Error ? error.message : 'Failed to create plan. Please try again.';
      patch({ validationResult: { valid: false, errors: [message], warnings: [] } });
      addToast(message, 'error');
    } finally {
      patch({ isGenerating: false });
    }
  }, [
    state,
    patch,
    onPlanCreated,
    addToast,
  ]);

  // ---- autocomplete focus management ----
  // Calculate if autocomplete dropdown should be visible - all conditions must be met
  const suggestionsVisible =
    state.planArgs.trim().length > 0 && // Ignore whitespace-only input
    state.autocompleteSuggestions.length > 0 && // Only show when there are matching suggestions
    state.showSuggestions; // Only show when input is actively focused

  // ---- render ----
  return (
    <ErrorBoundary>
      <div className="plan-builder" role="form" aria-label="Plan builder form">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="plan-builder-title text-2xl font-bold">Create New Plan</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTogglePreview}
              className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200 transition-colors"
            >
              {state.showPreview ? 'Hide Preview' : 'Show Preview'}
            </button>
            <button
              type="button"
              onClick={handleSaveShortcut}
              className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            >
              Save as Shortcut
            </button>
          </div>
        </div>

        {/* Validation messages */}
        <ValidationMessage items={state.validationResult.errors} variant="error" />
        <ValidationMessage items={state.validationResult.warnings} variant="warning" />

        {/* Quick command input */}
        <div className="mb-6">
          <label htmlFor="plan-args" className="plan-builder-label block mb-2">
            Quick Command
            <span className="text-gray-400 text-xs ml-2">
              (Enter presets like &ldquo;work&rdquo; or &ldquo;study&rdquo; for instant setup)
            </span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              id="plan-args"
              type="text"
              value={state.planArgs}
              onChange={handlePlanArgsChange}
              onFocus={() => patch({ showSuggestions: true })}
              onBlur={() => setTimeout(() => patch({ showSuggestions: false }), 150)}
              className="plan-builder-input w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
              placeholder="work 60 --goal 'Finish project' --tags 'work,urgent'"
              autoComplete="off"
              aria-invalid={!state.validationResult.valid}
              aria-describedby={
                state.validationResult.errors.length > 0 ? 'plan-args-errors' : 'plan-args-help'
              }
            />
            {suggestionsVisible && (
              <div
                id="plan-args-suggestions"
                className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-auto"
                role="listbox"
              >
                {state.autocompleteSuggestions.map((suggestion, idx) => (
                  <SuggestionItem
                    key={`${suggestion.content}-${idx}`}
                    suggestion={suggestion}
                    onClick={handleSelectSuggestion}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <PlanPresets onSelectPreset={handleSelectPreset} />

        {/* Smart recommendation panel */}
        <div className="mb-6 p-4 border-2 border-orange-300 rounded-lg bg-orange-50">
          <h3 className="plan-builder-label font-bold mb-3 text-orange-800">
            Smart Plan Recommendation
          </h3>
          <p className="mb-3 text-orange-700">{smartRecommendation.recommendation}</p>
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">
              Recommended: {smartRecommendation.optimalWorkMinutes} min work /{' '}
              {smartRecommendation.optimalBreakMinutes} min break
            </span>
            <span className="text-sm text-green-700 font-semibold">
              +{smartRecommendation.estimatedProductivityGain}% productivity gain
            </span>
            <button
              type="button"
              onClick={handleApplyRecommendation}
              className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors"
            >
              Apply Recommendation
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="user-energy" className="block text-sm font-medium text-gray-700 mb-1">
                Energy Level: {state.userEnergy}%
              </label>
              <input
                id="user-energy"
                type="range"
                min={1}
                max={100}
                value={state.userEnergy}
                onChange={handleUserEnergyChange}
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="work-intensity" className="block text-sm font-medium text-gray-700 mb-1">
                Work Intensity: {state.workIntensity}%
              </label>
              <input
                id="work-intensity"
                type="range"
                min={1}
                max={100}
                value={state.workIntensity}
                onChange={handleWorkIntensityChange}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Main form grid */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-6">
            {/* Title & Goal */}
            <div className="plan-builder-input-group">
              <div className="plan-builder-input-container mb-4">
                <label htmlFor="plan-title" className="plan-builder-label block mb-1">
                  Plan Title
                </label>
                <input
                  id="plan-title"
                  type="text"
                  value={state.title}
                  onChange={handleTitleChange}
                  className="plan-builder-input w-full"
                  placeholder="Enter plan title..."
                  maxLength={100}
                  aria-describedby="plan-title-help"
                />
                <span id="plan-title-help" className="plan-builder-help text-xs text-gray-500">
                  Max 100 characters
                </span>
              </div>

              <div className="plan-builder-input-container">
                <label htmlFor="plan-goal" className="plan-builder-label block mb-1">
                  Plan Goal
                </label>
                <textarea
                  id="plan-goal"
                  value={state.goal}
                  onChange={handleGoalChange}
                  className="plan-builder-textarea w-full p-2 border rounded"
                  placeholder="What's your goal for this plan?"
                  rows={3}
                  maxLength={500}
                  aria-describedby="plan-goal-help"
                />
                <span id="plan-goal-help" className="plan-builder-help text-xs text-gray-500">
                  Max 500 characters
                </span>
              </div>
            </div>

            {/* Duration & Chunk */}
            <div className="plan-builder-input-group grid grid-cols-2 gap-4">
              <div className="plan-builder-input-container">
                <label htmlFor="plan-duration" className="plan-builder-label block mb-1">
                  Duration (min)
                </label>
                <input
                  id="plan-duration"
                  type="number"
                  value={state.durationMinutes}
                  onChange={handleDurationChange}
                  min={MIN_PLAN_DURATION_MINUTES}
                  max={MAX_PLAN_DURATION_MINUTES}
                  className="plan-builder-input plan-builder-input-number w-full p-2 border rounded"
                />
              </div>

              <div className="plan-builder-input-container">
                <label htmlFor="plan-chunk" className="plan-builder-label block mb-1">
                  Chunk Size (min)
                </label>
                <input
                  id="plan-chunk"
                  type="number"
                  value={state.chunkSizeMinutes}
                  onChange={handleChunkSizeChange}
                  min={MIN_PLAN_DURATION_MINUTES}
                  max={60}
                  className="plan-builder-input plan-builder-input-number w-full p-2 border rounded"
                />
              </div>
            </div>

            {/* Break schedule */}
            <BreakSchedule
              includeBreaks={state.includeBreaks}
              breakMinutes={state.breakMinutes}
              onIncludeBreaksChange={(v) => patch({ includeBreaks: v })}
              onBreakMinutesChange={handleBreakMinutesChange}
            />

            {/* Tags */}
            <div className="plan-builder-tags-container">
              <label className="plan-builder-label block mb-1">Tags</label>
              <div className="plan-builder-tags-input-container flex gap-2 mb-2">
                <input
                  type="text"
                  value={state.tagInput}
                  onChange={handleTagInputChange}
                  onKeyDown={handleTagKeyDown}
                  className="plan-builder-input plan-builder-tag-input flex-1 p-2 border rounded"
                  placeholder="Add a tag and press Enter..."
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="plan-builder-button plan-builder-button-secondary px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  aria-label="Add tag"
                >
                  Add
                </button>
              </div>
              {state.tags.length > 0 && (
                <div
                  className="plan-builder-tags-list flex flex-wrap gap-2"
                  role="list"
                  aria-label="Plan tags"
                >
                  {state.tags.map((tag) => (
                    <TagChip key={tag} tag={tag} onRemove={handleRemoveTag} />
                  ))}
                </div>
              )}
            </div>

            {tasks.length > 0 && <TaskList tasks={tasks} />}
          </div>

          {/* Live preview */}
          {state.showPreview && (
            <div className="border rounded-lg p-4 bg-gray-50">
              <PlanPreview plan={previewPlan} />
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={handleCreatePlan}
            disabled={state.isGenerating}
            className="plan-builder-button plan-builder-button-primary px-8 py-3 text-lg flex items-center gap-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-busy={state.isGenerating}
          >
            {state.isGenerating ? (
              <>
                <LoadingSpinner size="small" />
                Creating Plan...
              </>
            ) : (
              'Create Plan'
            )}
          </button>
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default PlanBuilder;
