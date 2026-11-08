/**
 * The Drowned Hollow's lazy scene chunk, loaded once (the Spire's loadSpireScene rule): GameComponent builds its
 * React.lazy from this and LanternLobbyPanel calls it on mount. A failed load is not kept.
 */
let scene: Promise<typeof import('./LanternScene')> | null = null;

export function loadLanternScene(importer: () => Promise<typeof import('./LanternScene')> = () => import('./LanternScene')): Promise<typeof import('./LanternScene')> {
  scene ??= importer().catch((error) => { scene = null; throw error; });
  return scene;
}
