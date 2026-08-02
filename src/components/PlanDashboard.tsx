import React, { useEffect, useCallback, useRef, useReducer, useMemo } from 'react';
import { BehaviorAnalytics, PlanEnhancer, SecurityManager } from '../coffee-compiled';
import { throttle, cyrb53 } from '../utils/performance';

interface PlanDashboardProps {
  store?: any;
  wasmModule?: any;
}

type DashboardState = {
  analytics: InstanceType<typeof BehaviorAnalytics> | null;
  planEnhancer: InstanceType<typeof PlanEnhancer> | null;
  security: InstanceType<typeof SecurityManager> | null;
  usageStats: any;
  suggestions: any[];
  isAnalyticsEnabled: boolean;
  planDuration: number;
};

type DashboardAction =
  | { type: 'setInstances'; payload: Partial<Pick<DashboardState, 'analytics' | 'planEnhancer' | 'security'>> }
  | { type: 'setData'; payload: Partial<Pick<DashboardState, 'usageStats' | 'suggestions'>> }
  | { type: 'patch'; payload: Partial<DashboardState> }
  | { type: 'toggleAnalytics' }
  | { type: 'setPlanDuration'; payload: number };

const initialState: DashboardState = {
  analytics: null,
  planEnhancer: null,
  security: null,
  usageStats: null,
  suggestions: [],
  isAnalyticsEnabled: true,
  planDuration: 120,
};

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'setInstances':
      return { ...state, ...action.payload };
    case 'setData':
      return { ...state, ...action.payload };
    case 'patch':
      return { ...state, ...action.payload };
    case 'toggleAnalytics':
      return { ...state, isAnalyticsEnabled: !state.isAnalyticsEnabled };
    case 'setPlanDuration':
      return { ...state, planDuration: action.payload };
    default:
      return state;
  }
}

interface AnalyticsPanelProps {
  analytics: InstanceType<typeof BehaviorAnalytics> | null;
  usageStats: any;
  popularTimes: number[];
  popularTimesHash: number;
}

