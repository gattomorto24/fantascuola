import test from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../js/input/InputManager.js';

class Element extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.hidden = true;
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 160, height: 160 }; }
  setPointerCapture() {}
  setAttribute(name, value) { this.attributes[name] = value; }
}

function pointer(type, id, x, y) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y });
  return event;
}

test('joystick analogico attiva sprint oltre il ring e supporta camera + salto simultanei', () => {
  const previousWindow = globalThis.window;
  const previousMatchMedia = globalThis.matchMedia;
  globalThis.window = new EventTarget();
  globalThis.matchMedia = () => ({ matches: true });

  try {
    const canvas = new Element();
    const root = new Element();
    const parts = Object.fromEntries(['move-pad', 'move-thumb', 'touch-jump'].map((id) => [id, new Element()]));
    root.querySelector = (selector) => parts[selector.slice(1)];

    const input = new InputManager(canvas, root, {
      joystickDeadZone: 8,
      joystickMoveRadius: 50,
      joystickSprintRadius: 58,
      joystickMaxRadius: 72,
    });

    input.showTouchControls();
    assert.equal(root.hidden, false);

    parts['move-pad'].dispatchEvent(pointer('pointerdown', 1, 80, 80));
    parts['move-pad'].dispatchEvent(pointer('pointermove', 1, 80, 18));

    canvas.dispatchEvent(pointer('pointerdown', 2, 100, 80));
    canvas.dispatchEvent(pointer('pointermove', 2, 126, 69));

    parts['touch-jump'].dispatchEvent(pointer('pointerdown', 3, 0, 0));

    const active = { ...input.read() };
    assert.ok(active.moveY > 0.95);
    assert.equal(active.sprint, true);
    assert.equal(active.cameraX, 26);
    assert.equal(active.cameraY, -11);
    assert.equal(active.jump, true);
    assert.equal(input.read().jump, false);
    assert.equal(parts['move-pad'].classes.has('sprinting'), true);

    parts['move-pad'].dispatchEvent(pointer('pointermove', 1, 80, 45));
    assert.equal(input.read().sprint, false);

    parts['move-pad'].dispatchEvent(pointer('pointerup', 1, 80, 45));
    assert.equal(input.read().moveX, 0);
    assert.equal(input.read().moveY, 0);

    input.dispose();
    assert.equal(root.hidden, true);
  } finally {
    globalThis.window = previousWindow;
    globalThis.matchMedia = previousMatchMedia;
  }
});

test('setEnabled blocca input durante overlay di disconnessione', () => {
  const previousWindow = globalThis.window;
  const previousMatchMedia = globalThis.matchMedia;
  globalThis.window = new EventTarget();
  globalThis.matchMedia = () => ({ matches: true });

  try {
    const canvas = new Element();
    const root = new Element();
    const parts = Object.fromEntries(['move-pad', 'move-thumb', 'touch-jump'].map((id) => [id, new Element()]));
    root.querySelector = (selector) => parts[selector.slice(1)];

    const input = new InputManager(canvas, root);
    input.setEnabled(false);
    canvas.dispatchEvent(pointer('pointerdown', 1, 10, 10));
    canvas.dispatchEvent(pointer('pointermove', 1, 40, 50));
    assert.deepEqual({ ...input.read() }, { moveX: 0, moveY: 0, sprint: false, jump: false, cameraX: 0, cameraY: 0, zoom: 0 });
    assert.equal(root.hidden, true);
    input.dispose();
  } finally {
    globalThis.window = previousWindow;
    globalThis.matchMedia = previousMatchMedia;
  }
});
