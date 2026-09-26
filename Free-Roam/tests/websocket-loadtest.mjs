import WebSocket from 'ws';

const url = process.env.FREE_ROAM_WS || 'wss://fantascuola-realtime-production.up.railway.app/room/main';
const clients = Math.max(1, Math.min(128, Number(process.argv[2]) || 100));
const hz = Math.max(1, Math.min(20, Number(process.argv[3]) || 2));
const durationSeconds = Math.max(3, Math.min(60, Number(process.argv[4]) || 10));

let opened = 0;
let failed = 0;
let received = 0;
let sent = 0;
const sockets = [];
const started = Date.now();

function snapshot(i, t = 0) {
  const angle = t * 0.001 + i * 0.17;
  return {
    playerId: `loadtest:${process.pid}:${i}`,
    displayName: `BOT ${String(i + 1).padStart(3, '0')}`,
    avatarId: 'pixel',
    position: { x: Math.cos(angle) * 20, y: 1, z: Math.sin(angle) * 20 },
    rotation: angle,
    movementState: 'Running',
    timestamp: Date.now(),
  };
}

await Promise.all(Array.from({ length: clients }, (_, i) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  sockets.push(ws);

  const timeout = setTimeout(() => {
    failed++;
    try { ws.terminate(); } catch {}
    resolve();
  }, 8000);

  ws.on('open', () => {
    clearTimeout(timeout);
    opened++;
    ws.send(JSON.stringify({ type: 'join', player: snapshot(i) }));
    sent++;
    resolve();
  });

  ws.on('message', () => { received++; });
  ws.on('error', () => {});
  ws.on('close', () => {});
})));

if (!opened) {
  console.error('Nessuna connessione WebSocket aperta.');
  process.exit(1);
}

const intervalMs = Math.round(1000 / hz);
const timer = setInterval(() => {
  const now = Date.now();
  sockets.forEach((ws, i) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'state', player: snapshot(i, now) }));
    sent++;
  });
}, intervalMs);

await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
clearInterval(timer);

for (const ws of sockets) {
  try { ws.close(1000, 'load test complete'); } catch {}
}

await new Promise((resolve) => setTimeout(resolve, 500));

const elapsed = (Date.now() - started) / 1000;
console.log(JSON.stringify({
  targetClients: clients,
  opened,
  failed,
  updateHzPerClient: hz,
  durationSeconds,
  elapsedSeconds: Number(elapsed.toFixed(2)),
  sent,
  received,
}, null, 2));

process.exit(opened === clients ? 0 : 2);
