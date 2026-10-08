import React from 'react';
import './App.css';
import GameComponent from './Components/3D/GameComponent';
import SpacetimeProvider from './spacetime/SpacetimeProvider';
import GameWebMCPTools from './agent/GameWebMCPTools';
import BetaAdmission from './agent/BetaAdmission';
import SocialHud from './Components/SocialHud';
import HudToggle from './Components/HudToggle';

const ignoreWebMCPStatus = () => {};
export default function Game() {
  return <BetaAdmission><SpacetimeProvider>
    <GameWebMCPTools onStatusChange={ignoreWebMCPStatus} />
    <GameComponent /><SocialHud /><HudToggle />
  </SpacetimeProvider></BetaAdmission>;
}
