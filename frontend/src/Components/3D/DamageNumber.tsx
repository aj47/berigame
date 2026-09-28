import { Html } from '@react-three/drei';
import React, { useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { EventKind, isWeapon } from '@sim';

interface DamageNumberProps {
  playerPosition: { x: number; y: number; z: number };
  yOffset: number;
  kind: number;
  text: string;
  /** The event's item: a Hit's weapon ('' = punch), a harvested berry or a found item. */
  itemId?: string;
  appearAt?: number;
}

const KIND_CLASS: Record<number, string> = {
  [EventKind.Hit]: 'normal-damage',
  [EventKind.Eat]: 'heal',
  [EventKind.Death]: 'death',
  [EventKind.HarvestDone]: 'harvest',
  [EventKind.ItemFound]: 'item-found',
};

const kindClass = (kind: number, itemId?: string) =>
  kind === EventKind.Hit && itemId && isWeapon(itemId) ? 'stick-damage' : KIND_CLASS[kind] ?? '';

const DamageNumber = React.memo<DamageNumberProps>((props) => {
  const remaining = () => Math.max(0, (props.appearAt ?? 0) - performance.now());
  const [visible, setVisible] = useState(() => remaining() === 0);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), remaining());
    return () => window.clearTimeout(timer);
  }, [props.appearAt]);
  const position = new Vector3(props.playerPosition.x, props.playerPosition.y + props.yOffset, props.playerPosition.z);
  const [randBool] = useState(() => Math.random() < 0.5);
  if (!visible) return null;
  return (
    <Html zIndexRange={[6, 4]} prepend center position={position} className={`damage-number ${kindClass(props.kind, props.itemId)} ${randBool ? 'animation1' : 'animation2'}`}>
      <span>{props.text}</span>
    </Html>
  );
});

export default DamageNumber;
