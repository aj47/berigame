import { Html } from '@react-three/drei';
import React, { useEffect, useState } from 'react';
import { Vector3 } from 'three';
import { EventKind } from '@sim';

interface DamageNumberProps {
  playerPosition: { x: number; y: number; z: number };
  yOffset: number;
  kind: number;
  text: string;
  appearAt?: number;
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
  const remaining = () => Math.max(0, (props.appearAt ?? 0) - performance.now());
  const [visible, setVisible] = useState(() => remaining() === 0);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), remaining());
    return () => window.clearTimeout(timer);
  }, [props.appearAt]);
  const position = new Vector3(props.playerPosition.x, props.playerPosition.y + props.yOffset, props.playerPosition.z);
  const [randBool] = useState(() => Math.random() < 0.5);
  const clash = props.kind === EventKind.Clash;
  const className = clash ? 'combat-impact' : `damage-number ${KIND_CLASS[props.kind] ?? ''} ${randBool ? 'animation1' : 'animation2'}`;
  if (!visible) return null;
  return (
    <Html zIndexRange={[6, 4]} prepend center position={position} className={className}>
      {clash ? <span className="clash-spark" role="img" aria-label="Clash" /> : (
        <span aria-label={props.kind === EventKind.Counter ? `${props.text} counter damage` : undefined}>{props.text}</span>
      )}
    </Html>
  );
});

export default DamageNumber;
