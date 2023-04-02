import React, { useState } from "react";
import { Modal } from "react-bootstrap";

function Landing() {
  const [modalOpen, setModalOpen] = useState(true);

  function MenuModal() {
    const handleCloseButton = () => {
      setModalOpen(false);
    };

    return (
      <Modal show={modalOpen} onHide={handleCloseButton} centered size="sm">
        <Modal.Header closeButton>
          <Modal.Title>Welcome to Beri Island</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ul>
            <li>
              <a href="#">High Scores</a>
            </li>
            <li>
              <a href="#">Discord</a>
            </li>
            <li>
              <a href="#">Twitter</a>
            </li>
          </ul>
        </Modal.Body>
        <Modal.Footer>
          <button onClick={handleCloseButton}>Play!</button>
        </Modal.Footer>
      </Modal>
    );
  }

  return (
      {modalOpen} ?
      <MenuModal />:<button>Menu</button>
  );
}

export default Landing;
