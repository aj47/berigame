import type { Material, MeshStandardMaterial } from 'three';

/**
 * Hit flash: the struck avatar's body flashes white, then red, at the blow's
 * impact. Palette materials are shared by every avatar wearing the same
 * colours, so the flash can't touch them: each palette material gets two
 * lazily made variants (same map, same shader program, only the emissive
 * uniform differs), and a flashing avatar's mesh points at a variant for
 * ~200ms. The variants are disposed with their palette material.
 */

/** identity hex -> performance.now() of the latest impact on that avatar. */
const impacts = new Map<string, number>();

export const FLASH_WHITE_MS = 70;
export const FLASH_TOTAL_MS = 210;

/** Dev-only slow motion for captures on software-GL browsers (FxLayer exposes it as window.__berigameFx). */
export const fxDebug = { timeScale: 1 };

export function flashAt(identity: string, at: number): void { impacts.set(identity, at); }

/** 0 none, 1 white, 2 red: which flash stage `identity` shows at `now`. */
export function flashStage(identity: string, now: number): 0 | 1 | 2 {
  const at = impacts.get(identity);
  if (at === undefined) return 0;
  const t = (now - at) / fxDebug.timeScale;
  if (t < 0) return 0;
  if (t < FLASH_WHITE_MS) return 1;
  if (t < FLASH_TOTAL_MS) return 2;
  impacts.delete(identity);
  return 0;
}

export function clearFlashes(): void { impacts.clear(); }

interface Variants { white: MeshStandardMaterial; red: MeshStandardMaterial; }
const variants = new Map<Material, Variants>();

/** The material to show for `stage` on a body whose palette material is `base`. */
export function flashMaterial(base: MeshStandardMaterial, stage: 0 | 1 | 2): MeshStandardMaterial {
  if (stage === 0) return base;
  let v = variants.get(base);
  if (!v) {
    const make = (color: number, intensity: number) => {
      const m = base.clone();
      m.emissive.setHex(color);
      m.emissiveIntensity = intensity;
      m.name = `${base.name || 'palette'}#flash`;
      return m;
    };
    const made: Variants = { white: make(0xffffff, 0.6), red: make(0xff2a18, 0.45) };
    variants.set(base, made);
    const dispose = () => {
      base.removeEventListener('dispose', dispose);
      made.white.dispose(); made.red.dispose();
      variants.delete(base);
    };
    base.addEventListener('dispose', dispose);
    v = made;
  }
  return stage === 1 ? v.white : v.red;
}

/** For tests and the resource verifier. */
export function flashVariantCount(): number { return variants.size; }
