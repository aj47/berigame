import React, { Suspense } from "react";
import RenderGLB from "../Components/RenderGLB";

const PlayerController = (props) => {
  return (
    <Suspense fallback={null}>
      <RenderGLB url={"public/bald.glb"} />
    </Suspense>
  );
};

export default PlayerController;
