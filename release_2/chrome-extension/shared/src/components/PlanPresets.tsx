import React, { useState, useEffect, useCallback, memo } from 'react';
import { PlanPreset } from '../types';
import { loadPlanPresets } from '../utils/yaml-loader';

interface PlanPresetsProps {
  onSelectPreset: (preset: PlanPreset) => void;
}

const PresetButton = memo(({
  preset,
  onSelect
}: {
  preset: PlanPreset;
  onSelect: (preset: PlanPreset) => void;
}) => (
  <button
    key={preset.name}
    className="plan-preset-button"
    onClick={() => onSelect(preset)}
    aria-label={`Select ${preset.title} preset, ${preset.durationMinutes} minutes, goal: ${preset.goal}`}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(preset);
      }
    }}
  >
    <div className="plan-preset-title">{preset.title}</div>
    <div className="plan-preset-duration">{preset.durationMinutes} minutes</div>
    <div className="plan-preset-goal">{preset.goal}</div>
    {preset.tags && preset.tags.length > 0 && (
      <div className="plan-preset-tags">
        {preset.tags.map(tag => <span key={tag} className="plan-preset-tag">{tag}</span>)}
      </div>
    )}
  </button>
));

PresetButton.displayName = 'PresetButton';

const PlanPresets: React.FC<PlanPresetsProps> = ({ onSelectPreset }) => {
  const [presets, setPresets] = useState<PlanPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const memoizedOnSelect = useCallback((preset: PlanPreset) => onSelectPreset(preset), [onSelectPreset]);

  useEffect(() => {
    const load = () => {
      try {
        const loadedPresets = loadPlanPresets();
        setPresets(loadedPresets);
      } catch (err) {
        console.error('Failed to load plan presets:', err);
        setError(err instanceof Error ? err.message : 'Failed to load presets');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="plan-presets-loading" role="status" aria-live="polite">
        Loading presets...
      </div>
    );
  }

  if (error) {
    return (
      <div className="plan-presets-error" role="alert">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="plan-presets-container" role="region" aria-label="Plan presets">
      <h3>Quick Plan Presets</h3>
      <div className="plan-presets-grid" role="list">
        {presets.map(preset => <PresetButton key={preset.name} preset={preset} onSelect={memoizedOnSelect} />)}
      </div>
    </div>
  );
};

export default memo(PlanPresets);
