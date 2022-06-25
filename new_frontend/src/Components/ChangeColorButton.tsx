import React from "react";

export interface OpenPaneBtn {
  onClick: any;
  isOpen: boolean;
}

const ChangeColorButton = (props: OpenPaneBtn) => {
  return (
    <div
      style={{
        position: "absolute",
        backgroundColor: "#770404",
        color: "#FFF",
        left: 8,
        bottom: 8,
        zIndex: 2,
      }}
      className="btn"
      onClick={props.onClick}
    >
      Change color
    </div>
  );
};

export default ChangeColorButton;
