import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Group } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdventureModel } from '../Components/3D/AdventureModels';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

const mock = vi.hoisted(() => ({ scene: null as any, model: null as any, frame: null as any }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: any) => { mock.frame = frame; } }));
vi.mock('@react-three/drei', () => ({ useGLTF: () => ({ scene: mock.scene, animations: [] }), Html: () => null }));
vi.mock('three/examples/jsm/utils/SkeletonUtils', () => ({ clone: (scene: Group) => mock.model = scene.clone() }));

const parts = ['GiantBody', 'GiantHead', 'GiantArmL', 'GiantArmR', 'GiantLegL', 'GiantLegR'];
const pose = () => parts.flatMap(name => {
  const part = mock.model.getObjectByName(name);
  return [...part.position.toArray(), ...part.rotation.toArray()];
});
beforeEach(() => {
  mock.scene = new Group();
  for (const name of parts) { const part = new Group(); part.name = name; mock.scene.add(part); }
  useSettingsStore.getState().set({ reduceMotion: false });
});
afterEach(() => { cleanup(); useSettingsStore.getState().reset(); });

describe('Berry Giant celebration', () => {
  it('raises both arms and gently waves after a feast', () => {
    render(<AdventureModel asset="berry-giant" mood="happy" />);
    mock.frame({}, .1);
    const first = pose();
    expect(mock.model.getObjectByName('GiantArmL').rotation.z).toBeGreaterThan(1.7);
    expect(mock.model.getObjectByName('GiantArmR').rotation.z).toBeLessThan(-1.7);
    mock.frame({}, .1);
    expect(pose()).not.toEqual(first);
  });

  it('keeps the happy pose still when reduced motion is enabled', () => {
    useSettingsStore.getState().set({ reduceMotion: true });
    render(<AdventureModel asset="berry-giant" mood="happy" />);
    mock.frame({}, .1);
    const first = pose();
    mock.frame({}, .1);
    expect(pose()).toEqual(first);
    expect(mock.model.getObjectByName('GiantArmL').rotation.z).toBe(1.9);
    expect(mock.model.getObjectByName('GiantArmR').rotation.z).toBe(-1.9);
  });
});
