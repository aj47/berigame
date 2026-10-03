import React from 'react';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

/** Shared by the island tutorial and settlement quest reminder. */
export default function HideGuidanceButton() {
  const set = useSettingsStore(s => s.set);
  return <button type="button" className="guidance-dismiss" aria-label="Hide tips and quest reminders"
    title="Hide tips · turn them back on in Settings"
    onClick={event => { event.stopPropagation(); set({ showGuidance: false }); }}>×</button>;
}
