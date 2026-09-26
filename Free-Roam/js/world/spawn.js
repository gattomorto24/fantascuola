function hash(text, seed) {
  let value = seed;
  for (const character of text) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function spawnForPlayer(spawn, playerId) {
  const angle = hash(playerId, 2166136261) / 0x100000000 * Math.PI * 2;
  const radius = 2.5 + hash(playerId, 16777619) / 0x100000000 * 1.5;
  return [spawn[0] + Math.cos(angle) * radius, spawn[1], spawn[2] + Math.sin(angle) * radius];
}
