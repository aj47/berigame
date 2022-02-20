import { useEffect, useRef, useState} from "react";
import Metaverse from "../scripts/Metaverse";
const MetaverseCanvas = () => {
	const [MetaverseObject, setMetaverseObject] = useState(null);
  const canvasRef = useRef(null);
  useEffect(() => {
    setMetaverseObject(new Metaverse({ canvasRef }));
  }, [canvasRef]);

  return (
    <canvas id="canvas" ref={canvasRef}/>
  );
};

export default MetaverseCanvas;