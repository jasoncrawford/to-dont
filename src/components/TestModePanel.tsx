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
    <div id="testMode" style={{ display: 'block', position: 'fixed', top: 20, right: 20, fontSize: 13, color: '#999' }}>
      <span id="timeDisplay">Day {timeOffsetDays}</span>
      <button
        id="advanceDay"
        onClick={advanceDay}
        style={{ marginLeft: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid #ddd', background: 'white', borderRadius: 4 }}
      >
        +1 day
      </button>
      <button
        id="resetTime"
        onClick={resetTime}
        style={{ marginLeft: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer', border: '1px solid #ddd', background: 'white', borderRadius: 4 }}
      >
        reset
      </button>
    </div>
  );
}
