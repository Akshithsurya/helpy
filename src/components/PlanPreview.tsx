import React, { useMemo, memo } from 'react';
import { FocusPlan, Task } from '../types';
import { calculateSessionStats } from '../../chrome-extension/shared/plan-command';

// --- Icons ---
const BaseIcon: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = 'w-4 h-4', children }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    {children}
  </svg>
);

const ClockIcon = () => (
  <BaseIcon>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12,6 12,12 16,14" />
  </BaseIcon>
);

const GridIcon = () => (
  <BaseIcon>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </BaseIcon>
);

const BreakIcon: React.FC<{ className?: string }> = ({ className }) => (
  <BaseIcon className={className || "w-6 h-6"}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </BaseIcon>
);

const TaskIcon = () => (
  <BaseIcon className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </BaseIcon>
);

const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const EmptyStateIcon = () => (
  <BaseIcon className="w-12 h-12" >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth={1.5} />
  </BaseIcon>
);

// --- Utilities ---
const formatDuration = (minutes: number): string => {
  if (!minutes || minutes <= 0) return '0 minutes';
  if (minutes < 60) return `${minutes} minutes`;
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const getStatusClasses = (completed: boolean, isBreak: boolean): string => {
  if (isBreak) return 'bg-amber-50 border-amber-200 text-amber-800';
  if (completed) return 'bg-green-50 border-green-200 text-green-800';
  return 'bg-blue-50 border-blue-200 text-blue-800';
};

// --- Sub-components ---
const PlanHeader = memo<{ plan: FocusPlan }>(({ plan }) => (
  <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
    <h3 className="text-xl font-bold mb-2 tracking-tight">{plan.title}</h3>
    {plan.goal && <p className="text-blue-100 text-sm mb-4 leading-relaxed">{plan.goal}</p>}
    
    <div className="flex flex-wrap gap-4 text-sm text-blue-50">
      <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-md backdrop-blur-sm">
        <ClockIcon />
        <span className="font-medium">{formatDuration(plan.durationMinutes)}</span>
      </div>
      
      {plan.chunkSizeMinutes && (
        <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-md backdrop-blur-sm">
          <GridIcon />
          <span>Work blocks: {plan.chunkSizeMinutes}m</span>
        </div>
      )}
      
      {plan.breakMinutes && (
        <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-md backdrop-blur-sm">
          <BreakIcon className="w-4 h-4" />
          <span>Breaks: {plan.breakMinutes}m</span>
        </div>
      )}
    </div>

    {plan.tags && plan.tags.length > 0 && (
      <div className="mt-4 flex flex-wrap gap-2">
        {plan.tags.map((tag, idx) => (
          <span 
            key={`${tag}-${idx}`} 
            className="px-2.5 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-semibold tracking-wide"
          >
            #{tag}
          </span>
        ))}
      </div>
    )}
  </div>
));
PlanHeader.displayName = 'PlanHeader';

const StatItem = memo<{ value: string | number; label: string; color: string }>(({ value, label, color }) => (
  <div className="flex flex-col items-center p-2 rounded-lg hover:bg-gray-100 transition-colors duration-200">
    <div className={`text-2xl font-extrabold ${color} tabular-nums`}>{value}</div>
    <div className="text-xs text-gray-500 mt-1 font-medium">{label}</div>
  </div>
));
StatItem.displayName = 'StatItem';

const PlanStats = memo<{ stats: ReturnType<typeof calculateSessionStats> }>(({ stats }) => (
  <div className="bg-gray-50/80 p-4 border-b border-gray-100">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <StatItem value={stats.totalTasks} label="Total tasks" color="text-blue-600" />
      <StatItem value={stats.tasksCompleted} label="Completed" color="text-green-600" />
      <StatItem value={`${stats.completionPercentage}%`} label="Completion" color="text-purple-600" />
      <StatItem value={formatDuration(stats.totalFocusMinutes)} label="Focus time" color="text-orange-600" />
    </div>
  </div>
));
PlanStats.displayName = 'PlanStats';

const PlanTimeline = memo<{ tasks: Task[] | undefined }>(({ tasks }) => {
  const safeTasks = tasks || [];

  if (safeTasks.length === 0) {
    return (
      <div className="p-10 text-center text-gray-400 flex flex-col items-center gap-3">
        <div className="text-4xl opacity-50">
          <EmptyStateIcon />
        </div>
        <p className="text-sm font-medium">No tasks scheduled yet, start planning your focus time!</p>
      </div>
    );
  }

  return (
    <div className="p-5 bg-white">
      <h4 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-4 bg-blue-500 rounded-full"></span>
        Task timeline
      </h4>
      <div 
        className="relative pl-4 space-y-3 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200"
        role="list"
      >
        {safeTasks.map((task) => (
          <div
            key={task.id}
            className={`relative flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${getStatusClasses(task.completed, Boolean(task.isBreak))}`}
            role="listitem"
          >
            <span className="absolute -left-[21px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white bg-gray-300 shadow-sm" />
            
            <span className="text-xl shrink-0 flex items-center justify-center" aria-hidden="true">
              {task.isBreak ? <BreakIcon /> : <TaskIcon />}
            </span>
            
            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-sm truncate ${task.completed ? 'line-through opacity-60' : ''}`}>
                {task.title}
              </div>
              <div className="text-xs opacity-75 mt-0.5 font-medium">
                {formatDuration(task.durationMinutes)}
              </div>
            </div>
            
            {task.completed && (
              <span className="text-green-600 shrink-0" aria-label="Completed">
                <CheckCircleIcon />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
PlanTimeline.displayName = 'PlanTimeline';

const PlanFooter = memo<{ createdAt: string }>(({ createdAt }) => (
  <div className="bg-gray-50 px-4 py-3 border-t border-gray-100">
    <div className="text-xs text-gray-400 text-center font-medium flex items-center justify-center gap-1.5">
      <ClockIcon />
      Created at {createdAt}
    </div>
  </div>
));
PlanFooter.displayName = 'PlanFooter';

// --- Main Component ---
interface PlanPreviewProps {
  plan: FocusPlan;
  className?: string;
}

const PlanPreview: React.FC<PlanPreviewProps> = ({ plan, className = '' }) => {
  const stats = useMemo(() => calculateSessionStats(plan), [plan]);

  const createdAt = useMemo(() => {
    if (!plan.createdAt) return 'Unknown time';
    
    const date = new Date(plan.createdAt);
    if (isNaN(date.getTime())) return 'Unknown time';
    
    return date.toLocaleString('en-US', { 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit' 
    });
  }, [plan.createdAt]);

  return (
    <article 
      className={`plan-preview flex flex-col rounded-2xl shadow-xl shadow-gray-200/50 overflow-hidden bg-white border border-gray-100 ${className}`}
      aria-label={`Focus plan: ${plan.title}`}
    >
      <PlanHeader plan={plan} />
      <PlanStats stats={stats} />
      <PlanTimeline tasks={plan.tasks} />
      <PlanFooter createdAt={createdAt} />
    </article>
  );
};

export default memo(PlanPreview);
