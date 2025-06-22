import React from "react";
import GroundPlane from "../../Objects/GroundPlane";
import WorldLoader from "./WorldLoader";

const AlphaIsland = (props) => {
  return (
    <>
      <GroundPlane />
      <WorldLoader fallbackToDefault={true} />
    </>
  );
};

export default AlphaIsland;
