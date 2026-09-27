import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerManager, cleanChatText, validAvatarConfig, validSnapshot } from '../js/multiplayer/MultiplayerManager.js';

const avatarConfig = {
  version: 1,
  type: 'pixel',
  skinTone: 'medium',
  hairStyle: 'basic',
  hairColor: 'brown',
  shirtColor: 'blue',
  pantsColor: 'red',
  shoesColor: 'white',
};

function player(x = 0) {
  return {
    root: { position: { x, y: 0, z: 0 }, rotation: { y: 0 } },
    avatarId: 'pixel',
    avatarConfig,
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
      socket.emit('message', { data: JSON.stringify({ type: 'snapshot', players: others, serverTime: Date.now() }) });
      this.broadcast(socket, { type: 'join', player: message.player });
    } else if (message.type === 'state' && socket.playerId === message.player.playerId) {
      this.players.set(socket.playerId, message.player);
      this.broadcast(socket, { type: 'state', player: message.player });
    } else if (message.type === 'ping') {
      socket.emit('message', { data: JSON.stringify({ type: 'pong', ts: message.ts, serverTime: Date.now() }) });
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

test('valida snapshot e configurazione avatar pixel', () => {
  assert.equal(validAvatarConfig(avatarConfig), true);
  assert.equal(validAvatarConfig({ ...avatarConfig, hairColor: 'purple' }), false);

  const state = {
    playerId: 'a',
    displayName: 'Tony',
    avatarId: 'pixel',
    avatarConfig,
    position: { x: 1, y: 0, z: 2 },
    rotation: 0,
    movementState: 'Walking',
    timestamp: Date.now(),
  };

  assert.equal(validSnapshot(state), true);
  assert.equal(validSnapshot({ ...state, position: { x: Infinity, y: 0, z: 0 } }), false);
  assert.equal(validSnapshot({ ...state, displayName: '<script>' }), false);
  assert.equal(validSnapshot({ ...state, avatarConfig: { ...avatarConfig, shoesColor: 'green' } }), false);
  assert.equal(validSnapshot({ ...state, timestamp: Date.now() - 61000 }), false);
  assert.equal(validSnapshot({ ...state, mapVersion: 42 }), false);
  assert.equal(validSnapshot({ ...state, weaponDrawn: 'yes' }), false);
  assert.equal(validSnapshot({ ...state, shotTarget: [0, Infinity, 0] }), false);
  assert.equal(validSnapshot({ ...state, shotOrigin: [0, Infinity, 0] }), false);
  assert.equal(validSnapshot({ ...state, shotVictimId: '<'.repeat(121) }), false);
  assert.equal(validSnapshot({ ...state, health: 101 }), false);
  assert.equal(validSnapshot({ ...state, vehicleId: 42 }), false);
  assert.equal(validSnapshot({ ...state, vehicleRole: 'pilot' }), false);
  assert.equal(validSnapshot({ ...state, vehicleCondition: 101 }), false);
  assert.equal(validSnapshot({ ...state, wanted: 6 }), false);
  assert.equal(validSnapshot({ ...state, policePose: { x: Infinity, y: 0, z: 0, yaw: 0 } }), false);
  assert.equal(validSnapshot({ ...state, npcStates: [{ id: 'npc', until: Date.now() + 10000,
    x: 0, y: 0, z: 0, yaw: 0 }] }), true);
  assert.equal(validSnapshot({ ...state, vehicleStates: [{ id: 'auto', pose: { x: Infinity, y: 0, z: 0, yaw: 0 },
    revision: 1, author: 'a' }] }), false);
  assert.equal(validSnapshot({ ...state, chat: { id: 1, text: '<script>', at: Date.now() } }), false);
  assert.equal(cleanChatText('  ciao <b>  mondo  '), 'ciao b mondo');
});

test('crossplay sincronizza solo giocatori nella stessa versione della mappa', () => {
  const remote = remotes();
  const manager = new MultiplayerManager(null, { userId: 'local', displayName: 'Tony' }, player(), remote,
    { serverUrl: 'wss://test/room/main' }, () => {}, () => {}, {}, 'map:version-1');
  const snapshot = { ...manager.snapshot(), playerId: 'remote', mapVersion: 'map:version-2' };
  manager.receiveMessage({ type: 'snapshot', players: [snapshot] });
  assert.equal(remote.items.size, 0);
  manager.receiveMessage({ type: 'join', player: { ...snapshot, mapVersion: 'map:version-1' } });
  assert.equal(remote.items.size, 1);
});

test('il danno arriva una volta per colpo e non viene ripetuto dalla snapshot iniziale', () => {
  const hits = [];
  const manager = new MultiplayerManager(null, { userId: 'local', displayName: 'Tony' }, player(), remotes(),
    { serverUrl: 'wss://test/room/main' }, () => {}, () => {},
    { onShotAtMe: (shot) => hits.push(shot.shotId) }, 'same-map');
  const enemy = { ...manager.snapshot(), playerId: 'enemy', mapVersion: 'same-map',
    weaponDrawn: true, shotId: 3, shotVictimId: manager.playerId,
    shotOrigin: [0, 1, 2], shotTarget: [0, 1, -4] };
  manager.receiveMessage({ type: 'snapshot', players: [enemy] });
  manager.receiveMessage({ type: 'state', player: enemy });
  assert.deepEqual(hits, []);
  manager.receiveMessage({ type: 'state', player: { ...enemy, shotId: 4 } });
  manager.receiveMessage({ type: 'state', player: { ...enemy, shotId: 4 } });
  assert.deepEqual(hits, [4]);
  manager.receiveMessage({ type: 'state', player: { ...enemy, shotId: 5, mapVersion: 'other-map' } });
  assert.deepEqual(hits, [4]);
});

test('passeggeri, condizione auto, NPC e polizia viaggiano nello stesso snapshot crossplay', () => {
  const received = [];
  const manager = new MultiplayerManager(null, { userId: 'local', displayName: 'Tony' }, player(), remotes(),
    { serverUrl: 'wss://test/room/main' }, () => {}, () => {}, {
      getVehicleState: () => ({ vehicleId: 'via-trinita-1', vehicleRole: 'passenger',
        vehicleCondition: 42, npcStates: [{ id: 'passante-viale-est-1',
          until: Date.now() + 60000, x: 1, y: 2, z: 3, yaw: 0 }],
        wanted: 3, policePose: { x: 4, y: 0, z: 5, yaw: 1 } }),
      onVehicleSnapshot: (snapshot) => received.push(snapshot),
    }, 'map-a');
  const local = manager.snapshot();
  assert.equal(validSnapshot(local), true);
  assert.equal(local.vehicleRole, 'passenger');
  assert.equal(local.vehicleCondition, 42);
  assert.equal(local.npcStates.length, 1);
  assert.equal(local.wanted, 3);
  manager.receiveMessage({ type: 'state', player: { ...local, playerId: 'remote' } });
  assert.equal(received.length, 1);
  assert.equal(received[0].policePose.x, 4);
});

test('il pong sincronizza il tempo del traffico senza cambiare il protocollo dei giocatori', () => {
  const manager = new MultiplayerManager(null, { userId: 'local', displayName: 'Tony' }, player(), remotes(),
    { serverUrl: 'wss://test/room/main' }, () => {});
  manager.receiveMessage({ type: 'snapshot', players: [], serverTime: Date.now() + 5000 });
  assert.ok(manager.serverTimeOffset > 4900 && manager.serverTimeOffset < 5100);
  manager.receiveMessage({ type: 'pong', ts: performance.now(), serverTime: Date.now() + 5000 });
  assert.ok(manager.serverTimeOffset > 4900 && manager.serverTimeOffset < 5100);
  const previous = manager.serverTimeOffset;
  manager.receiveMessage({ type: 'pong', ts: performance.now() });
  assert.equal(manager.serverTimeOffset, previous);
});

test('WebSocket dedicato sincronizza avatar, stato e uscita', async () => {
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
    disconnectGracePeriodMs: 20,
    pingSeconds: 5,
  };

  let vehicleState = { vehicleId: 'via-trinita-1', vehicleStates: [] };
  const a = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Tony' }, player(1), remoteA,
    config, () => {}, () => {}, { getVehicleState: () => vehicleState });
  const b = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Altro' }, player(4), remoteB, config, () => {});

  a.connect();
  b.connect();
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(remoteA.items.get(b.playerId)?.displayName, 'Altro');
  assert.equal(remoteB.items.get(a.playerId)?.avatarConfig?.shirtColor, 'blue');
  assert.equal(remoteB.items.get(a.playerId)?.vehicleId, 'via-trinita-1');

  a.localPlayer.root.position.x = 9;
  a.localPlayer.weapon = { drawn: true, aiming: true, shotId: 1, shotTarget: [9, 1, -12] };
  a.update(0.11);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remoteB.items.get(a.playerId)?.position.x, 9);
  assert.equal(remoteB.items.get(a.playerId)?.weaponDrawn, true);
  assert.equal(remoteB.items.get(a.playerId)?.aiming, true);
  assert.equal(remoteB.items.get(a.playerId)?.shotId, 1);
  assert.deepEqual(remoteB.items.get(a.playerId)?.shotTarget, [9, 1, -12]);

  vehicleState = { vehicleStates: [{ id: 'via-trinita-1', pose: { x: 9, y: 0, z: 4, yaw: 0.4 },
    revision: 1, author: a.playerId }] };
  a.update(0.11);
  assert.equal(remoteB.items.get(a.playerId)?.vehicleId, undefined);
  assert.equal(remoteB.items.get(a.playerId)?.vehicleStates[0].pose.x, 9);

  await a.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(remoteB.items.has(a.playerId), false);
  await b.disconnect();
});

