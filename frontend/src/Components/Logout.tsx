import React from "react";

//Logout button
const Logout = (props) => {
  return (
    <div
      style={{
        cursor: "pointer",
        textDecoration: "underline",
        zIndex: 5,
        top: "1rem",
        right: "1rem",
        position: "absolute",
      }}
      onClick={props.logout}
    >
      Logout
    </div>
  );
};

export default Logout;
