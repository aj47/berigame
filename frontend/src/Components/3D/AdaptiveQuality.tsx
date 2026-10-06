import { PerformanceMonitor } from '@react-three/drei';
import { useAutoQuality, useGraphicsTier } from './renderQuality';

/** [step down below, step up at or above] frames per second, for the display's refresh rate. */
const bounds = (refreshRate: number): [number, number] => refreshRate > 100 ? [70, 100] : [48, 57];

/**
 * Auto graphics: frames at the display's rate for 2.5 s step up a tier (to the device's
 * ceiling); sustained slow frames step down (renderQuality.ts declineTier). Each tier is
 * measured afresh: the monitor restarts on a tier change, so a shader-compile hitch from
 * the switch doesn't count and the refresh rate is re-learned (drei keeps the highest rate
 * it has seen, which goes stale when a window moves from a 120 Hz to a 60 Hz display).
 * Mount it once the world has loaded, so loading hitches don't count either.
 */
export default function AdaptiveQuality() {
  const incline = useAutoQuality((s) => s.incline);
  const decline = useAutoQuality((s) => s.decline);
  const tier = useGraphicsTier();
  return <PerformanceMonitor key={tier} bounds={bounds} onIncline={incline} onDecline={decline} />;
}
