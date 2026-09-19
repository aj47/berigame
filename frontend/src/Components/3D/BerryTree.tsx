import React, { useEffect, useMemo, useRef } from 'react';
import { Html, useGLTF } from '@react-three/drei';
import { HARVEST_TICKS, TICK_MS, getItemDef, tileToWorld } from '@sim';
import type { Player, Tree } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useLoadingStore, useUserInputStore } from '../../store';

const MODEL_URL = '/tree.glb';

interface Props {
  tree: Tree;
  tick: number;
  harvester: Player | null;
}

const BerryTree = ({ tree, tick, harvester }: Props) => {
  const objRef = useRef<any>(null);
  const { scene } = useGLTF(MODEL_URL) as any;
  const copiedScene = useMemo(() => scene.clone(), [scene]);
  const addLoadedAsset = useLoadingStore((s) => s.addLoadedAsset);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);
  const { startHarvest } = useGameActions();
  const def = getItemDef(tree.itemId);
  const [wx, wy, wz] = tileToWorld(tree);

  useEffect(() => {
    addLoadedAsset('tree.glb');
  }, [addLoadedAsset]);

  const regrowTicks = Math.max(0, tree.cooldownUntilTick - tick);
  const busy = tree.harvester !== undefined;
  const progress = harvester && harvester.harvestEndTick > 0
    ? Math.min(1, Math.max(0, 1 - (harvester.harvestEndTick - tick) / HARVEST_TICKS))
    : 0;

  let label = `Harvest ${def?.name ?? 'berries'}`;
  let disabled = false;
  if (busy) { label = `${harvester?.name ?? 'Someone'} is harvesting`; disabled = true; }
  else if (regrowTicks > 0) { label = `Regrowing (${Math.ceil((regrowTicks * TICK_MS) / 1000)}s)`; disabled = true; }

  const onClick = (e: any) => {
    e.stopPropagation();
    setClickedOtherObject({
      connectionId: def?.name ?? 'Tree',
      e,
      dropdownOptions: [
        { label, disabled, onClick: () => { if (!disabled) startHarvest(tree.id); setClickedOtherObject(null); } },
      ],
    });
  };

  return (
    <group position={[wx, wy, wz]}>
      <primitive ref={objRef} object={copiedScene} onClick={onClick} />
      {busy && (
        <Html position={[0, 3, 0]} center>
          <div className="harvest-progress ui-element">
            <div>{harvester?.name ?? 'Harvesting'}: {def?.name}</div>
            <div className="harvest-bar"><div className="harvest-fill" style={{ width: `${progress * 100}%`, background: def?.color }} /></div>
          </div>
        </Html>
      )}
      {!busy && regrowTicks > 0 && (
        <Html position={[0, 3, 0]} center>
          <div className="harvest-progress ui-element dim">Regrowing {Math.ceil((regrowTicks * TICK_MS) / 1000)}s</div>
        </Html>
      )}
    </group>
  );
};

useGLTF.preload(MODEL_URL);

export default BerryTree;
