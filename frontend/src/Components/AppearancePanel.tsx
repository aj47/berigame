import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  HAIR_STYLES, SKIN_TONES, HAIR_COLORS, ROBE_COLORS, WRAP_COLORS,
  BODY_TYPES, FACE_SHAPES, EYE_COLORS, FACIAL_HAIR, OUTFIT_STYLES,
  TROUSER_COLORS, BOOT_COLORS, ACCESSORIES, ACCESSORY_COLORS,
  CHARACTER_PRESETS, APPEARANCE_KEYS, APPEARANCE_LIMITS, normalizeAppearance,
  COSMETICS, CosmeticSlot, hasCosmetic, NAME_MIN_LEN, NAME_MAX_LEN, type CharacterAppearance,
} from '@sim';
import { useAppearancePreview } from '../appearance/store';
import { useAppearanceRows, useMyCosmetics, useMyIdentityHex, useMyPlayer } from '../spacetime/hooks';
import { useGameActions } from '../spacetime/actions';
import { identityHex } from '../spacetime/identity';
import { useToastStore } from '../spacetime/stores/toastStore';
import CharacterPreview from './CharacterPreview';
import './characterCreator.css';

interface Props { open: boolean; onClose: () => void; onSkills?: () => void; firstVisit?: boolean; }
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
      <legend>Keepsakes <span>looks only</span></legend>
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
                {have ? c.name : <><span aria-hidden="true">◇ </span>{c.name}<span className="sr-only"> · Locked</span></>}
              </button>
            );
          })}
        </div>
      ))}
      <details className="keepsake-guide"><summary>How to earn keepsakes</summary>
        <dl>{COSMETICS.filter(c => !hasCosmetic(unlocked, c.id)).map(c => <div key={c.key}><dt>{c.name}</dt><dd>{c.how}</dd></div>)}</dl>
        {COSMETICS.every(c => hasCosmetic(unlocked, c.id)) && <p>You’ve collected them all!</p>}
      </details>
    </fieldset>
  );
};

const TABS = ['Start', 'Face', 'Hair', 'Outfit', 'Details'] as const;
type Tab = typeof TABS[number];

