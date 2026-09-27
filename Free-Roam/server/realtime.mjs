import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const MAX_CLIENTS = 128;
const MAX_MESSAGE_BYTES = 8192;
const RATE_LIMIT_MESSAGES_PER_SEC = 30;
const RATE_LIMIT_BURST = 5;
const HEARTBEAT_INTERVAL = 30000;

const clients = new Map();
const room = new Map();

const validNumber = (value) => Number.isFinite(value) && Math.abs(value) < 100000;
const validVehicleState = (state) => state && typeof state.id === 'string' && state.id.length <= 64
  && state.pose && validNumber(state.pose.x) && validNumber(state.pose.y)
  && validNumber(state.pose.z) && validNumber(state.pose.yaw)
  && Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision < 1_000_000_000
  && typeof state.author === 'string' && state.author.length <= 120
  && (state.condition === undefined || (Number.isInteger(state.condition) && state.condition >= 0 && state.condition <= 100));
const validChat = (chat) => chat && Number.isSafeInteger(chat.id) && chat.id > 0 && chat.id < 1_000_000_000
  && typeof chat.text === 'string' && chat.text.length > 0 && chat.text.length <= 160
  && !/[<>\u0000-\u001f\u007f]/.test(chat.text) && Number.isFinite(chat.at);
const validNpcState = (state) => state && typeof state.id === 'string' && state.id.length <= 64
  && Number.isFinite(state.until) && state.until > 0
  && [state.x, state.y, state.z, state.yaw].every(validNumber);

function validSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (typeof snapshot.playerId !== 'string' || snapshot.playerId.length < 1 || snapshot.playerId.length > 120) return false;
  if (typeof snapshot.displayName !== 'string' || snapshot.displayName.length < 1 || snapshot.displayName.length > 32) return false;
  if (/[<>\u0000-\u001f]/.test(snapshot.displayName)) return false;
  if (typeof snapshot.avatarId !== 'string' || snapshot.avatarId.length > 160) return false;
  if (!snapshot.position || !validNumber(snapshot.position.x) || !validNumber(snapshot.position.y) || !validNumber(snapshot.position.z)) return false;
  if (!Number.isFinite(snapshot.rotation)) return false;
  if (!['Idle', 'Walking', 'Running', 'Jumping'].includes(snapshot.movementState)) return false;
  if (snapshot.parkourState !== undefined && !['LEDGE_GRAB', 'HANGING', 'SHIMMY', 'CLIMB_UP', 'FALLBACK_GRAB', 'FALLBACK_CLIMB'].includes(snapshot.parkourState)) return false;
  if (!Number.isFinite(snapshot.timestamp)) return false;
  if (snapshot.mapVersion !== undefined && (typeof snapshot.mapVersion !== 'string' || snapshot.mapVersion.length > 128)) return false;
  if (snapshot.weaponDrawn !== undefined && typeof snapshot.weaponDrawn !== 'boolean') return false;
  if (snapshot.aiming !== undefined && typeof snapshot.aiming !== 'boolean') return false;
  if (snapshot.shotId !== undefined && (!Number.isSafeInteger(snapshot.shotId) || snapshot.shotId < 0 || snapshot.shotId >= 1_000_000_000)) return false;
  if (snapshot.shotTarget !== undefined && (!Array.isArray(snapshot.shotTarget) || snapshot.shotTarget.length !== 3 || !snapshot.shotTarget.every(validNumber))) return false;
  if (snapshot.shotOrigin !== undefined && (!Array.isArray(snapshot.shotOrigin) || snapshot.shotOrigin.length !== 3 || !snapshot.shotOrigin.every(validNumber))) return false;
  if (snapshot.shotVictimId !== undefined && (typeof snapshot.shotVictimId !== 'string' || snapshot.shotVictimId.length < 1 || snapshot.shotVictimId.length > 120)) return false;
  if (snapshot.shotNpcId !== undefined && (typeof snapshot.shotNpcId !== 'string' || snapshot.shotNpcId.length < 1 || snapshot.shotNpcId.length > 64)) return false;
  if (snapshot.health !== undefined && (!Number.isInteger(snapshot.health) || snapshot.health < 0 || snapshot.health > 100)) return false;
  if (snapshot.vehicleId !== undefined && (typeof snapshot.vehicleId !== 'string' || snapshot.vehicleId.length > 64)) return false;
  if (snapshot.vehicleRole !== undefined && !['driver', 'passenger'].includes(snapshot.vehicleRole)) return false;
  if (snapshot.vehicleCondition !== undefined && (!Number.isInteger(snapshot.vehicleCondition) || snapshot.vehicleCondition < 0 || snapshot.vehicleCondition > 100)) return false;
  if (snapshot.vehicleStates !== undefined && (!Array.isArray(snapshot.vehicleStates) || snapshot.vehicleStates.length > 24 || !snapshot.vehicleStates.every(validVehicleState))) return false;
  if (snapshot.npcStates !== undefined && (!Array.isArray(snapshot.npcStates) || snapshot.npcStates.length > 16 || !snapshot.npcStates.every(validNpcState))) return false;
  if (snapshot.wanted !== undefined && (!Number.isInteger(snapshot.wanted) || snapshot.wanted < 0 || snapshot.wanted > 5)) return false;
  if (snapshot.policePose !== undefined && (!snapshot.policePose || ![snapshot.policePose.x,
    snapshot.policePose.y, snapshot.policePose.z, snapshot.policePose.yaw].every(validNumber))) return false;
  if (snapshot.chat !== undefined && !validChat(snapshot.chat)) return false;
  return true;
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(senderId, payload) {
  for (const [id, client] of clients) {
    if (id !== senderId) send(client.ws, payload);
  }
}

