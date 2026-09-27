// Coordinate campionate dalle superfici del GLB Quartiere_Chiesa_Dettagliato.
// X/Z restano identiche fra GLB desktop e zone mobile; Y segue la pendenza reale.
export const AMBIENT_SOURCE = Object.freeze({
  file: 'Quartiere_Chiesa_Dettagliato.glb',
  sha256: '39a2be510f25019864988489912b41611515e978895c13bc67572f03ec8dcd06',
  scale: 1,
  rotation: 0,
});

const roadHeights = [
  [112, -6.308], [120, -6.780], [135, -7.665], [150, -8.550],
  [165, -9.406], [180, -9.866], [195, -9.904], [210, -9.904], [216, -9.904],
];

export function roadY(z) {
  for (let i = 1; i < roadHeights.length; i += 1) {
    const [endZ, endY] = roadHeights[i];
    if (z <= endZ) {
      const [startZ, startY] = roadHeights[i - 1];
      return startY + (endY - startY) * Math.max(0, (z - startZ) / (endZ - startZ));
    }
  }
  return roadHeights.at(-1)[1];
}

const car = (id, x, y, z, yaw, paint) => ({ id, position: [x, y, z], yaw, paint });
const viaY = (z) => 0.295 - z * 0.059;

export const PARKED_CARS = Object.freeze([
  car('via-trinita-1', -13.0, viaY(10), 10, 0, '#d9d5c8'),
  car('via-trinita-2', 16.7, viaY(15), 15, Math.PI, '#4b6576'),
  car('via-trinita-3', -14.6, viaY(28), 28, 0, '#a74d3f'),
  car('salita-1', -11.8, -5.13, 92, 0, '#a74d3f'),
  car('viale-1', -12.1, roadY(127), 127, 0, '#bfc3bd'),
  car('viale-2', -5.4, roadY(142), 142, Math.PI, '#2e525d'),
  car('viale-3', -12.1, roadY(159), 159, 0, '#8a3038'),
  car('viale-4', -5.4, roadY(176), 176, Math.PI, '#c9ad76'),
  car('viale-5', -12.1, roadY(192), 192, 0, '#56625c'),
  car('viale-6', -5.4, roadY(205), 205, Math.PI, '#d0d2cc'),
  car('piazza-michelangelo-1', 44.4, -9.9, 237, 0, '#53616f'),
  car('piazza-michelangelo-2', 44.4, -9.9, 251, 0, '#d1c4a5'),
]);

const vialeTraffic = [
  [-9.8, 116], [-9.8, 135], [-9.8, 150], [-9.8, 165], [-9.8, 180], [-9.8, 205],
  [-9.3, 210], [-8.5, 212], [-7.6, 210], [-7.2, 205],
  [-7.2, 180], [-7.2, 165], [-7.2, 150], [-7.2, 135], [-7.2, 116],
  [-7.7, 113.5], [-8.5, 112.5], [-9.3, 113.5],
].map(([x, z]) => [x, roadY(z), z]);

export const MOVING_CARS = Object.freeze([
  { id: 'traffico-viale-1', paint: '#5b7582', speed: 5.2, phase: 0.10, path: vialeTraffic },
  { id: 'traffico-viale-2', paint: '#b8b4a6', speed: 4.7, phase: 0.56, path: vialeTraffic },
  { id: 'traffico-via-trinita', paint: '#9b3c35', speed: 3.0, phase: 0.32,
    path: [[4, 6], [4, 20], [4, 39], [5, 43], [6, 44], [7, 39],
      [7, 20], [7, 6], [6, 3], [5, 4]].map(([x, z]) => [x, viaY(z), z]) },
]);

const rightWalk = [120, 135, 150, 165, 180, 195, 210]
  .map((z) => [-3.3, roadY(z) + 0.173, z]);
const leftWalkNorth = [156, 165, 180, 195, 210]
  .map((z) => [-14.5, roadY(z) + 0.173, z]);
const leftWalkSouth = [120, 130, 140]
  .map((z) => [-14.5, roadY(z) + 0.173, z]);

