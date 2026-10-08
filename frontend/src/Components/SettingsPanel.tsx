import React, { useId } from "react";
import "./menuGuide.css";
import CharacterRecovery from './CharacterRecovery';
import AccountSection from './AccountSection';
import { accountsEnabled } from '../account/accountApi';
import { useSettingsStore, type Settings } from "../spacetime/stores/settingsStore";
import { useHudStore } from "./hudVisibility";

interface Props {
  open: boolean;
  onClose: () => void;
  recoveryEnabled?: boolean;
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

const ROTATE: { value: Settings["cameraRotateButton"]; label: string; hint: string }[] = [
  { value: "right", label: "Right drag", hint: "Right drag turns the camera. Left click moves and acts" },
  { value: "left", label: "Left drag", hint: "Left or right drag turns the camera. Clicks still move and act" },
];

const GRAPHICS: { value: Settings["graphics"]; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Matches your device and adjusts for smoother play" },
  { value: "low", label: "Low", hint: "Fewer pixels, no wildlife · lightest on your device" },
  { value: "medium", label: "Medium", hint: "Balanced picture and speed" },
  { value: "high", label: "High", hint: "Sun shadows and the sharpest picture" },
];

/** Player preferences, bound to settingsStore (saved in this browser only). */
const SettingsPanel = ({ open, onClose, recoveryEnabled = false }: Props) => {
  const s = useSettingsStore();
  const attackHintId = useId();
  const dodgeHintId = useId();
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
        <legend>Controls</legend>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.oneClickAttack} aria-describedby={attackHintId} onChange={(e) => s.set({ oneClickAttack: e.target.checked })} />
          <span>One-click attack</span>
        </label>
        <p className="settings-hint" id={attackHintId}>Click an attackable target to walk up and attack. Hold for options.</p>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.dodgeAssist} aria-describedby={dodgeHintId} onChange={(e) => s.set({ dodgeAssist: e.target.checked })} />
          <span>Dodge assist</span>
        </label>
        <p className="settings-hint" id={dodgeHintId}>In the Sunken Spire, green dots mark the safe tiles for your next step.</p>
      </fieldset>
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
        <div className="settings-segment graphics-tiers" role="radiogroup" aria-label="Graphics quality">
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
          <input type="checkbox" checked={s.showWorldLabels} onChange={(e) => s.set({ showWorldLabels: e.target.checked })} />
          <span>Show world labels</span>
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.showGuidance} onChange={(e) => s.set({ showGuidance: e.target.checked })} />
          <span>Show tips and quest reminders</span>
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={s.reduceMotion} onChange={(e) => s.set({ reduceMotion: e.target.checked })} />
          <span>Reduce motion</span>
        </label>
        <button className="settings-reset" onClick={() => useHudStore.getState().toggle()}>
          Hide interface <kbd>U</kbd>
        </button>
        <p className="settings-hint">For screen recordings. Press U to bring it back.</p>
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
        <div className="settings-segment" role="radiogroup" aria-label="Rotate camera with">
          {ROTATE.map((r) => (
            <button
              key={r.value}
              role="radio"
              aria-checked={s.cameraRotateButton === r.value}
              title={r.hint}
              onClick={() => s.set({ cameraRotateButton: r.value })}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="settings-hint">{ROTATE.find((r) => r.value === s.cameraRotateButton)?.hint}</p>
      </fieldset>
      {accountsEnabled && <AccountSection />}
      {recoveryEnabled && <CharacterRecovery />}
      <button className="settings-reset" onClick={() => s.reset()}>
        Reset to defaults
      </button>
    </section>
  );
};
export default SettingsPanel;
