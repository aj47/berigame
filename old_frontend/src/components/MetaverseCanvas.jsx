import { useEffect, useRef, useState} from "react";
import Metaverse from "../scripts/Metaverse";

const LoadingSpinner = () => {
  return <div id="loading-spinner" className="loading-spinner"/>
}

const MetaverseCanvas = () => {
	const [MetaverseObject, setMetaverseObject] = useState(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    setMetaverseObject(new Metaverse({ canvasRef }));
  }, [canvasRef]);

  return (
    <>
      <LoadingSpinner/>
      <canvas id="canvas" ref={canvasRef}/>
    </>
  );
};

export default MetaverseCanvas;