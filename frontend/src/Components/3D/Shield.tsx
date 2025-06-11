import React, { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshBasicMaterial, SphereGeometry } from "three";

interface ShieldProps {
  radius?: number;
  color?: string;
  opacity?: number;
}

const Shield: React.FC<ShieldProps> = ({ 
  radius = 2.5, 
  color = "#00aaff", 
  opacity = 0.25 
}) => {
  const meshRef = useRef<any>();
  
  // Create geometry and material
  const geometry = useMemo(() => new SphereGeometry(radius, 32, 16), [radius]);
  const material = useMemo(() => new MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: opacity,
    side: 2, // DoubleSide to render both inside and outside
  }), [color, opacity]);

  // Add subtle pulsing animation
  useFrame((state) => {
    if (meshRef.current) {
      const time = state.clock.getElapsedTime();
      // Subtle pulsing effect - opacity varies between base opacity and slightly higher
      const pulseOpacity = opacity + Math.sin(time * 4) * 0.1;
      meshRef.current.material.opacity = Math.max(0.15, Math.min(0.4, pulseOpacity));
      
      // Very subtle rotation for shimmer effect
      meshRef.current.rotation.y += 0.005;
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      position={[0, 1, 0]} // Center the shield around player (slightly elevated)
    />
  );
};

export default Shield;
