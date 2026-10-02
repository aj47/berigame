import { useMemo } from "react";
import {
  useFrontierObjects,
  useFrontierViews,
  useMyIdentityHex,
  useTick,
} from "../spacetime/hooks";
import { frontierSnapshot } from "../../../shared/sim/frontier/snapshot";
export function useFrontier() {
  const objects = useFrontierObjects(),
    views = useFrontierViews(),
    id = useMyIdentityHex(),
    tick = useTick();
  return useMemo(
    () => frontierSnapshot(objects, views, id ?? "", Date.now()),
    [objects, views, id, tick],
  );
}
