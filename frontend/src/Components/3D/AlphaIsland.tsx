import React from 'react';
import GroundPlane from '../../Objects/GroundPlane';

/** Lights and the ground. Trees now come from the server's `tree` table. */
const AlphaIsland = () => (
  <>
    <pointLight position={[10, 30, 0]} intensity={0.5} />
    <hemisphereLight intensity={0.4} />
    <GroundPlane />
  </>
);

export default AlphaIsland;
