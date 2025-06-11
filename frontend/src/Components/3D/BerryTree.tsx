import React, { useRef, useEffect, useState } from "react";
import { useUserInputStore, useUserStateStore, useHarvestStore, useWebsocketStore } from "../../store";
import { webSocketStartHarvest } from "../../Api";
import RenderGLB from "./RenderGLB";
import { Html } from "@react-three/drei";

const BerryTree = (props) => {
  const objRef = useRef(null);
  const treeId = props.treeId || `tree_${props.position?.join('_') || 'default'}`;

  const setClickedOtherObject = useUserInputStore(
    (state) => state.setClickedOtherObject
  );
  const setUserFollowing = useUserStateStore((state) => state.setUserFollowing);
  const websocketConnection = useWebsocketStore((state) => state.websocketConnection);

  // Harvest store selectors
  const isTreeHarvestable = useHarvestStore((state) => state.isTreeHarvestable(treeId));
  const getHarvestProgress = useHarvestStore((state) => state.getHarvestProgress(treeId));
  const updateTreeCooldown = useHarvestStore((state) => state.updateTreeCooldown);

  const [harvestProgress, setHarvestProgress] = useState(null);

  // Update harvest progress and tree cooldown periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const progress = getHarvestProgress(useHarvestStore.getState());
      setHarvestProgress(progress);
      updateTreeCooldown(treeId);
    }, 100);

    return () => clearInterval(interval);
  }, [treeId, getHarvestProgress, updateTreeCooldown]);

  const startHarvest = () => {
    if (!isTreeHarvestable || !websocketConnection) return;

    // Move player to tree first
    setUserFollowing(objRef);

    // Start harvest after a short delay to allow player to reach tree
    setTimeout(() => {
      webSocketStartHarvest(treeId, websocketConnection);
    }, 1000);

    setClickedOtherObject(null);
  };

  const onClick = (e) => {
    e.stopPropagation();

    const harvestLabel = isTreeHarvestable ? "Harvest" : "Harvesting...";
    const isDisabled = !isTreeHarvestable;

    setClickedOtherObject({
      ...objRef,
      isCombatable: false,
      connectionId: "TREE",
      e,
      dropdownOptions: [
        {
          label: harvestLabel,
          onClick: isDisabled ? () => {} : startHarvest,
          disabled: isDisabled,
        },
      ],
    });
  };

  return (
    <group>
      <RenderGLB
        onClick={onClick}
        objRef={objRef}
        url={"/tree.glb"}
        position={props.position || [5, 0, 0]}
      />
      {harvestProgress && (
        <Html position={[props.position?.[0] || 5, (props.position?.[1] || 0) + 3, props.position?.[2] || 0]}>
          <div className="harvest-progress ui-element" style={{
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            minWidth: '120px'
          }}>
            <div>Harvesting...</div>
            <div style={{
              background: '#333',
              height: '4px',
              borderRadius: '2px',
              margin: '4px 0',
              overflow: 'hidden'
            }}>
              <div style={{
                background: '#4CAF50',
                height: '100%',
                width: `${(harvestProgress.progress * 100)}%`,
                transition: 'width 0.1s ease'
              }} />
            </div>
            <div>{Math.round(harvestProgress.progress * 100)}%</div>
          </div>
        </Html>
      )}
    </group>
  );
};

export default BerryTree;