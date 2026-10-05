import { useEffect, useRef } from 'react';
import { tileKey } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useMyPlayer, useWorldBlocked } from '../spacetime/hooks';
import { useFrontier } from './useFrontier';
import { useToastStore } from '../spacetime/stores/toastStore';
import { useUserInputStore } from '../store';
import { avatarGroup } from '../animation/avatarRegistry';
import { homeDestination, homePath, homePoint, isHomeRegion, isHomeTarget } from '../../../shared/sim/frontier/homeMap';
import { distance, regionalPath, regionLand } from '../../../shared/sim/frontier/regions';
import { type Location, type Point, type RegionId } from '../../../shared/sim/frontier/catalog';
import { PLAYER_ACTION, WORLD_INTERACTION, type WorldInteraction } from './worldInteraction';
import { buildingBlocker } from '../../../shared/sim/frontier/building';
import { meadowBlockedTiles } from '../Components/3D/hoverTarget';

type Pending = WorldInteraction & { destination: Location; identity: string; started: number; accepted: boolean; acceptedAt?: number; observed: boolean; arrived?: number };

export default function WorldInteractionController({ disabled = false }: { disabled?: boolean }) {
  const me = useMyPlayer(), actions = useGameActions(), frontier = useFrontier(), blocked = useWorldBlocked();
  const current = useRef({ me, actions, frontier, blocked, disabled });
  current.current = { me, actions, frontier, blocked, disabled };
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    const cancel = () => { pending.current = null; };
    const begin = (event: Event) => {
      cancel();
      const { me, actions, frontier, blocked, disabled } = current.current;
      if (!me || !me.hp || disabled) return;
      const request = (event as CustomEvent<WorldInteraction>).detail;
      const region = (me.region || 'bramblewild') as RegionId;
      const target = request.location;
      const home = isHomeRegion(region) && isHomeRegion(target.region);
      if (region !== target.region && !home) return;
      useUserInputStore.getState().setClickedOtherObject(null);
      const avatar = avatarGroup(me.identity.toHexString());
      const worldTarget = home ? homePoint(target, target.region) : target;
      const visuallyNear = !avatar || Math.max(Math.abs(avatar.position.x + 25 - worldTarget.x), Math.abs(avatar.position.z + 25 - worldTarget.z)) <= request.radius;
      if (region === target.region && distance(me, target) <= request.radius && me.targetX === undefined && visuallyNear) {
        request.perform();
        return;
      }
      const district = home ? 'settlement' : region;
      const buildings = buildingBlocker(meadowBlockedTiles(frontier, me, me.identity.toHexString(), district));
      const solid = Object.assign((p: Location) => p.region === 'bramblewild' ? blocked.has(tileKey(p))
        : buildings(p) || frontier.resources.some(n => n.region === p.region && n.x === p.x && n.z === p.z), {
        crosses: (a: Location, b: Location) => a.region === district && b.region === district && buildings.crosses(a, b),
      });
      const regionalObstacles = Object.assign((point: Point) => solid({ ...point, region }), {
        crosses: (a: Point, b: Point) => solid.crosses({ ...a, region }, { ...b, region }),
      });
      const from = home ? homePoint(me, region) : me;
      const candidates: Location[] = [];
      const reach = Math.ceil(request.radius);
      for (let x = -reach; x <= reach; x++) for (let z = -reach; z <= reach; z++) {
        if (!x && !z) continue;
        const p = { region: target.region, x: Math.round(target.x) + x, z: Math.round(target.z) + z };
        if (distance(p, target) <= request.radius && regionLand(p.region, p) && !solid(p)) candidates.push(p);
      }
      candidates.sort((a, b) => distance(a, target) - distance(b, target) || distance(from, home ? homePoint(a, a.region) : a) - distance(from, home ? homePoint(b, b.region) : b));
      const destination = candidates.find(p => home ? homePath(from, homePoint(p, p.region), solid)
        : regionalPath(region, me, p, regionalObstacles));
      if (!destination) { useToastStore.getState().show('No clear route to this spot'); return; }
      // Actions synchronously cancel any older intent. Install this one afterwards.
      const call = region === 'bramblewild' && destination.region === 'bramblewild'
        ? actions.setTarget(destination.x, destination.z)
        : home && frontier.enabled
          ? actions.frontier({ action: 'walk', id: destination.region, x: destination.x, z: destination.z })
          : actions.frontier({ action: 'move', x: destination.x, z: destination.z });
      const intent: Pending = { ...request, destination, identity: me.identity.toHexString(), started: performance.now(), accepted: false, observed: false };
      pending.current = intent;
      void call.then(ok => { if (pending.current === intent) { if (!ok) cancel(); else { intent.accepted = true; intent.acceptedAt = performance.now(); } } });
    };
    const tick = () => {
      const p = pending.current;
      if (!p) return;
      const { me, disabled } = current.current;
      if (!me || !me.hp || disabled || me.identity.toHexString() !== p.identity || performance.now() - p.started > 90000) return cancel();
      if (!p.accepted) return;
      const region = (me.region || 'bramblewild') as RegionId;
      const home = isHomeRegion(region) && isHomeRegion(p.destination.region);
      if (region !== p.destination.region && !home) return cancel();
      const wanted = home ? homePoint(p.destination, p.destination.region) : p.destination;
      const here = home ? homePoint(me, region) : me;
      const target: Point | undefined = me.targetX === undefined ? undefined : { x: me.targetX, z: me.targetZ! };
      const destination = target && (isHomeTarget(target) ? homeDestination(target) : home ? homePoint(target, region) : target);
      if (destination && distance(destination, wanted) === 0) p.observed = true;
      // Wait for the subscription to acknowledge the walk before detecting retargets.
      if (p.observed && destination && distance(destination, wanted) > 0) return cancel();
      if (!p.observed && performance.now() - p.acceptedAt! > 1800 && (!destination || distance(destination, wanted) > 0)) return cancel();
      if (distance(here, wanted) > 0) {
        if (p.observed && !destination) cancel();
        return;
      }
      p.arrived ??= performance.now();
      const visual = avatarGroup(p.identity);
      const visibleArrival = visual ? Math.hypot(visual.position.x + 25 - wanted.x, visual.position.z + 25 - wanted.z) < .2
        : performance.now() - p.arrived >= 650;
      if (!visibleArrival) return;
      cancel();
      p.perform();
    };
    // A pointer press may become a camera drag. Only committed game actions
    // replace the approach; inspecting the view or typing must not discard it.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener(WORLD_INTERACTION, begin);
    window.addEventListener(PLAYER_ACTION, cancel);
    window.addEventListener('keydown', onKey);
    const timer = window.setInterval(tick, 50);
    return () => {
      cancel(); clearInterval(timer);
      window.removeEventListener(WORLD_INTERACTION, begin);
      window.removeEventListener(PLAYER_ACTION, cancel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
