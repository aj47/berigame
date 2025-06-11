import React, { memo } from "react";
import { useSkillsStore } from "../store";

const SkillsUI = memo(() => {
  const shieldActive = useSkillsStore((state) => state.shieldActive);
  const shieldButtonDisabled = useSkillsStore((state) => state.shieldButtonDisabled);
  const activateShield = useSkillsStore((state) => state.activateShield);
  const deactivateShield = useSkillsStore((state) => state.deactivateShield);
  const enableShieldButton = useSkillsStore((state) => state.enableShieldButton);

  const handleShieldClick = () => {
    if (shieldButtonDisabled || shieldActive) return;
    
    // Activate shield
    activateShield();
    
    // Deactivate shield after 3 seconds
    setTimeout(() => {
      deactivateShield();
    }, 3000);
    
    // Re-enable button after 3 seconds (no cooldown for now)
    setTimeout(() => {
      enableShieldButton();
    }, 3000);
  };

  return (
    <div className="skills-ui">
      <button
        className={`skill-button shield-button ${shieldActive ? 'active' : ''} ${shieldButtonDisabled ? 'disabled' : ''}`}
        onClick={handleShieldClick}
        disabled={shieldButtonDisabled}
        title="Shield (3s duration)"
      >
        🛡️
      </button>
    </div>
  );
});

export default SkillsUI;
