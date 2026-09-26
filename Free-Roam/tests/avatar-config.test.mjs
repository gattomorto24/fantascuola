import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PIXEL_AVATAR,
  PIXEL_AVATAR_OPTIONS,
  isPixelAvatarConfig,
  normalizePixelAvatarConfig,
} from '../js/avatars/AvatarConfig.js';

test('avatar pixel mantiene opzioni indipendenti e valide', () => {
  const config = normalizePixelAvatarConfig({
    skinTone: 'dark',
    hairColor: 'blonde',
    shirtColor: 'red',
    pantsColor: 'blue',
    shoesColor: 'black',
  });

  assert.deepEqual(config, {
    version: 1,
    type: 'pixel',
    skinTone: 'dark',
    hairStyle: 'basic',
    hairColor: 'blonde',
    shirtColor: 'red',
    pantsColor: 'blue',
    shoesColor: 'black',
  });
  assert.equal(isPixelAvatarConfig(config), true);
  assert.notEqual(config.shirtColor, config.pantsColor);
});

test('avatar pixel corregge valori sconosciuti usando preset sicuri', () => {
  const config = normalizePixelAvatarConfig({
    skinTone: 'alien',
    hairColor: 'purple',
    shirtColor: 'green',
    pantsColor: 'orange',
    shoesColor: 'pink',
  });

  assert.equal(config.skinTone, DEFAULT_PIXEL_AVATAR.skinTone);
  assert.equal(config.hairColor, DEFAULT_PIXEL_AVATAR.hairColor);
  assert.equal(config.shirtColor, DEFAULT_PIXEL_AVATAR.shirtColor);
  assert.equal(config.pantsColor, DEFAULT_PIXEL_AVATAR.pantsColor);
  assert.equal(config.shoesColor, DEFAULT_PIXEL_AVATAR.shoesColor);
  assert.equal(PIXEL_AVATAR_OPTIONS.skinTone.length, 4);
  assert.equal(PIXEL_AVATAR_OPTIONS.hairColor.length, 4);
  assert.equal(PIXEL_AVATAR_OPTIONS.shirtColor.length, 3);
  assert.equal(PIXEL_AVATAR_OPTIONS.pantsColor.length, 3);
  assert.equal(PIXEL_AVATAR_OPTIONS.shoesColor.length, 2);
});
