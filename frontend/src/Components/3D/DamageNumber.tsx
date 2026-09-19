import { Html } from '@react-three/drei';
import React from 'react';
import { Vector3 } from 'three';
import { EventKind } from '@sim';

interface DamageNumberProps {
  playerPosition: { x: number; y: number; z: number };
  yOffset: number;
  kind: number;
  text: string;
}

const KIND_CLASS: Record<number, string> = {
  [EventKind.Hit]: 'normal-damage',
  [EventKind.Counter]: 'counter-damage',
  [EventKind.Clash]: 'clash',
  [EventKind.Eat]: 'heal',
  [EventKind.Death]: 'death',
  [EventKind.HarvestDone]: 'harvest',
};

const DamageNumber = React.memo<DamageNumberProps>((props) => {
  const position = new Vector3(props.playerPosition.x, props.playerPosition.y + props.yOffset, props.playerPosition.z);
  const randBool = Math.random() < 0.5;
  const className = `damage-number ${KIND_CLASS[props.kind] ?? ''} ${randBool ? 'animation1' : 'animation2'}`;
  return (
    <Html zIndexRange={[6, 4]} prepend center position={position} className={className}>
      {props.text}
    </Html>
  );
});

export default DamageNumber;
