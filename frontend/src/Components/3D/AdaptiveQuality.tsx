import { PerformanceMonitor } from '@react-three/drei';
import { useAutoQuality } from './renderQuality';

/**
 * [step down below, step up at or above] frames per second, from the display's measured rate.
 * A browser that caps frames (Low Power Mode or battery saver: about 30 Hz) and keeps up with
 * its cap is not slow.
 */
export const performanceBounds = (refreshRate: number): [number, number] =>
  refreshRate > 100 ? [70, 100] : [Math.min(48, refreshRate * 0.8), Math.min(57, refreshRate * 0.93)];

/**
 * Auto graphics: frames at the display's rate for 2.5 s step up a tier (to the device's
 * ceiling); sustained slow frames step down, and that tier is not tried again this session.
 * Mount it once the world has loaded, so loading hitches don't count.
 */
export default function AdaptiveQuality() {
  const incline = useAutoQuality((s) => s.incline);
  const decline = useAutoQuality((s) => s.decline);
  return <PerformanceMonitor bounds={performanceBounds} onIncline={incline} onDecline={decline} />;
}
