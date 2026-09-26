export const settings = Object.freeze({
  rendering: { pixelRatioMax: 2, maxDelta: 0.05, hudInterval: 0.25 },
  player: { walkSpeed: 4.2, runSpeed: 7.2, acceleration: 18, deceleration: 22, jumpForce: 7.5, gravity: 20, rotationSpeed: 11, height: 1.8 },
  camera: { distance: 6, minDistance: 2.5, maxDistance: 12, minPitch: -0.25, maxPitch: 1.15, lookHeight: 1.45, sensitivity: 0.004, zoomStep: 0.005, smoothing: 9 },
  touch: {
    joystickDeadZone: 8,
    joystickMoveRadius: 50,
    joystickSprintRadius: 58,
    joystickMaxRadius: 72,
  },
  network: {
    serverUrl: 'wss://fantascuola-realtime-production.up.railway.app/room/main',
    sendHz: 10,
    interpolation: 10,
    staleSeconds: 15,
    reconnectBaseMs: 1000,
    reconnectMaxMs: 15000,
    connectTimeoutMs: 8000,
    disconnectGracePeriodMs: 2200,
    pingSeconds: 5,
  },
  assets: { maxAvatarFileSize: 50 * 1024 * 1024, maxMapFileSize: 500 * 1024 * 1024, signedUrlSeconds: 3600 },
  world: { defaultSpawn: [0, 1, 0], mapFallback: 'test-world' },
});
