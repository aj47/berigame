import React from 'react';
import BerryTree from './BerryTree';
import GroundPlane from '../../Objects/GroundPlane';

// World configuration types (matching world builder)
interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface WorldObject {
  id: string;
  type: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  properties?: Record<string, any>;
}

interface WorldConfiguration {
  id: string;
  name: string;
  description: string;
  objects: WorldObject[];
  metadata?: any;
}

interface WorldLoaderProps {
  worldConfig?: WorldConfiguration | null;
  fallbackToDefault?: boolean;
}

const WorldLoader: React.FC<WorldLoaderProps> = ({ 
  worldConfig, 
  fallbackToDefault = true 
}) => {
  // If no world config provided, try to load from localStorage
  const loadedWorld = worldConfig || loadDefaultWorld();
  
  // If still no world and fallback is enabled, use hardcoded default
  if (!loadedWorld && fallbackToDefault) {
    return <DefaultWorld />;
  }
  
  if (!loadedWorld) {
    return null;
  }
  
  return (
    <>
      {/* Render lighting from world metadata */}
      {loadedWorld.metadata?.lighting && (
        <>
          <hemisphereLight intensity={loadedWorld.metadata.lighting.ambientIntensity || 0.4} />
          {loadedWorld.metadata.lighting.pointLights?.map((light: any, index: number) => (
            <pointLight 
              key={index}
              position={[light.position.x, light.position.y, light.position.z]} 
              intensity={light.intensity}
              color={light.color}
            />
          ))}
        </>
      )}
      
      {/* Render world objects */}
      {loadedWorld.objects.map(obj => (
        <WorldObjectRenderer key={obj.id} object={obj} />
      ))}
    </>
  );
};

const WorldObjectRenderer: React.FC<{ object: WorldObject }> = ({ object }) => {
  const position: [number, number, number] = [
    object.position.x, 
    object.position.y, 
    object.position.z
  ];
  
  switch (object.type) {
    case 'tree-berry':
      return (
        <BerryTree 
          position={position}
          treeId={object.properties?.treeId || `tree_${object.id}`}
          berryType={object.properties?.berryType || 'blueberry'}
        />
      );
      
    case 'tree-simple':
    case 'tree-evergreen':
      // For now, render as berry trees since that's what we have
      return (
        <BerryTree 
          position={position}
          treeId={`tree_${object.id}`}
          berryType="blueberry"
        />
      );
      
    case 'ground-plane':
      // Ground plane is handled separately in AlphaIsland
      return null;
      
    case 'water-plane':
      // Water plane is handled separately in GroundPlane
      return null;
      
    default:
      console.warn(`Unknown object type: ${object.type}`);
      return null;
  }
};

// Load world configuration from localStorage or other source
const loadDefaultWorld = (): WorldConfiguration | null => {
  try {
    // Try to load the first saved world from world builder
    const savedWorlds = JSON.parse(localStorage.getItem('worldBuilder_savedWorlds') || '[]');
    if (savedWorlds.length > 0) {
      return savedWorlds[0];
    }
    
    // Try to load a specific world marked as "default"
    const defaultWorldId = localStorage.getItem('worldBuilder_defaultWorld');
    if (defaultWorldId) {
      const defaultWorld = savedWorlds.find((w: WorldConfiguration) => w.id === defaultWorldId);
      if (defaultWorld) {
        return defaultWorld;
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to load world configuration:', error);
    return null;
  }
};

// Fallback to the original hardcoded world
const DefaultWorld: React.FC = () => {
  return (
    <>
      <pointLight position={[10, 30, 0]} intensity={0.5} />
      <hemisphereLight intensity={0.4} />
      <GroundPlane />
      
      {/* Original hardcoded trees */}
      <BerryTree position={[5, 0, 0]} treeId="tree_island" berryType="blueberry" />
      <BerryTree position={[-10, 0, -5]} treeId="tree_island_strawberry" berryType="strawberry" />
      <BerryTree position={[0, 0, -10]} treeId="tree_island_greenberry" berryType="greenberry" />
      
      {/* Additional trees from GameComponent */}
      <BerryTree position={[15, 0, 5]} treeId="tree_strawberry" berryType="strawberry" />
      <BerryTree position={[5, 0, 10]} treeId="tree_greenberry" berryType="greenberry" />
      <BerryTree position={[-5, 0, 5]} treeId="tree_goldberry" berryType="goldberry" />
    </>
  );
};

export default WorldLoader;
