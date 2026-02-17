import React from 'react';
import { getIsTestMode, getTimeOffsetDays, setTimeOffsetDays } from '../compat';
import { notifyStateChange } from '../store';

export function TestModePanel() {
  const isTestMode = getIsTestMode();
  if (!isTestMode) return null;

  const timeOffsetDays = getTimeOffsetDays();

  const advanceDay = () => {
    setTimeOffsetDays(timeOffsetDays + 1);
    notifyStateChange();
  };

  const resetTime = () => {
    setTimeOffsetDays(0);
    notifyStateChange();
  };

  return (
    <div id="testMode" className="test-mode-panel">
      <span id="timeDisplay">Day {timeOffsetDays}</span>
      <button
        id="advanceDay"
        className="test-mode-btn"
        onClick={advanceDay}
        style={{ marginLeft: 8 }}
      >
        +1 day
      </button>
      <button
        id="resetTime"
        className="test-mode-btn"
        onClick={resetTime}
        style={{ marginLeft: 4 }}
      >
        reset
      </button>
    </div>
  );
}
