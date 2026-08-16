import React, { memo } from 'react';

interface BreakScheduleProps {
  includeBreaks: boolean;
  breakMinutes: number;
  onIncludeBreaksChange: (include: boolean) => void;
  onBreakMinutesChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const BreakSchedule: React.FC<BreakScheduleProps> = ({
  includeBreaks,
  breakMinutes,
  onIncludeBreaksChange,
  onBreakMinutesChange
}) => (
  <div className="break-schedule" role="region" aria-label="Break schedule">
    <div className="break-schedule-toggle">
      <input
        type="checkbox"
        id="include-breaks"
        checked={includeBreaks}
        onChange={(e) => onIncludeBreaksChange(e.target.checked)}
        className="break-schedule-checkbox"
        aria-describedby="include-breaks-label"
      />
      <label id="include-breaks-label" htmlFor="include-breaks" className="break-schedule-label">
        Include Breaks
      </label>
    </div>

    {includeBreaks && (
      <div className="break-schedule-details">
        <label htmlFor="break-minutes" className="break-schedule-label">
          Break Duration (minutes)
        </label>
        <input
          id="break-minutes"
          type="number"
          value={breakMinutes}
          onChange={onBreakMinutesChange}
          min={1}
          max={30}
          className="break-schedule-input"
        />
      </div>
    )}
  </div>
);

export default memo(BreakSchedule);
