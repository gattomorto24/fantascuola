export class InputManager {
  constructor(canvas, touchRoot = document.getElementById('touch-controls')) {
    this.keys = new Set(); this.jumpQueued = false; this.canvas = canvas; this.touchRoot = touchRoot;
    this.pointerId = null; this.pointerX = 0; this.pointerY = 0;
    this.cameraDeltaX = 0; this.cameraDeltaY = 0; this.zoomDelta = 0;
    this.touchMoveX = 0; this.touchMoveY = 0; this.touchSprint = false; this.touchJumpQueued = false;
    this.touchDisposers = []; this.touchResets = [];
    this.state = { moveX: 0, moveY: 0, sprint: false, jump: false, cameraX: 0, cameraY: 0, zoom: 0 };
    this.onKeyDown = (event) => {
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && !this.keys.has('Space')) this.jumpQueued = true;
      this.keys.add(event.code);
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onBlur = () => {
      this.keys.clear(); this.pointerId = null; this.touchMoveX = this.touchMoveY = 0;
      this.cameraDeltaX = this.cameraDeltaY = 0;
      this.touchSprint = false; this.updateRunButton(); this.resetThumb();
      this.touchResets.forEach((reset) => reset());
    };
    this.onPointerDown = (event) => {
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId; this.pointerX = event.clientX; this.pointerY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    };
    this.onPointerUp = (event) => { if (event.pointerId === this.pointerId) this.pointerId = null; };
    this.onPointerMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.cameraDeltaX += event.clientX - this.pointerX;
      this.cameraDeltaY += event.clientY - this.pointerY;
      this.pointerX = event.clientX; this.pointerY = event.clientY;
    };
    this.onWheel = (event) => { event.preventDefault(); this.zoomDelta += event.deltaY; };
    window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp); window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown); canvas.addEventListener('pointerup', this.onPointerUp); canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove); canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.bindTouchControls();
  }
  bindPad(element, onMove, onEnd) {
    if (!element) return;
    let pointerId = null;
    const down = (event) => {
      if (pointerId !== null) return;
      event.preventDefault(); pointerId = event.pointerId;
      element.setPointerCapture?.(pointerId); onMove(event, true);
    };
    const move = (event) => { if (event.pointerId === pointerId) { event.preventDefault(); onMove(event, false); } };
    const end = (event) => { if (event.pointerId === pointerId) { pointerId = null; onEnd(); } };
    this.touchResets.push(() => { pointerId = null; onEnd(); });
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    this.touchDisposers.push(() => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
    });
  }
  bindTouchControls() {
    if (!this.touchRoot) return;
    const movePad = this.touchRoot.querySelector('#move-pad');
    const lookPad = this.touchRoot.querySelector('#look-pad');
    const runButton = this.touchRoot.querySelector('#touch-run');
    const jumpButton = this.touchRoot.querySelector('#touch-jump');
    this.moveThumb = this.touchRoot.querySelector('#move-thumb');
    this.bindPad(movePad, (event) => {
      const rect = movePad.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) * 0.36;
      let x = (event.clientX - rect.left - rect.width / 2) / radius;
      let y = (event.clientY - rect.top - rect.height / 2) / radius;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      this.touchMoveX = Math.abs(x) < 0.12 ? 0 : x;
      this.touchMoveY = Math.abs(y) < 0.12 ? 0 : -y;
      this.moveThumb.style.left = `calc(50% + ${x * radius}px)`;
      this.moveThumb.style.top = `calc(50% + ${y * radius}px)`;
    }, () => { this.touchMoveX = this.touchMoveY = 0; this.resetThumb(); });
    let lookX = 0, lookY = 0;
    this.bindPad(lookPad, (event, starting) => {
      if (!starting) {
        this.cameraDeltaX += event.clientX - lookX;
        this.cameraDeltaY += event.clientY - lookY;
      }
      lookX = event.clientX; lookY = event.clientY;
    }, () => {});
    const run = () => { this.touchSprint = !this.touchSprint; this.updateRunButton(); };
    const jump = () => { this.touchJumpQueued = true; };
    runButton.addEventListener('click', run);
    jumpButton.addEventListener('click', jump);
    this.touchDisposers.push(() => { runButton.removeEventListener('click', run); jumpButton.removeEventListener('click', jump); });
  }
  updateRunButton() {
    const button = this.touchRoot?.querySelector('#touch-run');
    if (!button) return;
    button.classList.toggle('active', this.touchSprint);
    button.setAttribute('aria-pressed', String(this.touchSprint));
  }
  resetThumb() {
    if (!this.moveThumb) return;
    this.moveThumb.style.left = '50%'; this.moveThumb.style.top = '50%';
  }
  showTouchControls() { if (this.touchRoot) this.touchRoot.hidden = false; }
  read() {
    const input = this.state;
    input.moveX = Math.max(-1, Math.min(1, Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + this.touchMoveX));
    input.moveY = Math.max(-1, Math.min(1, Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) + this.touchMoveY));
    input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint;
    input.jump = this.jumpQueued || this.touchJumpQueued;
    input.cameraX = this.cameraDeltaX; input.cameraY = this.cameraDeltaY; input.zoom = this.zoomDelta;
    this.jumpQueued = this.touchJumpQueued = false;
    this.cameraDeltaX = this.cameraDeltaY = this.zoomDelta = 0;
    return input;
  }
  dispose() {
    window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown); this.canvas.removeEventListener('pointerup', this.onPointerUp); this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove); this.canvas.removeEventListener('wheel', this.onWheel);
    this.touchDisposers.forEach((dispose) => dispose());
    if (this.touchRoot) this.touchRoot.hidden = true;
  }
}