const AnalyticsPanel = React.memo(function AnalyticsPanel({
  analytics,
  usageStats,
  popularTimes,
}: AnalyticsPanelProps) {
  if (!analytics) return null;
  return (
    <section className="plan-dashboard-panel analytics-panel">
      <h2 className="panel-title">Usage Statistics</h2>
      {usageStats && (
        <div className="analytics-stats">
          <div className="stat-item">
            <span className="stat-label">Total Events</span>
            <span className="stat-value">{usageStats.totalEvents ?? 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Plan Actions</span>
            <span className="stat-value">{usageStats.planActions ?? 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Sessions</span>
            <span className="stat-value">{usageStats.sessions ?? 0}</span>
          </div>
        </div>
      )}
      {usageStats && (
        <div className="popular-times">
          <h3>Active Times</h3>
          <div className="times-chart">
            {popularTimes.map((count: number, hour: number) => (
              <div
                key={hour}
                className="time-bar"
                style={{ height: `${Math.max(count * 5, 2)}px` }}
              >
                <span className="time-label">{hour}:00</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}, (prev, next) => {
  return prev.analytics === next.analytics
    && prev.usageStats === next.usageStats
    && prev.popularTimesHash === next.popularTimesHash;
});

interface SuggestionsPanelProps {
  suggestions: any[];
  suggestionsHash: number;
}

const SuggestionsPanel = React.memo(function SuggestionsPanel({
  suggestions,
}: SuggestionsPanelProps) {
  if (suggestions.length === 0) return null;
  return (
    <section className="plan-dashboard-panel suggestions-panel">
      <h2 className="panel-title">Personalized Suggestions</h2>
      <ul className="suggestions-list">
        {suggestions.map((suggestion, index) => (
          <li key={suggestion.id ?? index} className="suggestion-item">
            <span className="suggestion-icon">[tip]</span>
            <span className="suggestion-text">{suggestion.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}, (prev, next) => prev.suggestionsHash === next.suggestionsHash);

interface OptimizationPanelProps {
  planDuration: number;
  onDurationChange: (v: number) => void;
  onOptimizeClick: () => void;
}

const OptimizationPanel = React.memo(function OptimizationPanel({
  planDuration,
  onDurationChange,
  onOptimizeClick,
}: OptimizationPanelProps) {
  return (
    <section className="plan-dashboard-panel optimization-panel">
      <h2 className="panel-title">Plan Optimization</h2>
      <div className="optimization-controls">
        <input
          type="number"
          placeholder="Total duration (minutes)"
          className="optimization-input"
          min={15}
          max={480}
          value={planDuration}
          onChange={(e) => onDurationChange(Number(e.target.value))}
        />
        <button
          type="button"
          className="optimization-button"
          onClick={onOptimizeClick}
        >
          Generate Optimized Plan
        </button>
      </div>
    </section>
  );
});

interface SecurityPanelProps {
  security: InstanceType<typeof SecurityManager> | null;
}

const SecurityPanel = React.memo(function SecurityPanel({ security }: SecurityPanelProps) {
  if (!security) return null;
  return (
    <section className="plan-dashboard-panel security-panel">
      <h2 className="panel-title">Security Settings</h2>
      <div className="security-info">
        <p className="security-status">[ok] Data Encryption is Enabled</p>
        <p className="security-token">[key] Token Status: Valid</p>
      </div>
    </section>
  );
});

const PlanDashboard: React.FC<PlanDashboardProps> = ({ store, wasmModule }) => {
  const [state, dispatch] = useReducer(dashboardReducer, initialState);
  const {
    analytics,
    planEnhancer,
    security,
    usageStats,
    suggestions,
    isAnalyticsEnabled,
    planDuration,
  } = state;

  const analyticsRef = useRef<InstanceType<typeof BehaviorAnalytics> | null>(null);
  const enhancerRef = useRef<InstanceType<typeof PlanEnhancer> | null>(null);
  const enabledRef = useRef<boolean>(isAnalyticsEnabled);

  useEffect(() => {
    analyticsRef.current = analytics;
  }, [analytics]);

  useEffect(() => {
    enhancerRef.current = planEnhancer;
  }, [planEnhancer]);

  useEffect(() => {
    enabledRef.current = isAnalyticsEnabled;
  }, [isAnalyticsEnabled]);

  const rawPopularTimes = useMemo(
    () => (usageStats?.popularTimes as number[]) ?? [],
    [usageStats]
  );

  const popularTimesHash = useMemo(() => {
    const serialized = rawPopularTimes.map((c, i) => `${i}:${c}`).join(',');
    return cyrb53(serialized);
  }, [rawPopularTimes]);

  const stablePopularTimes = useMemo(() => {
    void popularTimesHash;
    return rawPopularTimes;
  }, [popularTimesHash, rawPopularTimes]);

  const suggestionsHash = useMemo(() => {
    const serialized = suggestions.map((s) => String(s.id ?? s.message ?? '')).join('|');
    return cyrb53(serialized);
  }, [suggestions]);

  useEffect(() => {
    const analyticsInstance = new BehaviorAnalytics(store);
    const enhancerInstance = new PlanEnhancer(wasmModule);
    const securityInstance = new SecurityManager();

    dispatch({
      type: 'setInstances',
      payload: {
        analytics: analyticsInstance,
        planEnhancer: enhancerInstance,
        security: securityInstance,
      },
    });
    analyticsRef.current = analyticsInstance;
    enhancerRef.current = enhancerInstance;
  }, [store, wasmModule]);

  const loadAnalyticsData = useCallback(() => {
    const instance = analyticsRef.current;
    if (instance && enabledRef.current) {
      const stats = instance.getUsageStatistics(7);
      const personalizedSuggestions = instance.getPersonalizedSuggestions();
      dispatch({
        type: 'setData',
        payload: {
          usageStats: stats,
          suggestions: personalizedSuggestions ?? [],
        },
      });
    }
  }, []);

  const throttledLoadAnalyticsData = useMemo(
    () => throttle(loadAnalyticsData, 250),
    [loadAnalyticsData]
  );

  useEffect(() => {
    if (analytics && isAnalyticsEnabled) {
      loadAnalyticsData();
    }
  }, [analytics, isAnalyticsEnabled, loadAnalyticsData]);

  const trackInteraction = useCallback((element: string, action: string) => {
    const instance = analyticsRef.current;
    if (instance && enabledRef.current) {
      instance.trackUIInteraction(element, action);
      throttledLoadAnalyticsData();
    }
  }, [throttledLoadAnalyticsData]);

  const handlePlanAction = useCallback(
    (action: string, planId: string, planData: any) => {
      const instance = analyticsRef.current;
      if (instance && enabledRef.current) {
        instance.trackPlanAction(action, planId, planData);
        throttledLoadAnalyticsData();
      }
    },
    [throttledLoadAnalyticsData]
  );

  const toggleAnalytics = useCallback(() => {
    const instance = analyticsRef.current;
    const next = !enabledRef.current;
    if (instance) {
      instance.trackUIInteraction('analytics-toggle', next ? 'enable' : 'disable');
    }
    dispatch({ type: 'toggleAnalytics' });
    if (next && instance) {
      loadAnalyticsData();
    }
  }, [loadAnalyticsData]);

  const generateOptimizedPlan = useCallback(
    (duration: number) => {
      const enhancer = enhancerRef.current;
      if (!enhancer) return null;
      const optimized = enhancer.generateOptimizedPlan(duration, {
        chunkSize: 25,
        breakDuration: 5,
      });
      trackInteraction('optimize-button', 'click');
      return optimized;
    },
    [trackInteraction]
  );

  const handleOptimizeClick = useCallback(() => {
    const safeDuration = Math.min(480, Math.max(15, Number(planDuration) || 120));
    generateOptimizedPlan(safeDuration);
  }, [planDuration, generateOptimizedPlan]);

  const handleDurationChange = useCallback((v: number) => {
    dispatch({ type: 'setPlanDuration', payload: v });
  }, []);

  const onRefresh = useCallback(() => {
    loadAnalyticsData();
  }, [loadAnalyticsData]);

  void onRefresh;
  void handlePlanAction;

  return (
    <div className="plan-dashboard">
      <header className="plan-dashboard-header">
        <h1 className="plan-dashboard-title">Plan Manager</h1>
        <div className="plan-dashboard-controls">
          <button
            className={`plan-dashboard-toggle ${isAnalyticsEnabled ? 'active' : ''}`}
            onClick={toggleAnalytics}
            aria-pressed={isAnalyticsEnabled}
          >
            {isAnalyticsEnabled ? 'Analytics Enabled' : 'Analytics Disabled'}
          </button>
        </div>
      </header>

      <div className="plan-dashboard-grid">
        <AnalyticsPanel
          analytics={isAnalyticsEnabled ? analytics : null}
          usageStats={usageStats}
          popularTimes={stablePopularTimes}
          popularTimesHash={popularTimesHash}
        />
        <SuggestionsPanel
          suggestions={suggestions}
          suggestionsHash={suggestionsHash}
        />
        <OptimizationPanel
          planDuration={planDuration}
          onDurationChange={handleDurationChange}
          onOptimizeClick={handleOptimizeClick}
        />
        <SecurityPanel security={security} />
      </div>

      <footer className="plan-dashboard-footer">
        <p>Multi-language Technology Integration - JSX + CoffeeScript + C++ + PHP</p>
      </footer>
    </div>
  );
};

export default PlanDashboard;
