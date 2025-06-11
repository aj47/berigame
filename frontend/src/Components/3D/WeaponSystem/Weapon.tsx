import React from "react";

export enum WeaponType {
  SWORD = "sword",
  // Future weapon types can be added here
  // BOW = "bow",
  // STAFF = "staff",
  // AXE = "axe",
}

export interface WeaponConfig {
  type: WeaponType;
  // Position offset relative to hand attachment point
  positionOffset: [number, number, number];
  // Rotation offset for proper grip orientation
  rotationOffset: [number, number, number];
  // Scale for weapon size
  scale: [number, number, number];
}

export interface WeaponProps {
  config: WeaponConfig;
  children?: React.ReactNode;
}

/**
 * Base Weapon Component
 * 
 * This component provides the foundation for all weapon types in the game.
 * It handles common weapon functionality and can be extended for specific weapon types.
 * 
 * The weapon system is designed to be:
 * - Extensible: Easy to add new weapon types
 * - Configurable: Weapons can have different attachment points and orientations
 * - Reusable: Same system works for players, NPCs, and other entities
 */
const Weapon: React.FC<WeaponProps> = ({ config, children }) => {
  const { positionOffset, rotationOffset, scale } = config;

  return (
    <group 
      position={positionOffset} 
      rotation={rotationOffset}
      scale={scale}
    >
      {children}
    </group>
  );
};

export default Weapon;
