/**
 * The Spire scene's lazy chunk, loaded once: GameComponent builds its
 * React.lazy from this and SpireLobbyPanel calls it on mount, so the chunk
 * arrives during the lobby, well before the teleport.
 */
let scene: Promise<typeof import('./SpireScene')> | null = null;

export function loadSpireScene(): Promise<typeof import('./SpireScene')> {
  scene ??= import('./SpireScene');
  return scene;
}
