import React from "react";

const LibraryCard = (props) => {
  return (
    <div
      style={{
        width: 150,
        height: 200,
        borderRadius: 8,
        border: "1px solid white",
        color: "white",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        marginBottom: 15,
        cursor: "pointer",
        backgroundColor: "rosybrown",
        flexDirection: "column",
      }}
      onClick={props.onClick}
    >
      {props.name}
      {props.imageURL && <img src={props.imageURL} style={{ height: 90 }} />}
    </div>
  );
};

export default LibraryCard;
