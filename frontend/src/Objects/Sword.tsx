import React from "react";

interface SwordProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/**
 * Sword Component - Placeholder rectangular primitive for sword representation
 * 
 * This is a temporary placeholder using a simple box geometry to represent a sword.
 * Future versions will replace this with proper 3D sword models.
 * 
 * Dimensions are chosen to look sword-like:
 * - Width: 0.1 (thin blade)
 * - Height: 2.0 (sword length)
 * - Depth: 0.05 (blade thickness)
 */
const Sword: React.FC<SwordProps> = ({ 
  position = [0, 0, 0], 
  rotation = [0, 0, 10],
  scale = [50, 50, 50]
}) => {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      {/* Sword blade - rectangular box geometry */}
      <boxGeometry args={[0.1, 2.0, 0.05]} />
      {/* Simple metallic-looking material */}
      <meshStandardMaterial 
        color="#C0C0C0" 
        metalness={0.8} 
        roughness={0.2} 
      />
    </mesh>
  );
};

export default Sword;
