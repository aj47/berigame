import React, { memo, useState } from "react";

const Modal = memo((props) => {
  const [isVisible, setIsVisible] = useState(true);

  const handlePlayClick = () => {
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="ui-element modal">
      <h1>Welcome to BeriGame!</h1>
      <p>
        This is currently an alpha demo. It showcases the rendering and
        massively multiplayer technology.
      </p>
      <button className="ui-element" onClick={handlePlayClick}>Play</button>
    </div>
  );
});

export default Modal;