function removeClient(clientId) {
  const client = clients.get(clientId);
  if (!client) return;
  clients.delete(clientId);
  room.delete(clientId);
  if (client.playerId) broadcast(clientId, { type: 'leave', playerId: client.playerId });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server, path: '/room/main' });

wss.on('connection', (ws) => {
  if (clients.size >= MAX_CLIENTS) {
    ws.close(1008, 'Room full');
    return;
  }

  const clientId = crypto.randomUUID();
  const client = {
    ws,
    playerId: null,
    joined: false,
    isAlive: true,
    windowStartedAt: Date.now(),
    messagesInWindow: 0,
  };
  clients.set(clientId, client);

  ws.on('message', (data) => {
    if (data.length > MAX_MESSAGE_BYTES) {
      ws.close(1009, 'Message too large');
      return;
    }

    const now = Date.now();
    if (now - client.windowStartedAt >= 1000) {
      client.windowStartedAt = now;
      client.messagesInWindow = 0;
    }
    client.messagesInWindow++;
    if (client.messagesInWindow > RATE_LIMIT_MESSAGES_PER_SEC + RATE_LIMIT_BURST) {
      ws.close(1008, 'Rate limit exceeded');
      return;
    }

    let message;
    try { message = JSON.parse(data.toString()); }
    catch { return; }

    if (message.type === 'join') {
      if (client.joined || !validSnapshot(message.player)) return;
      if ([...room.values()].some((snapshot) => snapshot.playerId === message.player.playerId)) {
        send(ws, { type: 'error', msg: 'playerId taken' });
        return;
      }

      client.playerId = message.player.playerId;
      client.joined = true;
      const others = [...room.values()];
      room.set(clientId, message.player);

      send(ws, { type: 'snapshot', players: others, serverTime: Date.now() });
      broadcast(clientId, { type: 'join', player: message.player });
      return;
    }

    if (message.type === 'state') {
      if (!client.joined || !validSnapshot(message.player) || message.player.playerId !== client.playerId) return;
      room.set(clientId, message.player);
      broadcast(clientId, { type: 'state', player: message.player });
      return;
    }

    if (message.type === 'ping' && Number.isFinite(message.ts)) {
      send(ws, { type: 'pong', ts: message.ts, serverTime: Date.now() });
    }
  });

  ws.on('pong', () => { client.isAlive = true; });
  ws.on('close', () => removeClient(clientId));
  ws.on('error', () => removeClient(clientId));
});

const heartbeat = setInterval(() => {
  for (const [clientId, client] of clients) {
    if (!client.isAlive) {
      client.ws.terminate();
      removeClient(clientId);
      continue;
    }
    client.isAlive = false;
    client.ws.ping();
  }
}, HEARTBEAT_INTERVAL);

server.on('close', () => clearInterval(heartbeat));
server.listen(PORT, () => console.log(`Free Roam WebSocket server running on port ${PORT}`));
