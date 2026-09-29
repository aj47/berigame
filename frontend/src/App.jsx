import React, { Suspense, lazy } from 'react';
import './App.css';
import GameComponent from './Components/3D/GameComponent';
import SpacetimeProvider from './spacetime/SpacetimeProvider';
import GameWebMCPTools from './agent/GameWebMCPTools';
// Only the /agent page needs it: kept out of the game's entry chunk.
const AgentOnboarding = lazy(() => import('./agent/AgentOnboarding'));
import BetaAdmission from './agent/BetaAdmission';
import SocialHud from './Components/SocialHud';

const isAgentEntry = window.location.pathname.replace(/\/+$/, '') === '/agent';
const ignoreWebMCPStatus = () => {};

function App() {
  if (isAgentEntry) return <Suspense fallback={null}><AgentOnboarding /></Suspense>;

  return (
    <BetaAdmission>
      <SpacetimeProvider>
        <GameWebMCPTools onStatusChange={ignoreWebMCPStatus} />
        <GameComponent />
        <SocialHud />
      </SpacetimeProvider>
    </BetaAdmission>
  );
}

export default App;
