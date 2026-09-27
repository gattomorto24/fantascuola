import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createClipAnimator } from '../js/avatars/AvatarManager.js';

test('gli avatar GLB usano le clip dedicate a corsa, presa, scalata e salita', () => {
  const root = new THREE.Group();
  const clips = ['Idle', 'Running', 'Ledge Grab', 'Wall Climb', 'Mantle'].map((name) =>
    new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 0.01])]));
  const mixer = new THREE.AnimationMixer(root);
  const update = createClipAnimator(mixer, clips);
  for (const [state, index] of [['Idle', 0], ['Running', 1], ['LEDGE_GRAB', 2],
    ['FALLBACK_CLIMB', 3], ['CLIMB_UP', 4]]) {
    update(0.016, state);
    assert.equal(mixer.existingAction(clips[index])?.isRunning(), true, state);
  }
  assert.equal(mixer.existingAction(clips[4]).loop, THREE.LoopOnce);
  mixer.stopAllAction();
});
