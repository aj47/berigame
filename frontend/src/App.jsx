import React from 'react';
import './App.css';
import GameComponent from './Components/3D/GameComponent';
import SpacetimeProvider from './spacetime/SpacetimeProvider';

function App() {
  return (
    <SpacetimeProvider>
      <GameComponent />
    </SpacetimeProvider>
  );
}

export default App;
