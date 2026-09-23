import React from 'react';
import IslandDetails from './IslandDetails';
import GroundPlane from '../../Objects/GroundPlane';

/** Lights and the ground. Trees now come from the server's `tree` table. */
const AlphaIsland = () => (
  <>
    <color attach="background" args={['#abcbd0']} />
    <fog attach="fog" args={['#abcbd0', 48, 120]} />
    <directionalLight position={[-12, 24, 10]} intensity={0.95} color="#fff0d0" />
    <hemisphereLight args={['#d4edff', '#81704f', 0.65]} />
    <GroundPlane />
    <IslandDetails />
  </>
);

export default AlphaIsland;
