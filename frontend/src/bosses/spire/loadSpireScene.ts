/**
 * The Spire scene's lazy chunk, loaded once: GameComponent builds its
 * React.lazy from this and SpireLobbyPanel calls it on mount, so the chunk
 * arrives during the lobby, well before the teleport. A failed load is not
 * kept: the next call fetches again.
 */
let scene: Promise<typeof import('./SpireScene')> | null = null;

export function loadSpireScene(importer: () => Promise<typeof import('./SpireScene')> = () => import('./SpireScene')): Promise<typeof import('./SpireScene')> {
  scene ??= importer().catch((error) => { scene = null; throw error; });
  return scene;
}