export default function AppearancePanel({ open, onClose, firstVisit = false }: Props) {
  const identity = useMyIdentityHex(), me = useMyPlayer();
  const cosmetics = useMyCosmetics();
  const rows = useAppearanceRows();
  const saved = normalizeAppearance(rows.find(row => identityHex(row.identity) === identity));
  const savedKey = JSON.stringify(saved);
  const { draft, setDraft } = useAppearancePreview();
  const { saveCharacter } = useGameActions();
  const [name, setName] = useState(''), [tab, setTab] = useState<Tab>('Start');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const wasOpen = useRef(false), session = useRef(0), dialog = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if(open && !wasOpen.current) {
      session.current++; setDraft(saved); setName(firstVisit ? '' : me?.name ?? '');
      setTab('Start'); setPending(false); setError('');
    } else if(!open && wasOpen.current) { session.current++; setDraft(null); }
    wasOpen.current = open;
  }, [open, savedKey, me?.name, firstVisit, setDraft]);
  useEffect(() => () => { session.current++; setDraft(null); }, [setDraft]);
  useEffect(() => {
    if(!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // Keep connection recovery controls usable above the editor.
    const background = Array.from(document.querySelectorAll<HTMLElement>('.ui-group, #three-canvas, .emote-wheel, .death-panel'));
    const newlyInert = background.filter(element => !element.hasAttribute('inert'));
    newlyInert.forEach(element => element.setAttribute('inert', ''));
    document.body.classList.add('character-creator-open');
    nameInput.current?.focus();
    return () => {
      newlyInert.forEach(element => element.removeAttribute('inert'));
      document.body.classList.remove('character-creator-open');
      previous?.focus();
    };
  }, [open]);
  if(!open) return null;
  const value = normalizeAppearance(draft ?? saved);
  const changed = APPEARANCE_KEYS.some(key => value[key] !== saved[key]) || name.trim() !== me?.name;
  const nameError = name.trim().length < NAME_MIN_LEN || name.trim().length > NAME_MAX_LEN
    ? `Use ${NAME_MIN_LEN}–${NAME_MAX_LEN} characters.`
    : !/^[A-Za-z0-9_ ]+$/.test(name.trim()) ? 'Use letters, numbers, spaces or underscores.' : '';
  const select = (key: keyof CharacterAppearance, index: number) => { setDraft({...value,[key]:index});setError(''); };
  const cancel = () => { if(pending || firstVisit)return; setDraft(null); onClose(); };
  const save = async () => {
    if(pending || nameError || (!firstVisit && !changed))return;
    const currentSession = session.current; setPending(true); setError('');
    const success = await saveCharacter(name.trim(), value);
    if(session.current !== currentSession)return;
    setPending(false);
    if(success){setDraft(null);onClose();}
    else setError(useToastStore.getState().message || 'Could not save. Your choices are still here; try again.');
  };
  const choices = (label:string,key:keyof CharacterAppearance,options:readonly {name:string}[]) => <fieldset className="creator-field"><legend>{label}</legend><div className="creator-options">{options.map((option,index)=><button type="button" key={option.name} disabled={pending} aria-pressed={value[key]===index} onClick={()=>select(key,index)}>{option.name}</button>)}</div></fieldset>;
  const swatches = (label:string,key:keyof CharacterAppearance,options:readonly {name:string;color:string}[]) => <fieldset className="creator-field"><legend>{label}<span>{options[value[key]]?.name}</span></legend><div className="creator-swatches">{options.map((option,index)=><button type="button" key={option.name} disabled={pending} aria-label={`${label}: ${option.name}`} title={option.name} aria-pressed={value[key]===index} onClick={()=>select(key,index)} style={{'--swatch':option.color} as React.CSSProperties}><span>{value[key]===index?'✓':''}</span></button>)}</div></fieldset>;
  const onKey = (e:React.KeyboardEvent) => {
    if(e.key==='Escape'){e.stopPropagation();cancel();}
    if(e.key==='Tab') {
      const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')??[]).filter(el=>el.getClientRects().length);
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  };
  return createPortal(<div className="creator-backdrop" data-character-creator>
    <div className="character-creator" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="creator-title" onKeyDown={onKey}>
      <header className="creator-header"><div><h1 id="creator-title">{firstVisit?'Your story starts here.':'Your character'}</h1>{firstVisit&&<p>Choose your name and look.</p>}</div>{!firstVisit&&<button className="creator-close" disabled={pending} onClick={cancel} aria-label="Close character creator">×</button>}</header>
      <div className="creator-body">
        <CharacterPreview appearance={value} name={name} head={cosmetics?.head ?? 0} neck={cosmetics?.neck ?? 0} focusFace={['Face','Hair','Details'].includes(tab)}/>
        <div className="creator-editor">
          <div className="creator-tabs" role="tablist" aria-label="Character categories">{TABS.map((item,index)=><button key={item} id={`creator-tab-${item}`} role="tab" aria-selected={tab===item} aria-controls="creator-options" tabIndex={tab===item?0:-1} onClick={()=>setTab(item)} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=TABS[(index+(e.key==='ArrowRight'?1:4))%5];setTab(next);document.getElementById(`creator-tab-${next}`)?.focus();}}}>{item}</button>)}</div>
          <div id="creator-options" className="creator-options-scroll" role="tabpanel" aria-labelledby={`creator-tab-${tab}`} tabIndex={0} key={tab}>
            {tab==='Start'&&<>
              <label className="creator-name" htmlFor="character-name">What should we call you?</label>
              <div className="creator-name-input"><input ref={nameInput} id="character-name" value={name} maxLength={NAME_MAX_LEN} placeholder="Your adventurer’s name" autoComplete="off" spellCheck={false} disabled={pending} aria-describedby="character-name-hint" aria-invalid={Boolean(name&&nameError)} onChange={e=>{setName(e.target.value);setError('');}}/><span>{name.length}/{NAME_MAX_LEN}</span></div>
              <p id="character-name-hint" className="creator-hint">{name&&nameError?nameError:'Visible to everyone · Change it anytime'}</p>
              <div className="creator-section-heading"><h2>Starter looks</h2></div>
              <div className="creator-presets">{CHARACTER_PRESETS.map(preset=><button type="button" key={preset.name} title={preset.description} disabled={pending} onClick={()=>{setDraft(normalizeAppearance(preset.choices));setError('');}}><span className="creator-preset-colors" aria-hidden="true">{[ROBE_COLORS[normalizeAppearance(preset.choices).robeColor].color,HAIR_COLORS[normalizeAppearance(preset.choices).hairColor].color,SKIN_TONES[normalizeAppearance(preset.choices).skinTone].color].map((color,i)=><i key={i} style={{background:color}}/>)}</span><strong>{preset.name}</strong></button>)}</div>
              <div className="creator-start-actions"><button type="button" disabled={pending} onClick={()=>setDraft(Object.fromEntries(APPEARANCE_KEYS.map(key=>[key,Math.floor(Math.random()*APPEARANCE_LIMITS[key])])) as CharacterAppearance)}>Surprise me ↻</button><button type="button" onClick={()=>setTab('Face')}>Customize every detail →</button></div>
            </>}
            {tab==='Face'&&<>{choices('Build','bodyType',BODY_TYPES)}{choices('Face shape','faceShape',FACE_SHAPES)}{swatches('Skin tone','skinTone',SKIN_TONES)}{swatches('Eyes','eyeColor',EYE_COLORS)}</>}
            {tab==='Hair'&&<>{choices('Hair style','hairStyle',HAIR_STYLES)}{swatches('Hair color','hairColor',HAIR_COLORS)}{choices('Facial hair','facialHair',FACIAL_HAIR)}</>}
            {tab==='Outfit'&&<>{choices('Outfit','outfitStyle',OUTFIT_STYLES)}{swatches('Robe','robeColor',ROBE_COLORS)}{swatches('Wraps','wrapColor',WRAP_COLORS)}{swatches('Trousers','trouserColor',TROUSER_COLORS)}{swatches('Boots','bootColor',BOOT_COLORS)}</>}
            {tab==='Details'&&<>{choices('Accessory','accessory',ACCESSORIES)}{swatches('Accessory color','accessoryColor',ACCESSORY_COLORS)}{!firstVisit&&<Keepsakes/>}</>}
          </div>
        </div>
      </div>
      <footer className="creator-footer">
        <div>{error?<p className="creator-error" role="alert">{error}</p>:nameError?<p>Choose your name in Start to continue.</p>:null}</div>
        <div className="creator-footer-actions">{!firstVisit&&<button disabled={pending} onClick={cancel}>Cancel</button>}<button className="creator-save" disabled={pending||Boolean(nameError)||(!firstVisit&&!changed)} onClick={()=>void save()}>{pending?'Saving…':firstVisit?'Enter the island →':'Save character'}</button></div>
      </footer>
    </div>
  </div>,document.body);
}
