class CharacterControllerInput {

  constructor() {
    this.init();
  }

  init() {
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      space: false,
      shift: false,
      clicked: false,
      cmd: false
    }
    this.holdClickTimer = null
    document.addEventListener('keydown', (e) => this.onKeyDown(e), false);
    document.addEventListener('keyup', (e) => this.onKeyUp(e), false);
    document.addEventListener('pointerdown', (e) => this.onMouseDown(e), false);
    document.addEventListener('pointerup', (e) => this.onMouseUp(e), false);
    document.addEventListener("touchstart", (e) => this.onMouseDown(e), false);
    document.addEventListener("touchend", (e) => this.onMouseUp(e), false);
  }

  onKeyDown(event) {
    switch(event.keyCode){
      case 87: // w
        this.keys.forward = true;
        break;
      case 65: // a 
        this.keys.left = true;
        break;
      case 83: // s
        this.keys.backward = true;
        break;
      case 68: // d
        this.keys.right = true;
        break;
      case 32: // SPACE
        this.keys.space = true;
        break;
      case 16: // SHIFT
        this.keys.shift = true;
        break;
      case 224: // COMMAND
        this.keys.cmd = true;
        break;
    }
  }
  
  onMouseDown(e) {
    //To avoid multiple clicks while dragging
    this.holdClickTimer = setTimeout(() => {
      this.holdClickTimer = null;
      this.keys.clicked = null;
    }, 250);
  }
  onMouseUp(e) {
    if (this.holdClickTimer) {
      if (e.clientX)
        this.keys.clicked = {x: e.clientX, y: e.clientY};
      else if (e.changedTouches.length > 0)
        this.keys.clicked = {x: e.changedTouches[0].pageX, y: e.changedTouches[0].pageY};
      return;
    }
    this.keys.clicked = null;
  }

  onKeyUp(event) {
    switch(event.keyCode){
      case 87: // w
        this.keys.forward = false;
        break;
      case 65: // a 
        this.keys.left = false;
        break;
      case 83: // s
        this.keys.backward = false;
        break;
      case 68: // d
        this.keys.right = false;
        break;
      case 32: // SPACE
        this.keys.space = false;
        break;
      case 16: // SHIFT
        this.keys.shift = false;
        break;
      case 224: // COMMAND
        this.keys.cmd = false;
        break;
    }
  }
}

export { CharacterControllerInput };
