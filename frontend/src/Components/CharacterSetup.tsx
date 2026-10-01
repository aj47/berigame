import React, { useRef, useState } from 'react';
import { needsCharacterSetup } from '@sim';
import { useMyPlayer, useAppearanceRows } from '../spacetime/hooks';
import { identityHex } from '../spacetime/identity';
import { useLoadingStore } from '../store';
import AppearancePanel from './AppearancePanel';

/** Completion lives with the character, so reloads and reconnects never repeat setup. */
export default function CharacterSetup() {
  const me = useMyPlayer(), rows = useAppearanceRows();
  const ready = useLoadingStore(s => s.gameDataLoaded && s.websocketConnected);
  const started = useRef<string | null>(null);
  const [finished, setFinished] = useState<string|null>(null);
  if(!me)return null;
  const identity=identityHex(me.identity), appearance=rows.find(row=>identityHex(row.identity)===identity);
  if(ready)started.current=identity;
  if(!ready && started.current!==identity)return null;
  if(finished===identity || !needsCharacterSetup(me.name,appearance))return null;
  return <AppearancePanel open firstVisit onClose={()=>setFinished(identity)}/>;
}
