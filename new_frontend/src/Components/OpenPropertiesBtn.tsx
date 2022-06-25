import React from "react";
import { OpenPaneBtn } from "./OpenLibraryBtn";

const OpenPropertiesBtn = (props: OpenPaneBtn) => {
  return (
    <div
      style={{
        position: "absolute",
        backgroundColor: "hotpink",
        right: 8,
        top: 8,
        zIndex: 2,
      }}
      className="btn"
      onClick={props.onClick}
    >
      {props.isOpen ? "X" : "Materials"}
    </div>
  );
};

export default OpenPropertiesBtn;
