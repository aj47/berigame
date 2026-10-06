import { create } from 'zustand';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';

/** What the renderer spends per frame, lightest first. */
export type GraphicsTier = 'low' | 'medium' | 'high';
export const TIERS: readonly GraphicsTier[] = ['low', 'medium', 'high'];

export interface QualityProfile {
  /** Canvas pixel ratio: fixed, or [min, max] of the screen's own. */
  dpr: number | [number, number];
  /** Real-time sun shadows (<SunShadow />). Without them avatars keep only their blob decals. */
  shadows: boolean;
  /** Birds, crabs and floating motes (AmbientLife). */
  ambientLife: boolean;
}

export const QUALITY: Record<GraphicsTier, QualityProfile> = {
  low: { dpr: 0.75, shadows: false, ambientLife: false },
  medium: { dpr: [1, 1.5], shadows: false, ambientLife: true },
  high: { dpr: [1, 2], shadows: true, ambientLife: true },
};

export interface DeviceInfo {
  /** WebGL renderer string (unmasked where the browser allows it). */
  gpu: string;
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory in GiB (Chromium only, capped at 8). */
  memory?: number;
  /** A phone or tablet: coarse primary pointer and a small screen. */
  mobile: boolean;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;
const STRONG = /nvidia|geforce|quadro|radeon (?:rx|pro)|\bapple m\d|intel.*\barc\b/i;

/** Budget phone GPUs: older Mali, Adreno below the 620 class, PowerVR, VideoCore. */
function weakMobileGpu(gpu: string): boolean {
  if (/powervr|sgx|videocore|mali-(?:[2-4]\d\d|t\d)/i.test(gpu)) return true;
  if (/mali-g(?:31|51|52|57)\b/i.test(gpu)) return true;
  const adreno = /adreno\D*(\d{3})/i.exec(gpu);
  return !!adreno && Number(adreno[1]) < 620;
}

/**
 * Where Auto starts on this device and the highest tier it may climb to. Phones stay at
 * medium (battery and heat); desktops with a known strong GPU start high; other desktops
 * start medium and climb when frames keep up.
 */
export function deviceTiers(info: DeviceInfo): { start: GraphicsTier; ceiling: GraphicsTier } {
  if (SOFTWARE.test(info.gpu)) return { start: 'low', ceiling: 'low' };
  if ((info.memory ?? 8) <= 2 || (info.cores ?? 8) <= 2 || weakMobileGpu(info.gpu)) return { start: 'low', ceiling: 'medium' };
  if (info.mobile) return { start: 'medium', ceiling: 'medium' };
  if (STRONG.test(info.gpu)) return { start: 'high', ceiling: 'high' };
  return { start: 'medium', ceiling: 'high' };
}

/** This browser's GPU and device, read once from a throwaway WebGL context. */
export function readDeviceInfo(): DeviceInfo {
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // Unknown GPU: the medium defaults below.
  }
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number };
  let mobile = false;
  try {
    mobile = !!window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  } catch {
    // No media queries (tests): a desktop.
  }
  return { gpu, cores: nav?.hardwareConcurrency, memory: nav?.deviceMemory, mobile };
}

export interface AutoQuality {
  tier: GraphicsTier;
  /** Highest tier Auto may still try: lowered for good when a tier it climbed to proves too slow. */
  ceiling: GraphicsTier;
  /** The current tier was reached by stepping up (not the device's start, nor a step down). */
  climbed?: boolean;
}

const rank = (tier: GraphicsTier) => TIERS.indexOf(tier);

/** Frames keep up with the display: try one tier up, up to the ceiling. */
export function inclineTier(auto: AutoQuality): AutoQuality {
  const i = rank(auto.tier);
  return i < rank(auto.ceiling) ? { tier: TIERS[i + 1], ceiling: auto.ceiling, climbed: true } : auto;
}

/**
 * Frames fall short: drop a tier. A tier Auto climbed to and then could not hold is not
 * tried again this session. Other drops (a slow start, a frame cap from battery saving,
 * a window moved to a slower display) leave the way back up open.
 */
export function declineTier(auto: AutoQuality): AutoQuality {
  const i = rank(auto.tier);
  if (i === 0) return auto;
  return { tier: TIERS[i - 1], ceiling: auto.climbed ? TIERS[i - 1] : auto.ceiling, climbed: false };
}

let deviceStart: AutoQuality | null = null;
/** Auto's starting point, from the device (probed once, on first use). */
function startingAuto(): AutoQuality {
  if (!deviceStart) {
    const { start, ceiling } = deviceTiers(readDeviceInfo());
    deviceStart = { tier: start, ceiling, climbed: false };
  }
  return deviceStart;
}

/** Auto's state for this session, shared by the world canvases (null: still at the device's start). */
export const useAutoQuality = create<{ auto: AutoQuality | null; incline: () => void; decline: () => void }>((set, get) => ({
  auto: null,
  incline: () => set({ auto: inclineTier(get().auto ?? startingAuto()) }),
  decline: () => set({ auto: declineTier(get().auto ?? startingAuto()) }),
}));

/** The tier the world renders at: the player's choice, or Auto's current pick. */
export function useGraphicsTier(): GraphicsTier {
  const graphics = useSettingsStore((s) => s.graphics);
  const auto = useAutoQuality((s) => s.auto);
  if (graphics !== 'auto') return graphics;
  return (auto ?? startingAuto()).tier;
}
