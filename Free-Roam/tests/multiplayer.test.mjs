import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerManager, validSnapshot } from '../js/multiplayer/MultiplayerManager.js';

function player(x = 0) {
  return {
    root: { position: { x, y: 0, z: 0 }, rotation: { y: 0 } },
    avatarId: 'default',
    movementState: 'Idle',
  };
}

function remotes() {
  const items = new Map();
  return {
    items,
    receive: (snapshot) => items.set(snapshot.playerId, snapshot),
    reconcile: (ids) => { for (const id of items.keys()) if (!ids.has(id)) items.delete(id); },
    remove: (id) => items.delete(id),
    clear: () => items.clear(),
    update: () => {},
  };
}

class FakeServer {
  constructor() {
    this.sockets = new Set();
    this.players = new Map();
  }

  connect(socket) {
    this.sockets.add(socket);
    queueMicrotask(() => socket.emit('open', {}));
  }

  receive(socket, raw) {
    const message = JSON.parse(raw);
    if (message.type === 'join') {
      socket.playerId = message.player.playerId;
      const others = [...this.players.values()];
      this.players.set(socket.playerId, message.player);
      socket.emit('message', { data: JSON.stringify({ type: 'snapshot', players: others }) });
      this.broadcast(socket, { type: 'join', player: message.player });
    } else if (message.type === 'state' && socket.playerId === message.player.playerId) {
      this.players.set(socket.playerId, message.player);
      this.broadcast(socket, { type: 'state', player: message.player });
    } else if (message.type === 'ping') {
      socket.emit('message', { data: JSON.stringify({ type: 'pong', ts: message.ts }) });
    }
  }

  broadcast(sender, message) {
    for (const socket of this.sockets) {
      if (socket !== sender && socket.readyState === FakeWebSocket.OPEN) {
        socket.emit('message', { data: JSON.stringify(message) });
      }
    }
  }

  close(socket, code = 1006, reason = 'network') {
    if (!this.sockets.has(socket)) return;
    this.sockets.delete(socket);
    if (socket.playerId) {
      this.players.delete(socket.playerId);
      this.broadcast(socket, { type: 'leave', playerId: socket.playerId });
    }
    socket.readyState = FakeWebSocket.CLOSED;
    socket.emit('close', { code, reason });
  }
}

const server = new FakeServer();

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor() {
    this.readyState = FakeWebSocket.CONNECTING;
    this.handlers = new Map();
    server.connect(this);
    queueMicrotask(() => { this.readyState = FakeWebSocket.OPEN; });
  }

  addEventListener(type, fn) {
    const list = this.handlers.get(type) || [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  emit(type, event) {
    if (type === 'open') this.readyState = FakeWebSocket.OPEN;
    for (const fn of this.handlers.get(type) || []) fn(event);
  }

  send(raw) { server.receive(this, raw); }
  close(code = 1000, reason = 'client close') { server.close(this, code, reason); }
}

globalThis.WebSocket = FakeWebSocket;

test('rifiuta stati remoti invalidi', () => {
  const state = {
    playerId: 'a',
    displayName: 'Tony',
    avatarId: 'default',
    position: { x: 1, y: 0, z: 2 },
    rotation: 0,
    movementState: 'Walking',
    timestamp: Date.now(),
  };
  assert.equal(validSnapshot(state), true);
  assert.equal(validSnapshot({ ...state, position: { x: Infinity, y: 0, z: 0 } }), false);
  assert.equal(validSnapshot({ ...state, displayName: '<script>' }), false);
  assert.equal(validSnapshot({ ...state, avatarId: 'x'.repeat(161) }), false);
  assert.equal(validSnapshot({ ...state, timestamp: Date.now() - 61000 }), false);
});

test('WebSocket dedicato sincronizza ingresso, stato e uscita', async () => {
  server.sockets.clear();
  server.players.clear();

  const remoteA = remotes();
  const remoteB = remotes();
  const config = {
    serverUrl: 'wss://test/room/main',
    sendHz: 10,
    reconnectBaseMs: 5,
    reconnectMaxMs: 20,
    connectTimeoutMs: 100,
    pingSeconds: 5,
  };

  const a = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Tony' }, player(1), remoteA, config, () => {});
  const b = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Altro' }, player(4), remoteB, config, () => {});

  a.connect();
  b.connect();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(remoteA.items.get(b.playerId)?.displayName, 'Altro');
  assert.equal(remoteB.items.get(a.playerId)?.displayName, 'Tony');

  a.localPlayer.root.position.x = 9;
  a.update(0.11);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remoteB.items.get(a.playerId)?.position.x, 9);

  await a.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remoteB.items.has(a.playerId), false);
  await b.disconnect();
});

test('una connessione interrotta si riconnette automaticamente', async () => {
  server.sockets.clear();
  server.players.clear();

  const remoteA = remotes();
  const config = {
    serverUrl: 'wss://test/room/main',
    sendHz: 10,
    reconnectBaseMs: 5,
    reconnectMaxMs: 20,
    connectTimeoutMs: 100,
    pingSeconds: 5,
  };

  const a = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Tony' }, player(1), remoteA, config, () => {});
  a.connect();
  await new Promise((resolve) => setTimeout(resolve, 5));

  const firstSocket = a.transport.socket;
  server.close(firstSocket, 1012, 'restart');
  assert.equal(a.online, false);

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a.online, true);
  assert.notEqual(a.transport.socket, firstSocket);

  await a.disconnect();
});
