import React, { useEffect, useRef } from "react";
import { Object3D } from "three";
import Weapon, { WeaponConfig, WeaponType } from "./Weapon";
import Sword from "../../../Objects/Sword";

interface WeaponAttachmentProps {
  characterScene: Object3D;
  weaponType: WeaponType;
  enabled?: boolean;
}

/**
 * WeaponAttachment Component
 * 
 * This component handles attaching weapons to character bones/attachment points.
 * It finds the appropriate bone in the character's skeleton and attaches the weapon
 * as a child object, ensuring it follows all character animations.
 * 
 * The attachment system:
 * - Searches for hand bones in the character skeleton
 * - Attaches weapons with proper positioning and orientation
 * - Maintains attachment through all animations
 * - Supports different weapon types with different configurations
 */
const WeaponAttachment: React.FC<WeaponAttachmentProps> = ({ 
  characterScene, 
  weaponType, 
  enabled = true 
}) => {
  const weaponGroupRef = useRef<Object3D>(null);

  // Weapon configurations for different weapon types
  const weaponConfigs: Record<WeaponType, WeaponConfig> = {
    [WeaponType.SWORD]: {
      type: WeaponType.SWORD,
      // Position the sword handle in the hand (sword extends upward)
      positionOffset: [0, 0.5, 0],
      // Rotate to make it look like it's being held properly
      rotationOffset: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };

  /**
   * Find the hand bone in the character skeleton
   * Common bone names: "RightHand", "Right_Hand", "hand_R", "mixamorigRightHand"
   */
  const findHandBone = (scene: Object3D): Object3D | null => {
    let handBone: Object3D | null = null;
    
    const possibleHandNames = [
      "RightHand",
      "Right_Hand", 
      "hand_R",
      "mixamorigRightHand",
      "RightHandIndex1", // Sometimes the hand bone is named differently
      "Hand_R",
      "hand.R",
    ];

    scene.traverse((child) => {
      if (handBone) return; // Already found
      
      // Check if this object's name matches any of our possible hand names
      for (const handName of possibleHandNames) {
        if (child.name.toLowerCase().includes(handName.toLowerCase())) {
          handBone = child;
          break;
        }
      }
    });

    return handBone;
  };

  useEffect(() => {
    if (!enabled || !characterScene || !weaponGroupRef.current) return;

    const handBone = findHandBone(characterScene);
    
    if (handBone) {
      // Attach weapon to hand bone
      handBone.add(weaponGroupRef.current);
      console.log(`Weapon attached to bone: ${handBone.name}`);
    } else {
      // Fallback: attach to character root if no hand bone found
      console.warn("Hand bone not found, attaching weapon to character root");
      characterScene.add(weaponGroupRef.current);
    }

    // Cleanup function
    return () => {
      if (weaponGroupRef.current && weaponGroupRef.current.parent) {
        weaponGroupRef.current.parent.remove(weaponGroupRef.current);
      }
    };
  }, [characterScene, enabled, weaponType]);

  if (!enabled) return null;

  const config = weaponConfigs[weaponType];

  const renderWeapon = () => {
    switch (weaponType) {
      case WeaponType.SWORD:
        return <Sword />;
      default:
        return <Sword />; // Default to sword for now
    }
  };

  return (
    <group ref={weaponGroupRef}>
      <Weapon config={config}>
        {renderWeapon()}
      </Weapon>
    </group>
  );
};

export default WeaponAttachment;
