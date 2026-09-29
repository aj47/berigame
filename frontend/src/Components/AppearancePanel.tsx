import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_APPEARANCE,
  HAIR_STYLES,
  SKIN_TONES,
  HAIR_COLORS,
  ROBE_COLORS,
  WRAP_COLORS,
  COSMETICS,
  CosmeticSlot,
  hasCosmetic,
  type Appearance,
} from "@sim";
import { useAppearancePreview } from "../appearance/store";
import { useAppearanceRows, useMyCosmetics, useMyIdentityHex } from "../spacetime/hooks";
import { useGameActions } from "../spacetime/actions";
import { identityHex } from '../spacetime/identity';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Switch to the Skills panel (the two share a tab bar). */
  onSkills?: () => void;
}

const SLOT_NAMES = ["Head", "Neck"] as const;

/**
 * Milestone keepsakes: earned ones can be worn or taken off at once (a
 * server write, not part of the style draft); locked ones say how to earn them.
 */
const Keepsakes = () => {
  const row = useMyCosmetics();
  const { wearCosmetic } = useGameActions();
  const [busy, setBusy] = useState(false);
  const unlocked = row?.unlocked ?? 0;
  const worn = [row?.head ?? 0, row?.neck ?? 0];
  const wear = async (slot: number, value: number) => {
    if (busy) return;
    setBusy(true);
    try { await wearCosmetic(slot, value); } finally { setBusy(false); }
  };
  return (
    <fieldset className="appearance-field keepsakes">
      <legend>Keepsakes <span>earned on your travels · looks only</span></legend>
      {[CosmeticSlot.Head, CosmeticSlot.Neck].map((slot) => (
        <div className="keepsake-row" key={slot}>
          <span className="keepsake-slot">{SLOT_NAMES[slot]}</span>
          <button type="button" className="keepsake" aria-pressed={worn[slot] === 0} disabled={busy} onClick={() => void wear(slot, 0)}>None</button>
          {COSMETICS.filter((c) => c.slot === slot).map((c) => {
            const have = hasCosmetic(unlocked, c.id);
            return (
              <button
                type="button"
                key={c.key}
                data-cosmetic={c.key}
                className={`keepsake ${have ? "" : "locked"}`}
                aria-pressed={worn[slot] === c.id + 1}
                disabled={busy || !have}
                title={have ? c.name : `Locked: ${c.how}`}
                onClick={() => void wear(slot, c.id + 1)}
              >
                {have ? c.name : <><small>Locked</small> {c.how}</>}
              </button>
            );
          })}
        </div>
      ))}
    </fieldset>
  );
};
const keys = [
  "hairStyle",
  "skinTone",
  "hairColor",
  "robeColor",
  "wrapColor",
] as const;
const choicesFrom = (row?: Partial<Appearance>): Appearance =>
  Object.fromEntries(
    keys.map((key) => [key, row?.[key] ?? DEFAULT_APPEARANCE[key]]),
  ) as unknown as Appearance;

const AppearancePanel = ({ open, onClose, onSkills }: Props) => {
  const identity = useMyIdentityHex();
  const rows = useAppearanceRows();
  const saved = choicesFrom(
    rows.find((row) => identityHex(row.identity) === identity),
  );
  const { draft, setDraft } = useAppearancePreview();
  const { setAppearance } = useGameActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const wasOpen = useRef(false);
  const session = useRef(0);

  useEffect(() => {
    if (open && !wasOpen.current) {
      session.current++;
      setDraft(saved);
      setError("");
      setPending(false);
    } else if (!open && wasOpen.current) {
      session.current++;
      setDraft(null);
    }
    wasOpen.current = open;
  }, [
    open,
    saved.hairStyle,
    saved.skinTone,
    saved.hairColor,
    saved.robeColor,
    saved.wrapColor,
    setDraft,
  ]);
  useEffect(() => () => setDraft(null), [setDraft]);
  if (!open) return null;
  const value = draft ?? saved;
  const changed = keys.some((key) => value[key] !== saved[key]);
  const select = (key: keyof Appearance, index: number) => {
    setDraft({ ...value, [key]: index });
    setError("");
  };
  const cancel = () => {
    setDraft(null);
    onClose();
  };
  const save = async () => {
    if (!changed || pending) return;
    const currentSession = session.current;
    const requested = { ...value };
    setPending(true);
    const success = await setAppearance(requested);
    if (session.current !== currentSession) return;
    setPending(false);
    if (success) {
      setDraft(null);
      onClose();
    } else setError("Could not save. Your preview is still here; try again.");
  };

  const swatches = (
    label: string,
    key: keyof Appearance,
    options: readonly { name: string; color: string }[],
  ) => (
    <fieldset className="appearance-field">
      <legend>
        {label} <span>{options[value[key]]?.name}</span>
      </legend>
      <div className="appearance-swatches">
        {options.map((option, index) => (
          <button
            type="button"
            key={option.name}
            className="appearance-swatch"
            aria-label={`${label}: ${option.name}`}
            aria-pressed={value[key] === index}
            disabled={pending}
            onClick={() => select(key, index)}
            title={option.name}
          >
            <span
              className="swatch-color"
              style={{ backgroundColor: option.color }}
              aria-hidden="true"
            />
            {value[key] === index && (
              <span className="swatch-check" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <section
      className="game-panel appearance-panel"
      aria-label="Character style"
    >
      <header className="panel-heading">
        <div>
          <span className="eyebrow">Make it yours</span>
          <h2>Character style</h2>
        </div>
        <button
          className="close-button"
          disabled={pending}
          onClick={cancel}
          aria-label="Close character style"
        >
          ×
        </button>
      </header>
      {onSkills && (
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected="false" disabled={pending} onClick={() => { setDraft(null); onSkills(); }}>Skills</button>
          <button role="tab" aria-selected="true">Style</button>
        </div>
      )}
      <p className="appearance-intro">
        Preview on your adventurer. New look, same abilities.
      </p>
      <div className="appearance-choices">
        <fieldset className="appearance-field">
          <legend>Hair style</legend>
          <div className="hair-style-options">
            {HAIR_STYLES.map((style, index) => (
              <button
                type="button"
                key={style.id}
                disabled={pending}
                aria-pressed={value.hairStyle === index}
                onClick={() => select("hairStyle", index)}
              >
                {style.name}
              </button>
            ))}
          </div>
        </fieldset>
        {swatches("Skin tone", "skinTone", SKIN_TONES)}
        {swatches("Hair color", "hairColor", HAIR_COLORS)}
        {swatches("Robe", "robeColor", ROBE_COLORS)}
        {swatches("Wraps", "wrapColor", WRAP_COLORS)}
        <Keepsakes />
      </div>
      <footer className="appearance-footer">
        {error && (
          <p className="appearance-error" role="alert">
            {error}
          </p>
        )}
        <div className="appearance-actions">
          <button disabled={pending} onClick={cancel}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={pending || !changed}
            onClick={() => void save()}
          >
            {pending ? "Saving…" : "Save style"}
          </button>
        </div>
        <span className="appearance-save-hint">
          {changed
            ? "Only you see this preview until you save."
            : "Everyone starts with the same abilities."}
        </span>
      </footer>
    </section>
  );
};
export default AppearancePanel;
