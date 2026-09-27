import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalChat } from '../js/ui/GlobalChat.js';

class Node extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.hidden = false;
    this.value = '';
    this.attributes = {};
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
    };
    this.style = { setProperty() {} };
  }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  blur() { this.focused = false; }
}

test('Invio apre la chat, l’invio richiude e i messaggi tornano discreti', () => {
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = { createElement: () => new Node() };
  const parts = Object.fromEntries(['chat-toggle', 'chat-messages', 'chat-form', 'chat-input']
    .map((id) => [id, new Node()]));
  const root = new Node();
  root.hidden = true;
  root.querySelector = (selector) => parts[selector.slice(1)];
  const states = [];
  const chat = new GlobalChat(root, {
    onOpenChange: (active) => states.push(active),
    onSend: (text) => ({ displayName: 'Tony', text }),
  });
  try {
    chat.setEnabled(true);
    const enter = new Event('keydown', { cancelable: true });
    Object.assign(enter, { code: 'Enter' });
    window.dispatchEvent(enter);
    assert.equal(chat.active, true);
    assert.equal(parts['chat-input'].focused, true);
    assert.equal(parts['chat-form'].hidden, false);
    parts['chat-input'].value = 'Ciao a tutti';
    parts['chat-form'].dispatchEvent(new Event('submit', { cancelable: true }));
    assert.equal(chat.active, false);
    assert.equal(parts['chat-messages'].childElementCount, 1);
    assert.equal(parts['chat-messages'].firstElementChild.children[1].textContent, 'Ciao a tutti');
    assert.equal(root.classes.has('recent'), true);
    chat.add('Amico', 'Ciao!');
    assert.equal(parts['chat-messages'].childElementCount, 2);
    assert.deepEqual(states, [true, false]);
  } finally {
    chat.dispose();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
  assert.equal(root.hidden, true);
});
