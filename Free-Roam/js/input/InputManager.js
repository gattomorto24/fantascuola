export class InputManager {
  constructor(canvas) {
    this.keys = new Set(); this.jumpQueued = false; this.canvas = canvas;
    this.pointerDown = false; this.cameraDeltaX = 0; this.cameraDeltaY = 0; this.zoomDelta = 0;
    this.state = { moveX: 0, moveY: 0, sprint: false, jump: false, cameraX: 0, cameraY: 0, zoom: 0 };
    this.onKeyDown = (event) => {
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && !this.keys.has('Space')) this.jumpQueued = true;
      this.keys.add(event.code);
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onBlur = () => { this.keys.clear(); this.pointerDown = false; };
    this.onPointerDown = (event) => { this.pointerDown = true; canvas.setPointerCapture?.(event.pointerId); };
    this.onPointerUp = () => { this.pointerDown = false; };
    this.onPointerMove = (event) => { if (this.pointerDown) { this.cameraDeltaX += event.movementX; this.cameraDeltaY += event.movementY; } };
    this.onWheel = (event) => { event.preventDefault(); this.zoomDelta += event.deltaY; };
    window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp); window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown); canvas.addEventListener('pointerup', this.onPointerUp); canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove); canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }
  read() {
    // Logical controls allow touch/gamepad adapters later without changing PlayerController.
    const input = this.state;
    input.moveX = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    input.moveY = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); input.jump = this.jumpQueued;
    input.cameraX = this.cameraDeltaX; input.cameraY = this.cameraDeltaY; input.zoom = this.zoomDelta;
    this.jumpQueued = false; this.cameraDeltaX = this.cameraDeltaY = this.zoomDelta = 0;
    return input;
  }
  dispose() {
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.canvas.removeEventListener('pointerup', this.onPointerUp); this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove); this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
