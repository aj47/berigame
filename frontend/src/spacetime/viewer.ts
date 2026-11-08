import { create } from 'zustand';
import { parseWatchParams, type WatchParams } from '../watch/watchParams';

/*
 * The spectator's seat. On /watch the connection is a read-only pass with no character (docs/SPECTATOR.md), and the
 * game's "you" is whoever the camera is on: the `subject`. Everything that reads your row (the camera, the scene for
 * your region, the Spire's instancing, what counts as visible) then works unchanged for a watched player.
 */
export const WATCH_PARAMS: WatchParams | null = typeof window !== 'undefined' && /^\/watch\/?$/.test(window.location.pathname)
  ? parseWatchParams(window.location.search) : null;
export const WATCHING = WATCH_PARAMS !== null;

/** The watched character's identity hex; null until there is one. Unused outside /watch. */
export const useViewerStore = create<{ subject: string | null }>(() => ({ subject: null }));
export const viewerSubject = () => useViewerStore.getState().subject;
export const setViewerSubject = (subject: string | null) => {
  if (viewerSubject() !== subject) useViewerStore.setState({ subject });
};

export interface WatchPass { token: string; uri: string; database: string; expiresAt: string }
let pass: WatchPass | null = null;
let renewPass: () => void = () => {};
/** The pass for the next connection. A live connection keeps going when this changes. */
export const watchPass = () => pass;
export const setWatchPass = (next: WatchPass) => { pass = next; };
/** Who gets a new pass once the server refuses this one. */
export const onWatchPassExpired = (renew: () => void) => { renewPass = renew; };
export const watchPassExpired = () => renewPass();
