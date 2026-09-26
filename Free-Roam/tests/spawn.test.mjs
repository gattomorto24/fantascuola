import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnForPlayer } from '../js/world/spawn.js';

test('gli ingressi non si sovrappongono e restano vicini al punto della mappa', () => {
  const origin = [10, 1, -4];
  const first = spawnForPlayer(origin, 'guest:first');
  const second = spawnForPlayer(origin, 'guest:second');
  assert.deepEqual(spawnForPlayer(origin, 'guest:first'), first);
  assert.equal(first[1], origin[1]);
  assert.equal(second[1], origin[1]);
  assert.ok(Math.hypot(first[0] - second[0], first[2] - second[2]) > 1);
  assert.ok(Math.hypot(first[0] - origin[0], first[2] - origin[2]) <= 4);
});
