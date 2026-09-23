import React, { useEffect, useRef, useState } from "react";
import {
  DEFAULT_APPEARANCE,
  HAIR_STYLES,
  SKIN_TONES,
  HAIR_COLORS,
  ROBE_COLORS,
  WRAP_COLORS,
  type Appearance,
} from "@sim";
import { useAppearancePreview } from "../appearance/store";
import { useAppearanceRows, useMyIdentityHex } from "../spacetime/hooks";
import { useGameActions } from "../spacetime/actions";
import { identityHex } from '../spacetime/identity';

interface Props {
  open: boolean;
  onClose: () => void;
}
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

const AppearancePanel = ({ open, onClose }: Props) => {
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