export const PEDESTRIANS = Object.freeze([
  { id: 'passante-via-trinita-1',
    path: [[-15.6, 10], [-16.7, 20], [-16.6, 30], [-14.6, 40], [-12.7, 45]]
      .map(([x, z]) => [x, viaY(z) + 0.17, z]), speed: 0.88, phase: 0.14,
    avatar: { shirtPrimaryColor: 'yellow', pantsColor: 'blue', hairColor: 'black', skinTone: 'olive' } },
  { id: 'passante-via-trinita-2',
    path: [[-15.6, 10], [-16.7, 20], [-16.6, 30], [-14.6, 40], [-12.7, 45]]
      .map(([x, z]) => [x, viaY(z) + 0.17, z]), speed: 0.75, phase: 0.61,
    avatar: { shirtPrimaryColor: 'red', pantsColor: 'blue', hairColor: 'blonde', skinTone: 'light' } },
  { id: 'passante-viale-est-1', path: rightWalk, speed: 0.9, phase: 0.06,
    avatar: { shirtPrimaryColor: 'white', pantsColor: 'blue', hairColor: 'brown', skinTone: 'medium' } },
  { id: 'passante-viale-est-2', path: rightWalk, speed: 0.8, phase: 0.47,
    avatar: { shirtPrimaryColor: 'blue', pantsColor: 'red', hairColor: 'black', skinTone: 'dark' } },
  { id: 'passante-viale-ovest-1', path: leftWalkSouth, speed: 0.75, phase: 0.34,
    avatar: { shirtPrimaryColor: 'red', pantsColor: 'blue', hairColor: 'brown', skinTone: 'amber' } },
  { id: 'passante-viale-ovest-2', path: leftWalkNorth, speed: 0.82, phase: 0.78,
    avatar: { shirtPrimaryColor: 'yellow', pantsColor: 'red', hairColor: 'black', skinTone: 'light-medium' } },
  { id: 'passante-piazza-est-1', path: [[47.5, -9.757, 238], [47.5, -9.757, 255]], speed: 0.76, phase: 0.26,
    avatar: { shirtPrimaryColor: 'blue', pantsColor: 'blue', hairColor: 'brown', skinTone: 'olive' } },
  { id: 'passante-piazza-est-2', path: [[47.5, -9.757, 238], [47.5, -9.757, 255]], speed: 0.82, phase: 0.72,
    avatar: { shirtPrimaryColor: 'white', pantsColor: 'red', hairColor: 'black', skinTone: 'medium' } },
  { id: 'passante-piazza-ovest', path: [[-17.3, -9.807, 221], [-17.3, -9.807, 258]], speed: 0.74, phase: 0.49,
    avatar: { shirtPrimaryColor: 'red', pantsColor: 'blue', hairColor: 'blonde', skinTone: 'light' } },
]);

export function matchesAmbientMap(manifest, sourceSha = null) {
  const url = manifest?.asset_url || manifest?.metadata?.asset_url || manifest?.storage_path || '';
  let filename;
  try { filename = decodeURIComponent(new URL(url, 'https://example.invalid/').pathname.split('/').at(-1)); }
  catch { return false; }
  const knownSha = sourceSha || manifest?.metadata?.mobile_source_sha256;
  return filename === AMBIENT_SOURCE.file
    && Number(manifest?.scale || 1) === AMBIENT_SOURCE.scale
    && Number(manifest?.rotation || 0) === AMBIENT_SOURCE.rotation
    && (!knownSha || knownSha === AMBIENT_SOURCE.sha256);
}

export function sampleRoute(points, speed, phase, timeMs, bounce = false) {
  if (!Array.isArray(points) || points.length < 2 || !(speed > 0)) return null;
  const count = bounce ? points.length - 1 : points.length;
  const lengths = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    lengths.push(length);
    total += length;
  }
  if (total < 0.001) return null;
  const circuit = bounce ? total * 2 : total;
  let distance = (((timeMs / 1000) * speed + phase * circuit) % circuit + circuit) % circuit;
  const backwards = bounce && distance > total;
  if (backwards) distance = circuit - distance;
  for (let i = 0; i < count; i += 1) {
    if (distance <= lengths[i] || i === count - 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const t = Math.min(1, distance / Math.max(lengths[i], 0.0001));
      const dx = (b[0] - a[0]) * (backwards ? -1 : 1);
      const dz = (b[2] - a[2]) * (backwards ? -1 : 1);
      return { x: a[0] + (b[0] - a[0]) * t,
        y: a[1] + (b[1] - a[1]) * t,
        z: a[2] + (b[2] - a[2]) * t,
        yaw: Math.atan2(dx, dz) };
    }
    distance -= lengths[i];
  }
  return null;
}