test('micro-disconnessione si riconnette prima del grace period senza overlay', async () => {
  server.sockets.clear();
  server.players.clear();

  let disconnectedOverlay = 0;
  let recovered = 0;
  const config = {
    serverUrl: 'wss://test/room/main',
    sendHz: 10,
    reconnectBaseMs: 3,
    reconnectMaxMs: 10,
    connectTimeoutMs: 100,
    disconnectGracePeriodMs: 30,
    pingSeconds: 5,
  };

  const a = new MultiplayerManager(
    null,
    { userId: crypto.randomUUID(), displayName: 'Tony' },
    player(1),
    remotes(),
    config,
    () => {},
    () => {},
    {
      onDisconnected: () => disconnectedOverlay++,
      onRecovered: () => recovered++,
    },
  );

  a.connect();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const firstSocket = a.transport.socket;
  server.close(firstSocket, 1012, 'restart');

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a.online, true);
  assert.notEqual(a.transport.socket, firstSocket);
  assert.equal(disconnectedOverlay, 0);
  assert.ok(recovered >= 2);

  a.continueOffline();
  assert.equal(a.offlineMode, true);
  assert.equal(a.online, false);
  await a.disconnect();
});

test('la chat globale invia subito e mostra un solo messaggio per ID ai client della stessa mappa', async () => {
  server.sockets.clear();
  server.players.clear();
  const received = [];
  const config = { serverUrl: 'wss://test/room/main', sendHz: 10,
    reconnectBaseMs: 5, reconnectMaxMs: 20, connectTimeoutMs: 100, pingSeconds: 5 };
  const a = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Tony' },
    player(), remotes(), config, () => {}, () => {}, {}, 'same-map');
  const b = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Amico' },
    player(), remotes(), config, () => {}, () => {}, { onChat: (message) => received.push(message) }, 'same-map');
  const otherMapMessages = [];
  const c = new MultiplayerManager(null, { userId: crypto.randomUUID(), displayName: 'Altra mappa' },
    player(), remotes(), config, () => {}, () => {},
    { onChat: (message) => otherMapMessages.push(message) }, 'different-map');
  try {
    a.connect();
    b.connect();
    c.connect();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const sent = a.sendChat('  Ciao <amici>  ');
    assert.equal(sent.text, 'Ciao amici');
    assert.equal(received.length, 1);
    assert.equal(received[0].displayName, 'Tony');
    assert.equal(received[0].text, 'Ciao amici');
    assert.equal(otherMapMessages.length, 0);
    a.update(0.11);
    assert.equal(received.length, 1);
    assert.equal(a.sendChat('troppo rapido'), null);
  } finally {
    await a.disconnect();
    await b.disconnect();
    await c.disconnect();
  }
});
