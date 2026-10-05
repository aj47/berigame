import { PerformanceMonitor } from '@react-three/drei';
import { useAutoQuality } from './renderQuality';

/** [step down below, step up at or above] frames per second, for the display's refresh rate. */
const bounds = (refreshRate: number): [number, number] => refreshRate > 100 ? [70, 100] : [48, 57];

/**
 * Auto graphics: frames at the display's rate for 2.5 s step up a tier (to the device's
 * ceiling); sustained slow frames step down, and that tier is not tried again this session.
 */
export default function AdaptiveQuality() {
  const incline = useAutoQuality((s) => s.incline);
  const decline = useAutoQuality((s) => s.decline);
  return <PerformanceMonitor bounds={bounds} onIncline={incline} onDecline={decline} />;
}
