import test from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../js/input/InputManager.js';

class Element extends EventTarget {
  constructor() { super(); this.style = {}; this.hidden = true; this.attributes = {}; this.classes = new Set(); this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; }
  setPointerCapture() {}
  setAttribute(name, value) { this.attributes[name] = value; }
}

function pointer(type, id, x, y) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y });
  return event;
}

test('joystick, visuale, corsa e salto touch producono input e si rilasciano', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const canvas = new Element(), root = new Element();
    const parts = Object.fromEntries(['move-pad', 'look-pad', 'move-thumb', 'touch-run', 'touch-jump'].map((id) => [id, new Element()]));
    root.querySelector = (selector) => parts[selector.slice(1)];
    const input = new InputManager(canvas, root);
    input.showTouchControls();
    assert.equal(root.hidden, false);
    parts['move-pad'].dispatchEvent(pointer('pointerdown', 1, 60, 60));
    parts['move-pad'].dispatchEvent(pointer('pointermove', 1, 95, 25));
    parts['look-pad'].dispatchEvent(pointer('pointerdown', 2, 50, 50));
    parts['look-pad'].dispatchEvent(pointer('pointermove', 2, 70, 45));
    parts['touch-run'].dispatchEvent(new Event('click'));
    parts['touch-jump'].dispatchEvent(new Event('click'));
    const active = { ...input.read() };
    assert.ok(active.moveX > 0 && active.moveY > 0);
    assert.equal(active.cameraX, 20);
    assert.equal(active.cameraY, -5);
    assert.equal(active.sprint, true);
    assert.equal(active.jump, true);
    assert.equal(input.read().jump, false);
    parts['move-pad'].dispatchEvent(pointer('pointerup', 1, 95, 25));
    assert.equal(input.read().moveX, 0);
    assert.equal(input.read().moveY, 0);
    input.dispose();
    assert.equal(root.hidden, true);
  } finally { globalThis.window = previousWindow; }
});
