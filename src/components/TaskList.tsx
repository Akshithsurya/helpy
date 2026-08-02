import React, { memo } from 'react';
import { Task } from '../types';

interface TaskListProps {
  tasks: Task[];
  onTaskToggle?: (taskId: string) => void;
}

const TaskList: React.FC<TaskListProps> = ({
  tasks,
  onTaskToggle
}) => {
  const completedTasks = tasks.filter(task => task.completed).length;
  const totalTasks = tasks.length;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="task-list" role="region" aria-label="Plan tasks">
      <h3 className="task-list-title">Tasks ({completedTasks}/{totalTasks})</h3>

      {/* Progress Bar */}
      {totalTasks > 0 && (
        <div className="task-list-progress-container" role="progressbar" aria-valuenow={completionPercentage} aria-valuemin={0} aria-valuemax={100}>
          <div className="task-list-progress-bar" style={{ width: `${completionPercentage}%` }} />
        </div>
      )}

      {/* Tasks */}
      <ul className="task-list-items" role="list">
        {tasks.map(({ id, title, durationMinutes, isBreak, completed }) => (
          <li
            key={id}
            className={`task-list-item ${isBreak ? 'task-list-item-break' : ''} ${completed ? 'task-list-item-completed' : ''}`}
            role="listitem"
          >
            <input
              type="checkbox"
              id={`task-${id}`}
              checked={completed}
              onChange={() => onTaskToggle?.(id)}
              className="task-list-checkbox"
              aria-label={`Mark ${title} as ${completed ? 'incomplete' : 'complete'}`}
            />
            <label htmlFor={`task-${id}`} className="task-list-label">
              <span className="task-list-title-text">{title}</span>
              <span className="task-list-duration">{durationMinutes} min</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default memo(TaskList);
