import React, { Suspense, useState } from "react";
import OpenLibraryBtn from "./Components/OpenLibraryBtn";
import ThreeJSCanvas from "./Panes/ThreeJSCanvas";
import "./App.css";
import LibraryPane from "./Panes/LibraryPane";
import OpenPropertiesBtn from "./Components/OpenPropertiesBtn";
import RenderGLB from "./Components/RenderGLB";
import PropertiesPane from "./Panes/PropertiesPane";
import { ChromePicker } from "react-color";
import ChangeColorButton from "./Components/ChangeColorButton";
import { DoubleSide, PlaneGeometry } from "three";

// react three fiber docs
// https://docs.pmnd.rs/react-three-fiber/api/objects

function App() {
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [templateURL, setTemplateURL] = useState(null);
  const [colorChanged, setColorChanged] = useState(false);
  const [customColor, setCustomColor] = useState({ r: 105, g: 0, b: 0 });

  const addAssetToScene = (assetURL) => {
    setTemplateURL(assetURL);
    setIsLibraryOpen(false);
    setIsPropertiesOpen(false);
  };

  return (
    <>
      {templateURL && templateURL.indexOf("/shirt") === 0 && (
        <OpenPropertiesBtn
          onClick={() => {
            setIsPropertiesOpen(!isPropertiesOpen);
          }}
          isOpen={isPropertiesOpen}
        />
      )}
      <OpenLibraryBtn
        onClick={() => {
          setIsLibraryOpen(!isLibraryOpen);
        }}
        isOpen={isLibraryOpen}
      />
      {templateURL && (
        <ChangeColorButton
          onClick={() => {
            setIsColorPickerOpen(!isColorPickerOpen);
            setColorChanged(true);
          }}
        />
      )}
      {isColorPickerOpen && (
        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: 9,
            zIndex: 5,
            opacity: 0.9,
          }}
        >
          <ChromePicker
            color={customColor}
            onChange={(e) => {
              setCustomColor(e.rgb);
            }}
          />
        </div>
      )}
      {isLibraryOpen && <LibraryPane addAssetToScene={addAssetToScene} />}
      {isPropertiesOpen && <PropertiesPane addAssetToScene={addAssetToScene} />}
      <ThreeJSCanvas
        templateURL={templateURL}
        customColor={colorChanged && customColor}
      >
        <pointLight position={[10, 9, 10]} intensity={0.3} />
        <pointLight position={[-10, 10, -10]} intensity={0.3} />
        {/* <group position={[0, 2, 0]}>
          <Suspense fallback={null}>
            <RenderGLB url={"./island.glb"} />
          </Suspense>
        </group> */}
        
        {/* Ground Plane  */}
        <mesh scale={[500, 500, 1]}  rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeBufferGeometry/>
          <meshBasicMaterial color="grey" side={DoubleSide}/>
        </mesh>

      </ThreeJSCanvas>
    </>
  );
}

export default App;
