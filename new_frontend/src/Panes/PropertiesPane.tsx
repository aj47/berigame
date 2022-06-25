import React from "react";
import LibraryCard from "../Components/LibraryCard";

const PropertiesPane = (props) => {
  const propertiesData = [
    {
      name: "Leather",
      url: "/shirt-materials/leather/leather.glb",
      imageUrl: "/shirt-materials/leather/leather.png",
    },
    {
      name: "Fabric",
      url: "/shirt-materials/fabric/fabric.glb",
      imageUrl: "/shirt-materials/fabric/fabric.png",
    },
    {
      name: "Black Velvet",
      url: "/shirt-materials/black-velvet/black-velvet.glb",
      imageUrl: "/shirt-materials/black-velvet/black-velvet.png",
    },
    {
      name: "White Velvet",
      url: "/shirt-materials/white-velvet/white-velvet.glb",
      imageUrl: "/shirt-materials/white-velvet/white-velvet.png",
    },
  ];
  return (
    <div
      style={{
        right: 8,
        top: 8,
        backgroundColor: "#ffadaa8b",
      }}
      className="pane"
    >
      {propertiesData.map((asset: any, i) => {
        return (
          <LibraryCard
            onClick={() => {
              props.addAssetToScene(asset.url);
            }}
            name={asset.name}
            imageURL={asset.imageUrl}
            key={i}
          />
        );
      })}
    </div>
  );
};

export default PropertiesPane;
