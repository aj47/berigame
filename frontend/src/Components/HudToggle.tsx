import { useEffect } from 'react';
import { isTyping } from './keyboard';
import { HUD_TOGGLE_KEY, useHudStore } from './hudVisibility';
import './hud.css';

/** Listens for the hide-HUD key; the rest happens in hud.css. */
export default function HudToggle() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === HUD_TOGGLE_KEY) { e.preventDefault(); useHudStore.getState().toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); useHudStore.setState({ hidden: false }); };
  }, []);
  return null;
}
