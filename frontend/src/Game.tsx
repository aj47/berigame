import React from 'react';
import './App.css';
import GameComponent from './Components/3D/GameComponent';
import SpacetimeProvider from './spacetime/SpacetimeProvider';
import GameWebMCPTools from './agent/GameWebMCPTools';
import BetaAdmission from './agent/BetaAdmission';
import SocialHud from './Components/SocialHud';

const ignoreWebMCPStatus = () => {};
export default function Game() {
  return <BetaAdmission><SpacetimeProvider>
    <GameWebMCPTools onStatusChange={ignoreWebMCPStatus} />
    <GameComponent /><SocialHud />
  </SpacetimeProvider></BetaAdmission>;
}
