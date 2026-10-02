import React, { useId } from "react";
import { useSettingsStore, type Settings } from "../spacetime/stores/settingsStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="settings-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

const GRAPHICS: { value: Settings["graphics"]; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Lowers resolution while frames are slow" },
  { value: "high", label: "High", hint: "Sharpest, uses your screen's full density" },
  { value: "low", label: "Low", hint: "Fewer pixels for older phones" },
];

/** Player preferences, bound to settingsStore (saved in this browser only). */
const SettingsPanel = ({ open, onClose }: Props) => {
  const s = useSettingsStore();
  if (!open) return null;
  return (
    <section className="game-panel settings-panel" aria-label="Settings">
      <header className="panel-heading">
        <div>
          <h2 title="Saved on this device">Settings</h2>
        </div>
        <button className="close-button" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </header>
      <fieldset className="settings-group">
        <legend>Sound</legend>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.muted} onChange={(e) => s.set({ muted: e.target.checked })} />
          <span>Mute all sound</span>
        </label>
        <Slider label="Master" value={s.masterVolume} min={0} max={1} step={0.05} format={pct} disabled={s.muted} onChange={(v) => s.set({ masterVolume: v })} />
        <Slider label="Effects" value={s.sfxVolume} min={0} max={1} step={0.05} format={pct} disabled={s.muted} onChange={(v) => s.set({ sfxVolume: v })} />
        <Slider label="Ambient" value={s.ambientVolume} min={0} max={1} step={0.05} format={pct} disabled={s.muted} onChange={(v) => s.set({ ambientVolume: v })} />
      </fieldset>
      <fieldset className="settings-group">
        <legend>Graphics</legend>
        <div className="settings-segment" role="radiogroup" aria-label="Graphics quality">
          {GRAPHICS.map((g) => (
            <button
              key={g.value}
              role="radio"
              aria-checked={s.graphics === g.value}
              title={g.hint}
              onClick={() => s.set({ graphics: g.value })}
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="settings-hint">{GRAPHICS.find((g) => g.value === s.graphics)?.hint}</p>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.showNameplates} onChange={(e) => s.set({ showNameplates: e.target.checked })} />
          <span>Show name plates</span>
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.reduceMotion} onChange={(e) => s.set({ reduceMotion: e.target.checked })} />
          <span>Reduce motion</span>
        </label>
      </fieldset>
      <fieldset className="settings-group">
        <legend>Camera</legend>
        <Slider
          label="Sensitivity"
          value={s.cameraSensitivity}
          min={0.5}
          max={2}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => s.set({ cameraSensitivity: v })}
        />
      </fieldset>
      <button className="settings-reset" onClick={() => s.reset()}>
        Reset to defaults
      </button>
    </section>
  );
};
export default SettingsPanel;
