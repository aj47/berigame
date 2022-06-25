import React from "react";

export interface OpenPaneBtn {
  onClick: any;
  isOpen: boolean;
}

const OpenLibraryBtn = (props: OpenPaneBtn) => {
  return (
    <div
      style={{
        position: "absolute",
        backgroundColor: "#badaff",
        left: 8,
        top: 8,
        zIndex: 2,
      }}
      className="btn"
      onClick={props.onClick}
    >
      {props.isOpen ? "X" : "Library"}
    </div>
  );
};

export default OpenLibraryBtn;
