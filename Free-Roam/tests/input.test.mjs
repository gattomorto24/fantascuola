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
  querySelector(selector) { if (selector === 'span') return this.span ||= new Element(); return null; }
}

function pointer(type, id, x, y) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch' });
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
    assert.deepEqual({ ...input.read() }, { moveX: 0, moveY: 0, sprint: false, jump: false, cameraX: 0, cameraY: 0,
      zoom: 0, toggleWeapon: false, aim: false, shot: null, interact: false, exitVehicle: false });
    assert.equal(root.hidden, true);
    input.dispose();
  } finally {
    globalThis.window = previousWindow;
    globalThis.matchMedia = previousMatchMedia;
  }
});

test('P estrae la pistola, destro mira, sinistro spara; il tocco breve spara senza scambiare uno swipe', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const canvas = new Element();
    const root = new Element();
    const parts = Object.fromEntries(['move-pad', 'move-thumb', 'touch-jump', 'touch-weapon'].map((id) => [id, new Element()]));
    root.querySelector = (selector) => parts[selector.slice(1)];
    const input = new InputManager(canvas, root);
    const key = new Event('keydown', { cancelable: true });
    Object.assign(key, { code: 'KeyP' });
    window.dispatchEvent(key);
    assert.equal(input.read().toggleWeapon, true);
    assert.equal(input.read().toggleWeapon, false);
    input.setWeaponDrawn(true);
    assert.equal(parts['touch-weapon'].attributes['aria-pressed'], 'true');

    const mouse = (type, button, x = 80, y = 80) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { button, clientX: x, clientY: y });
      return event;
    };
    const mousePointer = mouse('pointerdown', 0);
    Object.assign(mousePointer, { pointerId: 5, pointerType: 'mouse' });
    canvas.dispatchEvent(mousePointer);
    assert.equal(mousePointer.defaultPrevented, false);
    canvas.dispatchEvent(mouse('mousedown', 2));
    assert.equal(input.read().aim, true);
    canvas.dispatchEvent(mouse('mousedown', 0, 100, 90));
    assert.deepEqual(input.read().shot, { x: 100, y: 90, touch: false });
    window.dispatchEvent(mouse('mouseup', 2));
    assert.equal(input.read().aim, false);

    canvas.dispatchEvent(pointer('pointerdown', 7, 90, 70));
    canvas.dispatchEvent(pointer('pointerup', 7, 90, 70));
    assert.deepEqual(input.read().shot, { x: 90, y: 70, touch: true });
    canvas.dispatchEvent(pointer('pointerdown', 8, 90, 70));
    canvas.dispatchEvent(pointer('pointermove', 8, 125, 70));
    canvas.dispatchEvent(pointer('pointerup', 8, 125, 70));
    assert.equal(input.read().shot, null);

    parts['touch-weapon'].dispatchEvent(pointer('pointerdown', 9, 0, 0));
    assert.equal(input.read().toggleWeapon, true);
    input.dispose();
  } finally { globalThis.window = previousWindow; }
});

test('E entra o esce dall’auto e sul telefono Salto diventa ESCI', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const canvas = new Element();
    const root = new Element();
    const parts = Object.fromEntries(['move-pad', 'move-thumb', 'touch-jump', 'touch-weapon', 'touch-vehicle']
      .map((id) => [id, new Element()]));
    root.querySelector = (selector) => parts[selector.slice(1)];
    const input = new InputManager(canvas, root);
    input.setVehicleAvailable(true);
    assert.equal(parts['touch-vehicle'].hidden, false);
    parts['touch-vehicle'].dispatchEvent(pointer('pointerdown', 10, 0, 0));
    assert.equal(input.read().interact, true);
    input.setDriving(true);
    assert.equal(parts['touch-jump'].attributes['aria-label'], "Esci dall'auto");
    assert.equal(parts['touch-jump'].span.textContent, 'ESCI');
    assert.equal(parts['touch-vehicle'].hidden, true);
    parts['touch-jump'].dispatchEvent(pointer('pointerdown', 11, 0, 0));
    assert.equal(input.read().exitVehicle, true);
    assert.equal(input.read().jump, false);
    input.setDriving(false);
    assert.equal(parts['touch-jump'].span.textContent, '↑');
    const key = new Event('keydown', { cancelable: true });
    Object.assign(key, { code: 'KeyE' });
    window.dispatchEvent(key);
    assert.equal(input.read().interact, true);
    input.dispose();
  } finally { globalThis.window = previousWindow; }
});

test('scrivere in chat sospende movimento e sparo senza perdere i controlli', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const canvas = new Element();
    const root = new Element();
    root.querySelector = () => null;
    const input = new InputManager(canvas, root);
    input.setTextEntry(true);
    const key = new Event('keydown', { cancelable: true });
    Object.assign(key, { code: 'KeyW' });
    window.dispatchEvent(key);
    assert.equal(input.read().moveY, 0);
    assert.equal(root.hidden, true);
    input.setTextEntry(false);
    window.dispatchEvent(key);
    assert.equal(input.read().moveY, 1);
    input.dispose();
  } finally { globalThis.window = previousWindow; }
});
