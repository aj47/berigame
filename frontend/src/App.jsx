import React from 'react';
import './App.css';
import GameComponent from './Components/3D/GameComponent';
import SpacetimeProvider from './spacetime/SpacetimeProvider';
import GameWebMCPTools from './agent/GameWebMCPTools';
import AgentOnboarding from './agent/AgentOnboarding';
import BetaAdmission from './agent/BetaAdmission';

const isAgentEntry = window.location.pathname.replace(/\/+$/, '') === '/agent';
const ignoreWebMCPStatus = () => {};

function App() {
  if (isAgentEntry) return <AgentOnboarding />;

  return (
    <BetaAdmission>
      <SpacetimeProvider>
        <GameWebMCPTools onStatusChange={ignoreWebMCPStatus} />
        <GameComponent />
      </SpacetimeProvider>
    </BetaAdmission>
  );
}

export default App;
