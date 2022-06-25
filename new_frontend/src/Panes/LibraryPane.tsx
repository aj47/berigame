import React from "react";
import LibraryCard from "../Components/LibraryCard";
interface LibraryPaneProps {
  addAssetToScene: any;
}

const LibraryPane = (props: LibraryPaneProps) => {
  const assetData = [
    { name: "Long Sleeve Shirt", url: "/shirt.glb", imageURL: "/shirt.png" },
    {name: "Sneaker", url:"/sneaker.glb", imageURL: "/sneaker.png" },
    {name: "Corasa", url:"/corasa.glb", imageURL: "/corasa.png" },
  ];
  return (
    <div
      style={{
        backgroundColor: "#badaff8b",
        left: 8,
        top: 8,
      }}
      className="pane"
    >
      {assetData.map((asset: any, i) => {
        return (
          <LibraryCard
            onClick={() => {
              props.addAssetToScene(asset.url);
            }}
            name={asset.name}
            imageURL={asset.imageURL}
            key={i}
          />
        );
      })}
    </div>
  );
};

export default LibraryPane;
