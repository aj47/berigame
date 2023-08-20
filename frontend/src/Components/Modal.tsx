import React, { memo } from "react";

const Modal = memo((props) => {
  return (
    <div className="ui-element modal">
      <h1>Welcome to BeriGame!</h1>
      <p>
        This is currently an alpha demo. It showcases the rendering and
        massively multiplayer technology.
      </p>
      <button className="ui-element">Play</button>
    </div>
  );
});

export default Modal;
