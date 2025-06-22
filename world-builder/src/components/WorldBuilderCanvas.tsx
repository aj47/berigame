import React, { Suspense, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, useGLTF } from '@react-three/drei';
import { useWorldBuilderStore } from '../store/worldBuilderStore';
import { WorldObject } from '../types/WorldTypes';
import * as THREE from 'three';

const WorldBuilderCanvas: React.FC = () => {
  const { 
    currentWorld, 
    showGrid, 
    isPreviewMode,
    selectedObjectId,
    selectObject,
    addObject 
  } = useWorldBuilderStore();

  const handleCanvasClick = (event: any) => {
    if (isPreviewMode) return;
    
    // If clicking on empty space, deselect
    if (event.object.name === 'ground-plane') {
      selectObject(null);
    }
  };

  const handleGroundClick = (event: any) => {
    if (isPreviewMode) return;
    
    event.stopPropagation();
    const point = event.point;
    selectObject(null);
  };

  return (
    <Canvas
      camera={{ position: [10, 10, 10], fov: 60 }}
      style={{ background: 'linear-gradient(to bottom, #87CEEB 0%, #98FB98 100%)' }}
      onClick={handleCanvasClick}
    >
      <Suspense fallback={null}>
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 30, 0]} intensity={0.5} />
        <hemisphereLight intensity={0.3} />

        {/* Controls */}
        <OrbitControls 
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          target={[0, 0, 0]}
        />

        {/* Grid */}
        {showGrid && !isPreviewMode && (
          <Grid 
            args={[50, 50]} 
            position={[0, 0.01, 0]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#666"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#888"
          />
        )}

        {/* Ground plane for clicking */}
        <mesh
          name="ground-plane"
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          onClick={handleGroundClick}
          visible={false}
        >
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>

        {/* World objects */}
        {currentWorld?.objects.map(obj => (
          <WorldObjectRenderer 
            key={obj.id} 
            object={obj}
            isSelected={selectedObjectId === obj.id}
            isPreviewMode={isPreviewMode}
          />
        ))}
      </Suspense>
    </Canvas>
  );
};

interface WorldObjectRendererProps {
  object: WorldObject;
  isSelected: boolean;
  isPreviewMode: boolean;
}

const WorldObjectRenderer: React.FC<WorldObjectRendererProps> = ({ 
  object, 
  isSelected, 
  isPreviewMode 
}) => {
  const { selectObject, updateObject } = useWorldBuilderStore();
  const meshRef = useRef<THREE.Group>(null);

  const handleClick = (event: any) => {
    if (isPreviewMode) return;
    
    event.stopPropagation();
    selectObject(object.id);
  };

  const handleDrag = (event: any) => {
    if (isPreviewMode || !isSelected) return;
    
    const newPosition = {
      x: event.object.position.x,
      y: object.position.y, // Keep Y position fixed for now
      z: event.object.position.z
    };
    
    updateObject(object.id, { position: newPosition });
  };

  return (
    <group
      ref={meshRef}
      position={[object.position.x, object.position.y, object.position.z]}
      rotation={[object.rotation.x, object.rotation.y, object.rotation.z]}
      scale={[object.scale.x, object.scale.y, object.scale.z]}
      onClick={handleClick}
    >
      {/* Selection indicator */}
      {isSelected && !isPreviewMode && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[2, 0.1, 2]} />
          <meshBasicMaterial color="#4CAF50" transparent opacity={0.3} />
        </mesh>
      )}
      
      {/* Render the actual object */}
      <ObjectMesh object={object} />
    </group>
  );
};

const ObjectMesh: React.FC<{ object: WorldObject }> = ({ object }) => {
  switch (object.type) {
    case 'tree-simple':
      return <TreeModel modelPath="/tree-simple.glb" />;
    case 'tree-evergreen':
      return <TreeModel modelPath="/tree-evergreen.glb" />;
    case 'tree-berry':
      return <TreeModel modelPath="/tree.glb" />;
    case 'ground-plane':
      return <GroundPlane />;
    case 'water-plane':
      return <WaterPlane />;
    default:
      return <DefaultObject />;
  }
};

const TreeModel: React.FC<{ modelPath: string }> = ({ modelPath }) => {
  try {
    const { scene } = useGLTF(modelPath);
    const clonedScene = scene.clone();
    return <primitive object={clonedScene} />;
  } catch (error) {
    console.warn(`Failed to load model: ${modelPath}`, error);
    return <DefaultObject />;
  }
};

const GroundPlane: React.FC = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[50, 50]} />
      <meshLambertMaterial color="#fff1a1" side={THREE.DoubleSide} />
    </mesh>
  );
};

const WaterPlane: React.FC = () => {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
      <planeGeometry args={[500, 500]} />
      <meshLambertMaterial color="#006994" side={THREE.DoubleSide} transparent opacity={0.8} />
    </mesh>
  );
};

const DefaultObject: React.FC = () => {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color="#ff6b6b" />
    </mesh>
  );
};

export default WorldBuilderCanvas;
