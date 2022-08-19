import { useAnimations, useGLTF } from "@react-three/drei";
import { useGraph } from "@react-three/fiber";
import React, { Suspense, useEffect, useMemo } from "react";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils";
import RenderOtherUser from "./RenderOtherUser";

const RenderNPC = (props) => {
  return (
    <group>
      <RenderOtherUser url={"/native-woman.glb"} position={[0, 0, 0]} restPosition={[10,0,10]} isWalking/>
    </group>
  );
};

export default RenderNPC;
