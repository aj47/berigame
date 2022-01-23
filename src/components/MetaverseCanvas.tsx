import { useEffect, useRef, useState} from "react";
import Metaverse from "../scripts/Metaverse";
const MetaverseCanvas = () => {
	const [MetaverseObject, setMetaverseObject] = useState(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setMetaverseObject(new Metaverse({ canvasRef }));
  }, [canvasRef]);

  return (
    <canvas id="canvas" ref={canvasRef} onPointerUp={(e) => console.log("yo")} />
  );
};

export default MetaverseCanvas;