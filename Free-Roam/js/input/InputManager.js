import { settings } from '../config/settings.js';

export class InputManager {
  constructor(canvas, touchRoot = document.getElementById('touch-controls'), config = settings.touch) {
    this.keys = new Set();
    this.jumpQueued = false;
    this.canvas = canvas;
    this.touchRoot = touchRoot;
    this.config = config;
    this.enabled = true;

    this.cameraPointers = new Map();
    this.movePointerId = null;
    this.cameraDeltaX = 0;
    this.cameraDeltaY = 0;
    this.zoomDelta = 0;
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchSprint = false;
    this.touchJumpQueued = false;
    this.touchDisposers = [];

    this.state = { moveX: 0, moveY: 0, sprint: false, jump: false, cameraX: 0, cameraY: 0, zoom: 0 };

    this.onKeyDown = (event) => {
      if (!this.enabled) return;
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && !this.keys.has('Space')) this.jumpQueued = true;
      this.keys.add(event.code);
    };

    this.onKeyUp = (event) => this.keys.delete(event.code);

    this.onBlur = () => this.resetAll();

    this.onPointerDown = (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.cameraPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture?.(event.pointerId);
    };

    this.onPointerUp = (event) => {
      this.cameraPointers.delete(event.pointerId);
    };

    this.onPointerMove = (event) => {
      if (!this.enabled) return;
      const point = this.cameraPointers.get(event.pointerId);
      if (!point) return;
      event.preventDefault();
      this.cameraDeltaX += event.clientX - point.x;
      this.cameraDeltaY += event.clientY - point.y;
      point.x = event.clientX;
      point.y = event.clientY;
    };

    this.onWheel = (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.zoomDelta += event.deltaY;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.bindTouchControls();
  }

  bindTouchControls() {
    if (!this.touchRoot) return;
    const movePad = this.touchRoot.querySelector('#move-pad');
    const jumpButton = this.touchRoot.querySelector('#touch-jump');
    this.moveThumb = this.touchRoot.querySelector('#move-thumb');

    if (movePad) {
      const updateMove = (event) => {
        const rect = movePad.getBoundingClientRect();
        const scale = Math.max(0.65, rect.width / 160);
        const deadZone = this.config.joystickDeadZone * scale;
        const moveRadius = this.config.joystickMoveRadius * scale;
        const sprintRadius = this.config.joystickSprintRadius * scale;
        const maxRadius = this.config.joystickMaxRadius * scale;

        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const distance = Math.hypot(dx, dy);
        const safeDistance = Math.max(distance, 0.0001);
        const visualDistance = Math.min(distance, maxRadius);
        const visualX = dx / safeDistance * visualDistance;
        const visualY = dy / safeDistance * visualDistance;

        let intensity = 0;
        if (distance > deadZone) intensity = Math.min(1, (distance - deadZone) / Math.max(1, moveRadius - deadZone));

        this.touchMoveX = distance > deadZone ? (dx / safeDistance) * intensity : 0;
        this.touchMoveY = distance > deadZone ? -(dy / safeDistance) * intensity : 0;
        this.touchSprint = distance >= sprintRadius;

        if (this.moveThumb) {
          this.moveThumb.style.transform = `translate(calc(-50% + ${visualX}px), calc(-50% + ${visualY}px))`;
        }
        movePad.classList.toggle('active', distance > deadZone);
        movePad.classList.toggle('sprinting', this.touchSprint);
        movePad.setAttribute('data-sprinting', String(this.touchSprint));
      };

      const down = (event) => {
        if (!this.enabled || this.movePointerId !== null) return;
        event.preventDefault();
        event.stopPropagation();
        this.movePointerId = event.pointerId;
        movePad.setPointerCapture?.(event.pointerId);
        updateMove(event);
      };
      const move = (event) => {
        if (!this.enabled || event.pointerId !== this.movePointerId) return;
        event.preventDefault();
        event.stopPropagation();
        updateMove(event);
      };
      const end = (event) => {
        if (event.pointerId !== this.movePointerId) return;
        event.preventDefault();
        this.movePointerId = null;
        this.resetJoystick();
      };

      movePad.addEventListener('pointerdown', down);
      movePad.addEventListener('pointermove', move);
      movePad.addEventListener('pointerup', end);
      movePad.addEventListener('pointercancel', end);
      this.touchDisposers.push(() => {
        movePad.removeEventListener('pointerdown', down);
        movePad.removeEventListener('pointermove', move);
        movePad.removeEventListener('pointerup', end);
        movePad.removeEventListener('pointercancel', end);
      });
    }

    if (jumpButton) {
      const jump = (event) => {
        if (!this.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        this.touchJumpQueued = true;
        jumpButton.classList.add('active');
      };
      const endJump = () => jumpButton.classList.remove('active');
      jumpButton.addEventListener('pointerdown', jump);
      jumpButton.addEventListener('pointerup', endJump);
      jumpButton.addEventListener('pointercancel', endJump);
      this.touchDisposers.push(() => {
        jumpButton.removeEventListener('pointerdown', jump);
        jumpButton.removeEventListener('pointerup', endJump);
        jumpButton.removeEventListener('pointercancel', endJump);
      });
    }
  }

  resetJoystick() {
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchSprint = false;
    if (this.moveThumb) this.moveThumb.style.transform = 'translate(-50%, -50%)';
    const movePad = this.touchRoot?.querySelector('#move-pad');
    movePad?.classList.remove('active', 'sprinting');
    movePad?.setAttribute('data-sprinting', 'false');
  }

  resetAll() {
    this.keys.clear();
    this.cameraPointers.clear();
    this.movePointerId = null;
    this.cameraDeltaX = 0;
    this.cameraDeltaY = 0;
    this.zoomDelta = 0;
    this.jumpQueued = false;
    this.touchJumpQueued = false;
    this.resetJoystick();
  }

  isTouchCapable() {
    const nav = globalThis.navigator;
    return Number(nav?.maxTouchPoints || 0) > 0 || globalThis.matchMedia?.('(pointer: coarse)').matches === true;
  }

  showTouchControls() {
    if (this.touchRoot) this.touchRoot.hidden = !this.enabled || !this.isTouchCapable();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.resetAll();
    this.showTouchControls();
  }

  read() {
    const input = this.state;
    if (!this.enabled) {
      Object.assign(input, { moveX: 0, moveY: 0, sprint: false, jump: false, cameraX: 0, cameraY: 0, zoom: 0 });
      return input;
    }

    input.moveX = Math.max(-1, Math.min(1,
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
      Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) +
      this.touchMoveX
    ));
    input.moveY = Math.max(-1, Math.min(1,
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
      Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) +
      this.touchMoveY
    ));
    input.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchSprint;
    input.jump = this.jumpQueued || this.touchJumpQueued;
    input.cameraX = this.cameraDeltaX;
    input.cameraY = this.cameraDeltaY;
    input.zoom = this.zoomDelta;

    this.jumpQueued = false;
    this.touchJumpQueued = false;
    this.cameraDeltaX = 0;
    this.cameraDeltaY = 0;
    this.zoomDelta = 0;
    return input;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.touchDisposers.forEach((dispose) => dispose());
    this.resetAll();
    if (this.touchRoot) this.touchRoot.hidden = true;
  }
}
