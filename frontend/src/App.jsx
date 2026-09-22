import React from 'react';
import './App.css';
import GameComponent from './Components/3D/GameComponent';
import SpacetimeProvider from './spacetime/SpacetimeProvider';
import GameWebMCPTools from './agent/GameWebMCPTools';
import AgentOnboarding from './agent/AgentOnboarding';

const isAgentEntry = window.location.pathname.replace(/\/+$/, '') === '/agent';
const ignoreWebMCPStatus = () => {};

function App() {
  if (isAgentEntry) return <AgentOnboarding />;

  return (
    <SpacetimeProvider>
      <GameWebMCPTools onStatusChange={ignoreWebMCPStatus} />
      <GameComponent />
    </SpacetimeProvider>
  );
}

export default App;
